import { env } from "../env.js";
import { toMinor } from "./money.js";

export interface FeeBreakdown {
  amount: number;
  platformFee: number;
  gatewayFee: number;
  total: number;
}

export function platformFeeMinor(currency: string): number {
  if (currency === "NGN") {
    return toMinor(env.PLATFORM_FEE_NGN, "NGN");
  }
  return 0;
}

export function computeTotalCharge(args: {
  amount: number;
  currency: string;
  gatewayFee?: number;
}): FeeBreakdown {
  const platformFee = platformFeeMinor(args.currency);
  const gatewayFee = args.gatewayFee ?? 0;
  return {
    amount: args.amount,
    platformFee,
    gatewayFee,
    total: args.amount + platformFee + gatewayFee,
  };
}
