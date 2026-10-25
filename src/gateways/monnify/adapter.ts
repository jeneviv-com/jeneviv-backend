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
import { env } from "../../env.js";
import { GatewayError } from "../types.js";
import { monnifyRequest, verifyMonnifySignature } from "./client.js";

interface MonnifyAccount {
  bankCode: string;
  bankName: string;
  accountNumber: string;
}

interface MonnifyReservedAccount {
  accountReference: string;
  accountName: string;
  accounts?: MonnifyAccount[];
}

interface MonnifyTransfer {
  reference: string;
  status?: string;
  transactionReference?: string;
}

interface MonnifyValidation {
  accountNumber: string;
  accountName: string;
  bankCode: string;
}

interface MonnifyBank {
  code: string;
  name: string;
}

const TRANSFER_STATUS: Record<string, InitiateTransferResult["status"]> = {
  SUCCESS: "success",
  COMPLETED: "success",
  FAILED: "failed",
  REVERSED: "failed",
  EXPIRED: "failed",
  PENDING: "pending",
  IN_PROGRESS: "pending",
  AWAITING_PROCESSING: "pending",
  PENDING_AUTHORIZATION: "pending",
};

function toMinor(amount: number): number {
  return Math.round(amount * 100);
}

export const monnifyAdapter: PaymentGateway = {
  name: "monnify",
  usesCustomerForVirtualAccount: false,

  async ensureCustomer(_args: EnsureCustomerArgs): Promise<{ customerId: string }> {
    return { customerId: "" };
  },

  async createVirtualAccount(
    args: CreateVirtualAccountArgs,
  ): Promise<CreateVirtualAccountResult> {
    if (!args.customerNin) {
      throw new GatewayError(
        "monnify",
        "customerNin is required to reserve a Monnify account",
      );
    }
    const account = await monnifyRequest<MonnifyReservedAccount>({
      method: "POST",
      path: "/api/v2/bank-transfer/reserved-accounts",
      body: {
        accountReference: args.reference,
        accountName: args.narration.slice(0, 100),
        currencyCode: args.currency,
        contractCode: env.MONNIFY_CONTRACT_CODE,
        customerEmail: args.customerEmail,
        customerName: args.customerName ?? args.narration,
        customerNin: args.customerNin,
        getAllAvailableBanks: true,
      },
    });
    const first = account.accounts?.[0];
    if (!first) {
      throw new GatewayError(
        "monnify",
        "Reserved account response contained no bank account",
      );
    }
    return {
      gatewayAccountId: account.accountReference,
      accountNumber: first.accountNumber,
      accountName: account.accountName,
      bankCode: first.bankCode,
      bankName: first.bankName,
      expiryAt: new Date(Date.now() + args.expirySeconds * 1000),
      totalCharged: args.amount,
    };
  },

  async resolveAccountName({
    bankCode,
    accountNumber,
  }: ResolveAccountNameArgs): Promise<{ accountName: string }> {
    const result = await monnifyRequest<MonnifyValidation>({
      method: "GET",
      path: "/api/v1/disbursements/account/validate",
      query: { accountNumber, bankCode },
    });
    if (!result?.accountName) {
      throw new GatewayError("monnify", "Account validation returned no name");
    }
    return { accountName: result.accountName };
  },

  async listBanks(): Promise<BankSummary[]> {
    const banks = await monnifyRequest<MonnifyBank[]>({
      method: "GET",
      path: "/api/v1/banks",
    });
    if (!Array.isArray(banks)) {
      throw new GatewayError("monnify", "Banks response is not an array");
    }
    return banks
      .filter((bank) => bank?.code && bank?.name)
      .map((bank) => ({ code: bank.code, name: bank.name }));
  },

  async initiateTransfer(
    args: InitiateTransferArgs,
  ): Promise<InitiateTransferResult> {
    if (!env.MONNIFY_WALLET_ACCOUNT_NUMBER) {
      throw new GatewayError(
        "monnify",
        "MONNIFY_WALLET_ACCOUNT_NUMBER must be set",
      );
    }
    const result = await monnifyRequest<MonnifyTransfer>({
      method: "POST",
      path: "/api/v2/disbursements/single",
      body: {
        amount: args.amount / 100,
        reference: args.reference,
        narration: args.narration,
        destinationBankCode: args.bankCode,
        destinationAccountNumber: args.accountNumber,
        destinationAccountName: args.accountName ?? args.narration,
        currency: args.currency,
        sourceAccountNumber: env.MONNIFY_WALLET_ACCOUNT_NUMBER,
        async: false,
      },
    });
    const status = TRANSFER_STATUS[(result?.status ?? "").toUpperCase()] ?? "pending";
    return {
      gatewayTxId: result?.transactionReference ?? result?.reference ?? args.reference,
      status,
    };
  },

  async initiateRefund(
    _args: InitiateRefundArgs,
  ): Promise<InitiateRefundResult> {
    throw new GatewayError("monnify", "Monnify refunds are not enabled");
  },

  verifyWebhookSignature(rawBody, headers): boolean {
    return verifyMonnifySignature(rawBody, headers);
  },

  parseWebhookEvent(payload: unknown): NormalizedEvent | null {
    if (!payload || typeof payload !== "object") return null;
    const root = payload as {
      eventType?: string;
      eventData?: Record<string, unknown>;
    };
    const data = root.eventData ?? {};
    const eventType = (root.eventType ?? "").toUpperCase();

    if (eventType === "SUCCESSFUL_TRANSACTION") {
      const reference = String(
        data.accountReference ?? data.paymentReference ?? data.transactionReference ?? "",
      );
      if (!reference) return null;
      return {
        type: "charge.success",
        gatewayId: String(data.transactionReference ?? data.paymentReference ?? reference),
        reference,
        amountPaid: toMinor(Number(data.amountPaid ?? 0)),
        gatewayFee: toMinor(Number(data.totalPayable ? 0 : 0)),
        currency: String(data.currency ?? "NGN"),
        paidAt: data.paidOn ? new Date(String(data.paidOn)) : new Date(),
        raw: payload,
      };
    }

    if (eventType === "FAILED_TRANSACTION" || eventType === "REJECTED_PAYMENT") {
      const reference = String(
        data.accountReference ?? data.paymentReference ?? data.transactionReference ?? "",
      );
      if (!reference) return null;
      return {
        type: "charge.failed",
        gatewayId: String(data.transactionReference ?? reference),
        reference,
        reason: String(data.paymentDescription ?? "Payment failed"),
        raw: payload,
      };
    }

    if (
      eventType === "SUCCESSFUL_DISBURSEMENT" ||
      eventType === "FAILED_DISBURSEMENT" ||
      eventType === "REVERSED_DISBURSEMENT"
    ) {
      const reference = String(data.reference ?? "");
      if (!reference) return null;
      const success = eventType === "SUCCESSFUL_DISBURSEMENT";
      return success
        ? {
            type: "transfer.completed",
            gatewayId: String(data.transactionReference ?? reference),
            reference,
            raw: payload,
          }
        : {
            type: "transfer.failed",
            gatewayId: String(data.transactionReference ?? reference),
            reference,
            reason: String(data.status ?? eventType),
            raw: payload,
          };
    }

    return null;
  },
};
