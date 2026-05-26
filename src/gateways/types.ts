export type GatewayName = "flutterwave" | "paystack" | "monnify";

export interface EnsureCustomerArgs {
  uid: string;
  email: string;
  name: string;
}

export interface CreateVirtualAccountArgs {
  reference: string;
  customerId: string;
  amount: number;
  currency: string;
  narration: string;
  expirySeconds: number;
}

export interface CreateVirtualAccountResult {
  gatewayAccountId: string;
  accountNumber: string;
  accountName: string;
  bankCode: string;
  bankName: string;
  expiryAt: Date;
}

export interface ResolveAccountNameArgs {
  bankCode: string;
  accountNumber: string;
  currency: string;
}

export interface InitiateTransferArgs {
  reference: string;
  amount: number;
  currency: string;
  bankCode: string;
  accountNumber: string;
  narration: string;
}

export interface InitiateTransferResult {
  gatewayTxId: string;
  status: "pending" | "success" | "failed";
}

export interface InitiateRefundArgs {
  reference: string;
  chargeId: string;
  amount: number;
  currency: string;
  reason?: string;
}

export interface InitiateRefundResult {
  gatewayRefundId: string;
  status: "pending" | "success" | "failed";
}

export interface BankSummary {
  code: string;
  name: string;
}

export type NormalizedEvent =
  | {
      type: "charge.success";
      gatewayId: string;
      reference: string;
      amountPaid: number;
      gatewayFee: number;
      currency: string;
      paidAt: Date;
      raw: unknown;
    }
  | {
      type: "charge.failed";
      gatewayId: string;
      reference: string;
      reason: string;
      raw: unknown;
    }
  | {
      type: "transfer.completed";
      gatewayId: string;
      reference: string;
      raw: unknown;
    }
  | {
      type: "transfer.failed";
      gatewayId: string;
      reference: string;
      reason: string;
      raw: unknown;
    }
  | {
      type: "refund.completed";
      gatewayId: string;
      reference: string;
      raw: unknown;
    }
  | {
      type: "refund.failed";
      gatewayId: string;
      reference: string;
      reason: string;
      raw: unknown;
    };

export interface PaymentGateway {
  readonly name: GatewayName;

  ensureCustomer(args: EnsureCustomerArgs): Promise<{ customerId: string }>;

  createVirtualAccount(
    args: CreateVirtualAccountArgs,
  ): Promise<CreateVirtualAccountResult>;

  resolveAccountName(
    args: ResolveAccountNameArgs,
  ): Promise<{ accountName: string }>;

  listBanks(country: string): Promise<BankSummary[]>;

  initiateTransfer(args: InitiateTransferArgs): Promise<InitiateTransferResult>;

  initiateRefund(args: InitiateRefundArgs): Promise<InitiateRefundResult>;

  verifyWebhookSignature(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): boolean;

  parseWebhookEvent(payload: unknown): NormalizedEvent | null;
}

export class GatewayError extends Error {
  readonly gateway: GatewayName;
  readonly status?: number;
  readonly raw?: unknown;

  constructor(
    gateway: GatewayName,
    message: string,
    options: { status?: number; raw?: unknown; cause?: unknown } = {},
  ) {
    super(message);
    this.gateway = gateway;
    this.status = options.status;
    this.raw = options.raw;
    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}
