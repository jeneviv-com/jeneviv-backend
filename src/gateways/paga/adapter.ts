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

const COLLECTION_METHODS = ["BANK_TRANSFER", "FUNDING_USSD", "REQUEST_MONEY"];

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

function callbackUrl(): string {
  if (env.PAGA_CALLBACK_URL) return env.PAGA_CALLBACK_URL;
  return `${env.BETTER_AUTH_URL.replace(/\/+$/, "")}/api/webhooks/paga`;
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
    const amount = toMajor(args.amount, args.currency);
    const payer = {
      name: args.customerName?.trim() || "Jeneviv payer",
      phoneNumber: args.customerPhone?.trim() || "",
      email: args.customerEmail?.trim() || "",
    };

    const body = {
      referenceNumber: args.reference,
      amount,
      currency: args.currency,
      payer,
      expiryDateTimeUTC: new Date(Date.now() + args.expirySeconds * 1000)
        .toISOString()
        .slice(0, 19),
      isSuppressMessages: true,
      // The payer absorbs Paga's collection fee; the merchant keeps the full amount.
      payerCollectionFeeShare: 1,
      payeeCollectionFeeShare: 0,
      isAllowPartialPayments: false,
      isAllowOverPayments: false,
      callBackUrl: callbackUrl(),
      paymentMethods: COLLECTION_METHODS,
      displayBankDetailToPayer: false,
      redirectUrl: env.APP_PUBLIC_URL,
    };

    const res = await pagaRequest<PagaPaymentRequestResponse>({
      path: "/paymentRequest",
      body,
      // Paga appends the hash key itself inside pagaHash().
      hashParts: [
        args.reference,
        amount,
        args.currency,
        payer.phoneNumber,
        payer.email,
        // No payee: these four stay empty.
        "",
        "",
        "",
        "",
      ],
    });

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
