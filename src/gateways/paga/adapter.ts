import { env } from "../../env.js";
import { toMajor, toMinor } from "../../lib/money.js";
import type {
  BankSummary,
  CreateVirtualAccountArgs,
  CreateVirtualAccountResult,
  EnsureCustomerArgs,
  InitiateRefundArgs,
  InitiateRefundResult,
  InitiateTransferArgs,
  InitiateTransferResult,
  NormalizedEvent,
  PaymentGateway,
  ResolveAccountNameArgs,
  VerifiedPayment,
} from "../types.js";
import { GatewayError } from "../types.js";
import { pagaRequest } from "./client.js";
import { parsePagaEvent, verifyPagaSignature } from "./webhook.js";

/*
 * Paga Collect API — https://developer-docs.paga.com
 *
 * Why there is no split here
 * --------------------------
 * A Paga payment request has at most one `payee`. Naming a payee sends the
 * whole collected amount to that single destination, and `payerCollectionFeeShare`
 * / `payeeCollectionFeeShare` only decide which side absorbs Paga's own
 * collection fee — they do not carve out a platform commission the way a
 * Paystack transaction split does. Paga has no sub-account or multi-recipient
 * split product for Collections.
 *
 * So Jeneviv is the payee: money lands in the Jeneviv Paga business account,
 * the merchant's wallet is credited on a confirmed charge (see
 * `handleChargeSuccess`, which holds funds for every gateway except Paystack),
 * and merchants settle through the existing payout/withdrawal flow. Merchant
 * transfers are deliberately not implemented on Paga so that nothing bypasses
 * that flow or their payout screens.
 *
 * The payer covers the collection fee (`payerCollectionFeeShare: 1`), so the
 * merchant still receives the full collection amount.
 */


const FAILED_STATES = new Set(["FAILED", "CANCELLED", "EXPIRED"]);

interface PagaPaymentMethod {
  name?: string;
  properties?: Record<string, unknown>;
}

interface PagaPaymentRequestResponse {
  referenceNumber?: string;
  statusCode?: string;
  statusMessage?: string;
  requestAmount?: number;
  totalPaymentAmount?: number;
  expiryDateTimeUTC?: string;
  paymentMethods?: PagaPaymentMethod[];
}

interface PagaStatusResponse {
  referenceNumber?: string;
  statusCode?: string;
  statusMessage?: string;
  data?: {
    referenceNumber?: string;
    statusCode?: string;
    statusMessage?: string;
    requestAmount?: number;
    totalPaymentAmount?: number;
    cumulativePaymentAmount?: number;
    paymentAmount?: number;
    currency?: string;
    state?: string;
    expiryDateTimeUTC?: string;
    refundStatus?: string;
  };
}

interface PagaBank {
  uuid?: string;
  name?: string;
}

interface PagaBanksResponse {
  banks?: PagaBank[];
}

/** Paga timestamps are UTC without a zone suffix. */
function parsePagaDate(value: string | undefined): Date | null {
  if (!value) return null;
  const normalized = /[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isLocalUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local");
  } catch {
    return true;
  }
}

function callbackUrl(): string {
  const url = env.PAGA_CALLBACK_URL
    || `${env.BETTER_AUTH_URL.replace(/\/+$/, "")}/api/webhooks/paga`;
  // Paga cannot reach localhost, and a request with an unreachable callback
  // can never be confirmed. Fail loudly with the setting to fix instead.
  if (isLocalUrl(url)) {
    console.error("[Paga] Callback URL is not public", { callbackUrl: url });
    throw new GatewayError(
      "paga",
      `Paga callback URL is not public (${url}). Set BETTER_AUTH_URL to the API's public https URL, or set PAGA_CALLBACK_URL.`,
    );
  }
  return url;
}

interface PagaSubsidiaryAccountResponse {
  referenceNumber?: string;
  statusCode?: string;
  statusMessage?: string;
  accountNumber?: string;
  accountReference?: string;
  status?: string;
  currency?: string;
}

