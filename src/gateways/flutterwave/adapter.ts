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
} from "../types.js";
import { GatewayError } from "../types.js";
import { fwRequest } from "./client.js";
import {
  parseFlutterwaveEvent,
  verifyFlutterwaveSignature,
} from "./webhook.js";

interface FwEnvelope<T> {
  status?: string;
  message?: string;
  data: T;
}

interface FwCustomer {
  id: string;
  email: string;
}

interface FwVirtualAccount {
  id: string;
  account_number: string;
  account_bank_name?: string;
  account_expiration_datetime: string;
  customer_id: string;
  currency: string;
  status: string;
  reference: string;
  note?: string;
}

interface FwBank {
  id?: string;
  code: string;
  name: string;
}

interface FwAccountResolve {
  bank_code: string;
  account_number: string;
  account_name: string;
}

interface FwTransfer {
  id: string;
  reference: string;
  status: string;
}

interface FwRefund {
  id: string;
  reference?: string;
  status?: string;
}

function randomId(prefix: string): string {
  const rand = Math.random().toString(16).slice(2).padEnd(12, "0").slice(0, 12);
  return `${prefix}_${Date.now().toString(16)}${rand}`;
}

const TRANSFER_STATUS_MAP: Record<string, InitiateTransferResult["status"]> = {
  NEW: "pending",
  PENDING: "pending",
  PROCESSING: "pending",
  QUEUED: "pending",
  SUCCESSFUL: "success",
  SUCCESS: "success",
  COMPLETED: "success",
  FAILED: "failed",
  ERROR: "failed",
};

const REFUND_STATUS_MAP: Record<string, InitiateRefundResult["status"]> = {
  NEW: "pending",
  PENDING: "pending",
  PROCESSING: "pending",
  QUEUED: "pending",
  SUCCEEDED: "success",
  SUCCESSFUL: "success",
  SUCCESS: "success",
  COMPLETED: "success",
  FAILED: "failed",
  ERROR: "failed",
};

export const flutterwaveAdapter: PaymentGateway = {
  name: "flutterwave",
  usesCustomerForVirtualAccount: true,

  async ensureCustomer({
    email,
  }: EnsureCustomerArgs): Promise<{ customerId: string }> {
    const res = await fwRequest<FwEnvelope<FwCustomer>>({
      method: "POST",
      path: "/customers",
      body: { email },
    });
    const id = res.data?.data?.id;
    if (!id) {
      throw new GatewayError("flutterwave", "Customer create response missing id", {
        raw: res.data,
      });
    }
    return { customerId: id };
  },

  async createVirtualAccount(
    args: CreateVirtualAccountArgs,
  ): Promise<CreateVirtualAccountResult> {
    const body = {
      currency: args.currency,
      account_type: "dynamic",
      reference: args.reference,
      amount: toMajor(args.amount, args.currency),
      customer_id: args.customerId,
      narration: args.narration,
      expiry: args.expirySeconds,
      bank_code: env.FLUTTERWAVE_VIRTUAL_ACCOUNT_BANK_CODE,
    };

    const res = await fwRequest<FwEnvelope<FwVirtualAccount>>({
      method: "POST",
      path: "/virtual-accounts",
      body,
    });

    const va = res.data?.data;
    if (!va?.account_number || !va.id) {
      throw new GatewayError("flutterwave", "Virtual account response malformed", {
        raw: res.data,
      });
    }

    const expiryAt = new Date(va.account_expiration_datetime);
    return {
      gatewayAccountId: va.id,
      accountNumber: va.account_number,
      accountName: va.note ?? args.narration,
      bankCode: env.FLUTTERWAVE_VIRTUAL_ACCOUNT_BANK_CODE,
      bankName: va.account_bank_name ?? "Indulge MFB",
      expiryAt,
      totalCharged: args.amount,
    };
  },

  async resolveAccountName({
    bankCode,
    accountNumber,
    currency,
  }: ResolveAccountNameArgs): Promise<{ accountName: string }> {
    const res = await fwRequest<FwEnvelope<FwAccountResolve>>({
      method: "POST",
      path: "/banks/account-resolve",
      body: {
        currency,
        account: { code: bankCode, number: accountNumber },
      },
    });
    const name = res.data?.data?.account_name;
    if (!name) {
      throw new GatewayError("flutterwave", "Account resolve response missing name", {
        raw: res.data,
      });
    }
    return { accountName: name };
  },

  async listBanks(country: string): Promise<BankSummary[]> {
    const res = await fwRequest<FwEnvelope<FwBank[]>>({
      method: "GET",
      path: "/banks",
      query: { country },
    });
    const banks = res.data?.data;
    if (!Array.isArray(banks)) {
      throw new GatewayError("flutterwave", "Banks response is not an array", {
        raw: res.data,
      });
    }
    return banks
      .filter((b) => b && b.code && b.name)
      .map((b) => ({ code: b.code, name: b.name }));
  },

  async initiateTransfer(
    args: InitiateTransferArgs,
  ): Promise<InitiateTransferResult> {
    const res = await fwRequest<FwEnvelope<FwTransfer>>({
      method: "POST",
      path: "/direct-transfers",
      headers: {
        "X-Trace-Id": randomId("trace"),
        "X-Idempotency-Key": args.reference,
      },
      body: {
        action: "instant",
        type: "bank",
        callback_url: "",
        narration: args.narration,
        reference: args.reference,
        payment_instruction: {
          amount: {
            value: toMajor(args.amount, args.currency),
            applies_to: "destination_currency",
          },
          source_currency: args.currency,
          destination_currency: args.currency,
          recipient: {
            bank: { code: args.bankCode, account_number: args.accountNumber },
          },
        },
      },
    });

    const transfer = res.data?.data;
    if (!transfer?.id) {
      throw new GatewayError("flutterwave", "Transfer response missing id", {
        raw: res.data,
      });
    }

    const status =
      TRANSFER_STATUS_MAP[(transfer.status ?? "").toUpperCase()] ?? "pending";
    return { gatewayTxId: transfer.id, status };
  },

  async initiateRefund(
    args: InitiateRefundArgs,
  ): Promise<InitiateRefundResult> {
    const res = await fwRequest<FwEnvelope<FwRefund>>({
      method: "POST",
      path: "/refunds",
      headers: {
        "X-Idempotency-Key": args.reference,
      },
      body: {
        charge_id: args.chargeId,
        amount: toMajor(args.amount, args.currency),
        currency: args.currency,
        reason: "requested_by_customer",
      },
    });
    const refund = res.data?.data;
    if (!refund?.id) {
      throw new GatewayError("flutterwave", "Refund response missing id", {
        raw: res.data,
      });
    }
    const status =
      REFUND_STATUS_MAP[(refund.status ?? "").toUpperCase()] ?? "pending";
    return { gatewayRefundId: refund.id, status };
  },

  verifyWebhookSignature(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): boolean {
    return verifyFlutterwaveSignature(rawBody, headers);
  },

  parseWebhookEvent(payload: unknown): NormalizedEvent | null {
    const event = parseFlutterwaveEvent(payload);
    if (!event) return event;
    if (event.type === "charge.success") {
      return {
        ...event,
        amountPaid: toMinor(event.amountPaid, event.currency),
        gatewayFee: toMinor(event.gatewayFee, event.currency),
      };
    }
    return event;
  },
};
