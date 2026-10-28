import type {
  VerifiedPayment,
  BankSummary,
  CreateVirtualAccountArgs,
  CreateVirtualAccountResult,
  EnsureCustomerArgs,
  EnsureSubaccountArgs,
  InitiateRefundArgs,
  InitiateRefundResult,
  InitiateTransferArgs,
  InitiateTransferResult,
  NormalizedEvent,
  PaymentGateway,
  ResolveAccountNameArgs,
  RetryRefundArgs,
} from "../types.js";
import { GatewayError } from "../types.js";
import { psRequest } from "./client.js";
import { parsePaystackEvent, verifyPaystackSignature } from "./webhook.js";

interface PsEnvelope<T> {
  status?: boolean;
  message?: string;
  data: T;
}

// Paystack's /bank endpoint expects a full country name, not the ISO alpha-2
// code our API/DB layer uses. Map the canonical code to Paystack's form.
const PS_COUNTRY_BY_ISO: Record<string, string> = {
  NG: "nigeria",
  GH: "ghana",
  KE: "kenya",
  ZA: "south africa",
  CI: "côte d'ivoire",
  EG: "egypt",
};

interface PsCustomer {
  id: number;
  customer_code: string;
  email: string;
}

interface PsSubaccount {
  id: number;
  subaccount_code: string;
  account_number: string;
  settlement_bank: string;
}

interface PsChargeResponse {
  reference?: string;
  status?: string;
  account_name?: string;
  account_number?: string;
  bank?: { slug?: string; name?: string; id?: number };
  account_expires_at?: string;
  amount?: number;
}

interface PsBank {
  id?: number;
  code: string;
  name: string;
}

interface PsAccountResolve {
  account_number: string;
  account_name: string;
}

interface PsRefund {
  id: number;
  status?: string;
}

const REFUND_STATUS_MAP: Record<string, InitiateRefundResult["status"]> = {
  pending: "pending",
  processing: "pending",
  "needs-attention": "pending",
  processed: "success",
  success: "success",
  failed: "failed",
};

function parseRefundResponse(
  body: PsEnvelope<PsRefund> | undefined,
): InitiateRefundResult {
  const refund = body?.data;
  if (!refund?.id) {
    throw new GatewayError("paystack", "Refund response missing id", {
      raw: body,
    });
  }
  const status =
    REFUND_STATUS_MAP[(refund.status ?? "").toLowerCase()] ?? "pending";
  return { gatewayRefundId: String(refund.id), status };
}

function splitName(name: string): { first: string; last: string } {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return { first: "Customer", last: "" };
  const parts = trimmed.split(/\s+/);
  return { first: parts[0]!, last: parts.slice(1).join(" ") };
}