interface PagaSubsidiaryHistoryResponse {
  statusCode?: string;
  statusMessage?: string;
  transactions?: Array<{
    transactionType?: string;
    amount?: number | string;
    transactionDate?: string;
    status?: string;
  }>;
}

/** Paga's UTC timestamp format: 2026-06-11T10:22:16 (no zone, no millis). */
function pagaUtc(date: Date): string {
  return date.toISOString().slice(0, 19);
}

/** Paga wants a fresh referenceNumber per call; accountReference is the account's id. */
function pagaCallReference(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "Jeneviv", lastName: "Payer" };
  if (parts.length === 1) return { firstName: parts[0]!, lastName: parts[0]! };
  return { firstName: parts[0]!, lastName: parts.slice(1).join(" ") };
}

/**
 * Subsidiary Accounts (POST /subsidiary-accounts) issue a Paga NUBAN per
 * payment. With autoSweep VIRTUAL_ACCOUNT nothing is held on the account:
 * funds settle straight into the Jeneviv Paga business account, the same money
 * flow as a payment request. accountReference is our payment reference, so
 * the account can be looked up (and its history read) by reference later.
 */
async function createSubsidiaryAccount(
  args: CreateVirtualAccountArgs,
): Promise<CreateVirtualAccountResult> {
  const reference = args.reference;
  if (reference.length < 11 || reference.length > 30) {
    throw new GatewayError(
      "paga",
      `Paga accountReference must be 11 to 30 characters (got ${reference.length}).`,
    );
  }
  const phoneNumber = args.customerPhone?.trim() || "";
  const email = args.customerEmail?.trim() || "";
  if (!phoneNumber && !email) {
    throw new GatewayError("paga", "Paga needs the payer's phone number or email address.");
  }
  const payerName = args.customerName?.trim() || "Jeneviv Payer";
  const { firstName, lastName } = splitName(payerName);
  // Shown on the payer's bank name enquiry, after the business name.
  const accountName = `${env.PAGA_PAYEE_NAME} ${payerName}`.slice(0, 60);
  const callback = callbackUrl();
  const referenceNumber = pagaCallReference("jvsa");
  const destination = "VIRTUAL_ACCOUNT";
  const iifiNumber = env.PAGA_SUBSIDIARY_IIFI_NUMBER || "";

  const body = {
    referenceNumber,
    accountReference: reference,
    accountName,
    firstName,
    lastName,
    ...(phoneNumber ? { phoneNumber } : {}),
    ...(email ? { email } : {}),
    ...(iifiNumber ? { iifiNumber } : {}),
    status: "ACTIVE",
    autoSweep: { destination },
    callbackUrl: callback,
  };

  let res;
  try {
    res = await pagaRequest<PagaSubsidiaryAccountResponse>({
      path: "/subsidiary-accounts",
      body,
      // referenceNumber + accountReference + iifiNumber + autoSweep.bankPublicId
      // + autoSweep.destination + autoSweep.accountNumber + callbackUrl.
      hashParts: [referenceNumber, reference, iifiNumber, "", destination, "", callback],
    });
  } catch (err) {
    console.error("[Paga] subsidiary account context", {
      error: err instanceof Error ? err.message : String(err),
      baseUrl: env.PAGA_BASE_URL,
      callbackHost: new URL(callback).host,
      accountReferenceLength: reference.length,
      sentIifiNumber: Boolean(iifiNumber),
      payerFields: Object.keys(body).filter((key) => key === "phoneNumber" || key === "email"),
    });
    throw err;
  }

  const accountNumber = String(res.data.accountNumber ?? "");
  if (!accountNumber) {
    throw new GatewayError("paga", "Paga created the account but returned no account number", {
      raw: res.data,
    });
  }

  return {
    gatewayAccountId: String(res.data.accountReference ?? reference),
    accountNumber,
    accountName,
    bankCode: "",
    bankName: "Paga",
    expiryAt: new Date(Date.now() + args.expirySeconds * 1000),
    // Fees are taken by Paga on settlement (clearingFeeAmount), not added here.
    totalCharged: args.amount,
  };
}

