/**
 * Human-facing facts about each payment gateway. Pages and receipts read these
 * instead of naming a gateway in copy, so switching DEFAULT_GATEWAY changes
 * the wording everywhere at once.
 */
export interface GatewayInfo {
  name: string;
  label: string;
  /**
   * True when the gateway splits each payment to the merchant's bank as it is
   * captured. Otherwise funds land in the Jeneviv wallet and leave on payouts.
   */
  settlesDirect: boolean;
}

const LABELS: Record<string, string> = {
  paystack: "Paystack",
  flutterwave: "Flutterwave",
  paga: "Paga",
  monnify: "Monnify",
};

export function gatewayInfo(name: string | null | undefined): GatewayInfo {
  const key = (name ?? "").trim().toLowerCase();
  return {
    name: key,
    label: LABELS[key] ?? (key ? key[0]!.toUpperCase() + key.slice(1) : "our payment partner"),
    // Mirrors `holdsFunds = tx.gateway !== "paystack"` in the webhook handler.
    settlesDirect: key === "paystack",
  };
}