export const paystackAdapter: PaymentGateway = {
  name: "paystack",
  usesCustomerForVirtualAccount: false,

  async ensureCustomer({
    email,
    name,
  }: EnsureCustomerArgs): Promise<{ customerId: string }> {
    const { first, last } = splitName(name);
    const res = await psRequest<PsEnvelope<PsCustomer>>({
      method: "POST",
      path: "/customer",
      body: { email, first_name: first, last_name: last },
    });
    const code = res.data?.data?.customer_code;
    if (!code) {
      throw new GatewayError("paystack", "Customer response missing customer_code", {
        raw: res.data,
      });
    }
    return { customerId: code };
  },

  async ensureSubaccount({
    businessName,
    bankCode,
    accountNumber,
    percentageCharge,
  }: EnsureSubaccountArgs): Promise<{ subaccountCode: string }> {
    const res = await psRequest<PsEnvelope<PsSubaccount>>({
      method: "POST",
      path: "/subaccount",
      body: {
        business_name: businessName,
        settlement_bank: bankCode,
        account_number: accountNumber,
        percentage_charge: percentageCharge ?? 0,
      },
    });
    const code = res.data?.data?.subaccount_code;
    if (!code) {
      throw new GatewayError("paystack", "Subaccount response missing subaccount_code", {
        raw: res.data,
      });
    }
    return { subaccountCode: code };
  },

  async createVirtualAccount(
    args: CreateVirtualAccountArgs,
  ): Promise<CreateVirtualAccountResult> {
    if (!args.customerEmail) {
      throw new GatewayError("paystack", "customerEmail is required for Paystack charge");
    }
    if (!args.subaccountCode) {
      throw new GatewayError("paystack", "subaccountCode is required for Paystack charge");
    }

    const body: Record<string, unknown> = {
      email: args.customerEmail,
      amount: args.amount,
      reference: args.reference,
      subaccount: args.subaccountCode,
      bearer: "subaccount",
      bank_transfer: {
        account_expires_at: new Date(
          Date.now() + args.expirySeconds * 1000,
        ).toISOString(),
      },
    };
    if (args.platformFeeMinor && args.platformFeeMinor > 0) {
      body.transaction_charge = args.platformFeeMinor;
    }

    const res = await psRequest<PsEnvelope<PsChargeResponse>>({
      method: "POST",
      path: "/charge",
      body,
    });

    const charge = res.data?.data;
    if (!charge?.account_number) {
      throw new GatewayError("paystack", "Charge response missing virtual account", {
        raw: res.data,
      });
    }

    return {
      gatewayAccountId: charge.reference ?? args.reference,
      accountNumber: charge.account_number,
      accountName: charge.account_name ?? args.narration,
      bankCode: charge.bank?.slug ?? String(charge.bank?.id ?? ""),
      bankName: charge.bank?.name ?? "",
      expiryAt: charge.account_expires_at
        ? new Date(charge.account_expires_at)
        : new Date(Date.now() + args.expirySeconds * 1000),
      totalCharged: charge.amount ?? args.amount,
    };
  },

  async resolveAccountName({
    bankCode,
    accountNumber,
  }: ResolveAccountNameArgs): Promise<{ accountName: string }> {
    const res = await psRequest<PsEnvelope<PsAccountResolve>>({
      method: "GET",
      path: "/bank/resolve",
      query: { account_number: accountNumber, bank_code: bankCode },
    });
    const name = res.data?.data?.account_name;
    if (!name) {
      throw new GatewayError("paystack", "Account resolve response missing name", {
        raw: res.data,
      });
    }
    return { accountName: name };
  },

  async listBanks(country: string): Promise<BankSummary[]> {
    const res = await psRequest<PsEnvelope<PsBank[]>>({
      method: "GET",
      path: "/bank",
      query: {
        country: PS_COUNTRY_BY_ISO[country?.toUpperCase()] ?? "nigeria",
        perPage: 1000,
      },
    });
    const banks = res.data?.data;
    if (!Array.isArray(banks)) {
      throw new GatewayError("paystack", "Banks response is not an array", {
        raw: res.data,
      });
    }
    return banks
      .filter((b) => b && b.code && b.name)
      .map((b) => ({ code: b.code, name: b.name }));
  },

  async initiateTransfer(
    _args: InitiateTransferArgs,
  ): Promise<InitiateTransferResult> {
    throw new GatewayError(
      "paystack",
      "Paystack merchant payouts are disabled; merchants are settled directly via transaction split",
    );
  },

  async initiateRefund(
    args: InitiateRefundArgs,
  ): Promise<InitiateRefundResult> {
    const res = await psRequest<PsEnvelope<PsRefund>>({
      method: "POST",
      path: "/refund",
      body: {
        transaction: args.chargeId,
        amount: args.amount,
        currency: args.currency,
        merchant_note: args.reason ?? "Refund requested",
      },
    });
    return parseRefundResponse(res.data);
  },

  async retryRefund(
    args: RetryRefundArgs,
  ): Promise<InitiateRefundResult> {
    // Paystack's retry endpoint expects its numeric bank id, while the rest of
    // our system stores the bank code.
    const banks = await psRequest<PsEnvelope<PsBank[]>>({
      method: "GET",
      path: "/bank",
      query: { country: "nigeria", perPage: 1000 },
    });
    const bank = (banks.data?.data ?? []).find(
      (item) => item?.code === args.bankCode,
    );
    if (!bank?.id) {
      throw new GatewayError(
        "paystack",
        `Unknown Paystack bank id for bank code ${args.bankCode}`,
      );
    }

    const res = await psRequest<PsEnvelope<PsRefund>>({
      method: "POST",
      path: `/refund/retry_with_customer_details/${encodeURIComponent(args.gatewayRefundId)}`,
      body: {
        refund_account_details: {
          currency: args.currency,
          account_number: args.accountNumber,
          bank_id: String(bank.id),
        },
      },
    });
    return parseRefundResponse(res.data);
  },

  verifyWebhookSignature(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): boolean {
    return verifyPaystackSignature(rawBody, headers);
  },

  parseWebhookEvent(payload: unknown): NormalizedEvent | null {
    return parsePaystackEvent(payload);
  },
  async verifyPayment(reference: string): Promise<VerifiedPayment | null> {
    const res = await psRequest<
      PsEnvelope<{
        id: number;
        status: string;
        amount: number;
        fees: number | null;
        currency: string;
        paid_at: string | null;
      }>
    >({
      method: "GET",
      path: `/transaction/verify/${encodeURIComponent(reference)}`,
    });
    const d = res.data?.data;
    if (!d) return null;
    const status: VerifiedPayment["status"] =
      d.status === "success" ? "success" : d.status === "failed" ? "failed" : "pending";
    return {
      status,
      gatewayId: String(d.id),
      amountPaidMinor: d.amount,
      gatewayFeeMinor: d.fees ?? 0,
      currency: d.currency,
      paidAt: d.paid_at ? new Date(d.paid_at) : null,
    };
  },
};