/**
 * Confirms a subsidiary-account payment from Paga's own ledger: the sum of
 * successful CREDIT entries on the account named by our reference.
 */
async function verifySubsidiaryPayment(reference: string): Promise<VerifiedPayment | null> {
  const end = new Date(Date.now() + 5 * 60 * 1000);
  const start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const startUtc = pagaUtc(start);
  const endUtc = pagaUtc(end);
  const referenceNumber = pagaCallReference("jvsh");
  const query = new URLSearchParams({
    referenceNumber,
    startDateTimeUTC: startUtc,
    endDateTimeUTC: endUtc,
    pageSize: "50",
    pageNumber: "0",
  });

  const res = await pagaRequest<PagaSubsidiaryHistoryResponse>({
    method: "GET",
    path: `/subsidiary-accounts/${encodeURIComponent(reference)}/history?${query.toString()}`,
    // History hashes accountIdentifier + start + end; referenceNumber is not hashed.
    hashParts: [reference, startUtc, endUtc],
  });

  const credits = (res.data.transactions ?? []).filter(
    (entry) =>
      String(entry.transactionType ?? "").toUpperCase() === "CREDIT" &&
      ["SUCCESSFUL", "SUCCESS", "COMPLETED"].includes(String(entry.status ?? "").toUpperCase()),
  );
  const paid = credits.reduce((sum, entry) => sum + Number(String(entry.amount ?? 0).replace(/,/g, "")), 0);

  return {
    status: paid > 0 ? "success" : "pending",
    gatewayId: reference,
    amountPaidMinor: toMinor(paid, "NGN"),
    gatewayFeeMinor: 0,
    currency: "NGN",
    paidAt: paid > 0 ? new Date() : null,
  };
}

