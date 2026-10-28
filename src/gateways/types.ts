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
  /** Payer email — required by gateways that charge by email (Paystack). */
  customerEmail?: string;
  customerName?: string;
  /** Monnify reserved accounts require the payer's NIN. */
  customerNin?: string;
  /** Merchant split destination (Paystack subaccount code). */
  subaccountCode?: string;
  /** Flat platform charge taken from the split, in minor units. */
  platformFeeMinor?: number;
}

export interface CreateVirtualAccountResult {
  gatewayAccountId: string;
  accountNumber: string;
  accountName: string;
  bankCode: string;
  bankName: string;
  expiryAt: Date;
  /**
   * Actual amount the customer must pay, in minor units. For split gateways
   * (Paystack) this is grossed up above `amount` to cover the gateway fee.
   */
  totalCharged: number;
}

export interface EnsureSubaccountArgs {
  businessName: string;
  bankCode: string;
  accountNumber: string;
  /** Percentage the platform takes per transaction; 0 when using flat splits. */
  percentageCharge?: number;
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
  /** Beneficiary name for gateways that validate it (Monnify). */
  accountName?: string;
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

export interface RetryRefundArgs {
  /** Gateway-side refund id (not our reference). */
  gatewayRefundId: string;
  accountNumber: string;
  bankCode: string;
  currency: string;
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
      gatewayRefundId?: string;
      raw: unknown;
    }
  | {
      type: "refund.failed";
      gatewayId: string;
      reference: string;
      gatewayRefundId?: string;
      reason: string;
      raw: unknown;
    }
  | {
      type: "refund.needs_attention";
      gatewayId: string;
      reference: string;
      gatewayRefundId?: string;
      reason?: string;
      raw: unknown;
    };

export interface PaymentGateway {
  readonly name: GatewayName;

  /**
   * Whether a gateway customer must be created before a virtual account
   * (Flutterwave). Paystack charges by payer email, so this is false there.
   */
  readonly usesCustomerForVirtualAccount: boolean;

  ensureCustomer(args: EnsureCustomerArgs): Promise<{ customerId: string }>;

  createVirtualAccount(
    args: CreateVirtualAccountArgs,
  ): Promise<CreateVirtualAccountResult>;

  /** Create a merchant split destination. Only split gateways implement this. */
  ensureSubaccount?(
    args: EnsureSubaccountArgs,
  ): Promise<{ subaccountCode: string }>;

  resolveAccountName(
    args: ResolveAccountNameArgs,
  ): Promise<{ accountName: string }>;

  listBanks(country: string): Promise<BankSummary[]>;

  initiateTransfer(args: InitiateTransferArgs): Promise<InitiateTransferResult>;

  initiateRefund(args: InitiateRefundArgs): Promise<InitiateRefundResult>;

  /**
   * Supply payer bank details for a refund the gateway could not route
   * (`needs-attention`). Only split gateways that expose this implement it.
   */
  retryRefund?(args: RetryRefundArgs): Promise<InitiateRefundResult>;

  /**
   * Asks the gateway for the current state of a payment. Used by the
   * reconciliation job to catch payments whose webhook never arrived.
   */
  verifyPayment?(reference: string): Promise<VerifiedPayment | null>;

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

export interface VerifiedPayment {
  status: "pending" | "success" | "failed";
  gatewayId: string;
  /** Amount the gateway received, in minor units. */
  amountPaidMinor: number;
  /** Gateway fee, in minor units. */
  gatewayFeeMinor: number;
  currency: string;
  paidAt: Date | null;
}