export const pagaAdapter: PaymentGateway = {
  name: "paga",
  // Collect takes the payer's details on the request itself; there is no
  // separate customer object to create first.
  usesCustomerForVirtualAccount: false,

  async ensureCustomer({
    uid,
  }: EnsureCustomerArgs): Promise<{ customerId: string }> {
    // Only called when `usesCustomerForVirtualAccount` is true, which it is not.
    return { customerId: uid };
  },

  async createVirtualAccount(
    args: CreateVirtualAccountArgs,
  ): Promise<CreateVirtualAccountResult> {
    if (env.PAGA_COLLECT_MODE === "subsidiary") {
      return createSubsidiaryAccount(args);
    }
    const amount = toMajor(args.amount, args.currency);
    const phoneNumber = args.customerPhone?.trim() || "";
    const email = args.customerEmail?.trim() || "";
    if (!phoneNumber && !email) {
      throw new GatewayError("paga", "Paga needs the payer's phone number or email address.");
    }
    // Omit blank contact fields rather than sending "": Paga requires one of
    // them and rejects empty strings. They still hash as "" (see below).
    const payer = {
      name: args.customerName?.trim() || "Jeneviv payer",
      ...(phoneNumber ? { phoneNumber } : {}),
      ...(email ? { email } : {}),
    };

    const paymentMethods = env.PAGA_PAYMENT_METHODS.length
      ? env.PAGA_PAYMENT_METHODS
      : ["BANK_TRANSFER"];
    // redirectUrl only matters for REQUEST_MONEY, and a localhost one is worse
    // than none, so send it only when it can be used.
    const redirectUrl =
      paymentMethods.includes("REQUEST_MONEY") && !isLocalUrl(env.APP_PUBLIC_URL)
        ? env.APP_PUBLIC_URL
        : undefined;

    const body = {
      referenceNumber: args.reference,
      amount,
      currency: args.currency,
      payer,
      // Required by Paga. With no account identifiers the business processing
      // the request (Jeneviv) receives the funds; the name is what the payer
      // sees on their bank's name enquiry.
      payee: { name: env.PAGA_PAYEE_NAME },
      expiryDateTimeUTC: new Date(Date.now() + args.expirySeconds * 1000)
        .toISOString()
        .slice(0, 19),
      isSuppressMessages: true,
      // The payer absorbs Paga's collection fee; the merchant keeps the full amount.
      payerCollectionFeeShare: 1,
      payeeCollectionFeeShare: 0,
      isAllowPartialPayments: false,
      // isAllowOverPayments is deliberately absent: Paga's own client library
      // (paga-collect) never sends it, and an unrecognised field makes the
      // Collect API fail with a bare "-1 system error".
      callBackUrl: callbackUrl(),
      paymentMethods,
      ...(redirectUrl ? { redirectUrl } : {}),
    };

    let res;
    try {
      res = await pagaRequest<PagaPaymentRequestResponse>({
        path: "/paymentRequest",
        body,
        // Paga appends the hash key itself inside pagaHash().
        hashParts: [
          args.reference,
          amount,
          args.currency,
          phoneNumber,
          email,
          // The payee carries only a name, so its four hashed identifiers are empty.
          "",
          "",
          "",
          "",
        ],
      });
    } catch (err) {
      // The request shape, never payer details: enough to compare with Paga's docs.
      console.error("[Paga] paymentRequest context", {
        // What actually went wrong: auth rejection, missing key, network
        // failure or Paga's own message. Never contains payer data or keys.
        error: err instanceof Error ? err.message : String(err),
        // fetch() network failures carry the real reason (DNS, TLS, refused) here.
        cause: (() => {
          const cause = (err as { cause?: unknown } | null)?.cause;
          return cause instanceof Error ? `${cause.name}: ${cause.message}` : undefined;
        })(),
        baseUrl: env.PAGA_BASE_URL,
        callbackHost: new URL(body.callBackUrl).host,
        paymentMethods: body.paymentMethods,
        hasRedirectUrl: "redirectUrl" in body,
        expiryDateTimeUTC: body.expiryDateTimeUTC,
        amount: body.amount,
        currency: body.currency,
        payerFields: Object.keys(body.payer),
      });
      throw err;
    }

    const request = res.data;
    const methods = request.paymentMethods ?? [];
    // BANK_TRANSFER (or AGENT_DEPOSIT) carries the NUBAN the payer transfers to.
    const transfer = methods.find((method) => {
      const account = method.properties?.["AccountNumber"];
      return account !== undefined && account !== null && String(account) !== "";
    });

    if (!transfer) {
      throw new GatewayError(
        "paga",
        `Paga returned no transfer account for this request (methods: ${
          methods.map((method) => method.name ?? "unknown").join(", ") || "none"
        })`,
        { raw: request },
      );
    }

    const properties = transfer.properties ?? {};
    const expiryAt =
      parsePagaDate(request.expiryDateTimeUTC) ??
      new Date(Date.now() + args.expirySeconds * 1000);

    return {
      gatewayAccountId: request.referenceNumber ?? args.reference,
      accountNumber: String(properties["AccountNumber"] ?? ""),
      accountName: String(properties["accountName"] ?? args.narration),
      bankCode: String(properties["bankCode"] ?? ""),
      bankName: String(properties["bankName"] ?? "Paga"),
      expiryAt,
      totalCharged:
        request.totalPaymentAmount !== undefined
          ? toMinor(request.totalPaymentAmount, args.currency)
          : args.amount,
    };
  },

  /**
   * Paga has no account name enquiry on Collect, and guessing a name on a payout
   * we do not make anyway would be worse than refusing. Add the bank account
   * through a gateway that resolves names.
   */
  async resolveAccountName(
    _args: ResolveAccountNameArgs,
  ): Promise<{ accountName: string }> {
    throw new GatewayError(
      "paga",
      "Paga Collect does not expose account name resolution. Verify this account with the settlement gateway instead.",
    );
  },

  async listBanks(_country: string): Promise<BankSummary[]> {
    // Paga identifies banks by uuid, which is what it expects back on a payee.
    const reference = `banks${Date.now()}`;
    const res = await pagaRequest<PagaBanksResponse>({
      path: "/banks",
      body: { referenceNumber: reference },
      hashParts: [reference],
    });
    const banks = res.data.banks;
    if (!Array.isArray(banks)) {
      throw new GatewayError("paga", "Banks response is not an array", {
        raw: res.data,
      });
    }
    return banks
      .filter((bank) => bank?.uuid && bank?.name)
      .map((bank) => ({ code: String(bank.uuid), name: String(bank.name) }));
  },

  /**
   * Merchants are never paid out through Paga: collected funds sit in the
   * Jeneviv business account so the platform fee can be retained, and the
   * existing payout flow moves the merchant's balance out. Implementing this
   * would also mean using Paga's own money-transfer screens.
   */
  async initiateTransfer(
    _args: InitiateTransferArgs,
  ): Promise<InitiateTransferResult> {
    throw new GatewayError(
      "paga",
      "Paga collections are not paid out through Paga; merchant balances settle through the platform payout flow",
    );
  },

  async initiateRefund(
    args: InitiateRefundArgs,
  ): Promise<InitiateRefundResult> {
    const refundReference = args.reference;
    const refundAmount = toMajor(args.amount, args.currency);

    await pagaRequest({
      path: "/refund/v2",
      body: {
        referenceNumber: refundReference,
        paymentRequestReference: args.chargeId || args.reference,
        refundAmount,
        currency: args.currency,
        reason: args.reason ?? "Refund requested",
      },
      hashParts: [refundReference, refundAmount],
    });

    // Paga accepts the refund and settles it asynchronously; the webhook or a
    // later status read reports the final outcome.
    return { gatewayRefundId: refundReference, status: "pending" };
  },

  async verifyPayment(reference: string): Promise<VerifiedPayment | null> {
    if (env.PAGA_COLLECT_MODE === "subsidiary") {
      return verifySubsidiaryPayment(reference);
    }
    const res = await pagaRequest<PagaStatusResponse>({
      path: "/status",
      body: { referenceNumber: reference },
      hashParts: [reference],
      // 121 = payment request reference not found.
      acceptStatusCodes: ["0", "1", "121"],
    });

    if (String(res.data.statusCode ?? "") === "121") return null;

    const data = res.data.data ?? {};
    const state = String(data.state ?? "").toUpperCase();
    const currency = String(data.currency ?? "NGN");
    const requested = Number(data.requestAmount ?? 0);
    const paid = Number(
      data.cumulativePaymentAmount ?? data.paymentAmount ?? data.totalPaymentAmount ?? 0,
    );

    let status: VerifiedPayment["status"] = "pending";
    if (state === "CONSUMED" || (requested > 0 && paid >= requested)) {
      status = "success";
    } else if (FAILED_STATES.has(state)) {
      status = "failed";
    }

    return {
      status,
      gatewayId: String(data.referenceNumber ?? reference),
      amountPaidMinor: toMinor(paid, currency),
      // POST /status does not report the collection fee; the callback does, and
      // the charge handler recomputes the total from whatever arrives.
      gatewayFeeMinor: 0,
      currency,
      paidAt: status === "success" ? new Date() : null,
    };
  },

  verifyWebhookSignature(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): boolean {
    return verifyPagaSignature(rawBody, headers);
  },

  parseWebhookEvent(payload: unknown): NormalizedEvent | null {
    return parsePagaEvent(payload);
  },
};
