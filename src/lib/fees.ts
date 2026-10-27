import { env } from "../env.js";

/*
 * Units: every amount in this file is WHOLE NAIRA, the same unit collection
 * amounts are stored in. Paystack works in kobo, so convert with toMinor() only
 * at the point where the request is sent to Paystack. Do not mix the two.
 */

export interface FeeBreakdown {
  amount: number; // collection amount, naira
  platformFee: number; // Jeneviv's fee, naira
  gatewayFee: number; // Paystack's processing fee, naira (paid by the payer)
  total: number; // what the payer is charged, naira
}

/* ------------------------------------------------------------------ platform */

/*
 * Platform fee, by collection amount (naira):
 *   up to N7,500   -> flat fee (PLATFORM_FEE_NGN, default N75)
 *   above N7,500   -> 1% of the amount, never below the flat fee
 *   capped at      -> N1,000
 */
export const PLATFORM_FEE_FLAT_THRESHOLD_NGN = 7_500;
export const PLATFORM_FEE_PERCENT_BASIS_POINTS = 100; // 1%
export const PLATFORM_FEE_CAP_NGN = 1_000;

export function platformFeeNgn(amountNgn: number): number {
  const flat = env.PLATFORM_FEE_NGN;
  if (amountNgn <= PLATFORM_FEE_FLAT_THRESHOLD_NGN) return flat;
  const percent = Math.round((amountNgn * PLATFORM_FEE_PERCENT_BASIS_POINTS) / 10_000);
  return Math.min(PLATFORM_FEE_CAP_NGN, Math.max(flat, percent));
}

/* ------------------------------------------------------------------ Paystack */

/*
 * Paystack Nigeria local pricing, in naira.
 * 1.5% of the charge, plus N100 on charges of N2,500 and above.
 * The N2,000 cap is NOT verified. Confirm all of these on Paystack's current
 * pricing page before going live, then update the constants below.
 */
export const PAYSTACK_PERCENT_BASIS_POINTS = 150; // 1.5%
export const PAYSTACK_FLAT_NGN = 100;
export const PAYSTACK_FLAT_APPLIES_FROM_NGN = 2_500;
export const PAYSTACK_CAP_NGN = 2_000; // unverified

/*
 * TEST SWITCH. false = send only collection + platform fee and let Paystack
 * apply its own fee. true = Jeneviv adds Paystack's fee to the payer's charge.
 * Leave false until a test payment shows how Paystack behaves.
 */
export const PAYSTACK_GROSS_UP = false;

export function paystackFeeNgn(chargeNgn: number): number {
  const percent = Math.ceil((chargeNgn * PAYSTACK_PERCENT_BASIS_POINTS) / 10_000);
  const flat = chargeNgn >= PAYSTACK_FLAT_APPLIES_FROM_NGN ? PAYSTACK_FLAT_NGN : 0;
  return Math.min(PAYSTACK_CAP_NGN, percent + flat);
}

/**
 * When PAYSTACK_GROSS_UP is true, the payer covers Paystack's processing fee.
 *
 * The merchant receives exactly the collection amount, Jeneviv keeps its
 * platform fee, and the processing fee is added to the payer's charge. The fee
 * depends on the total it is added to, so the value is solved by iteration.
 */
export function computeCharge(amountNgn: number, gateway: "paystack" | "other"): FeeBreakdown {
  const platformFee = platformFeeNgn(amountNgn);
  const base = amountNgn + platformFee;

  if (gateway !== "paystack" || !PAYSTACK_GROSS_UP) {
    return { amount: amountNgn, platformFee, gatewayFee: 0, total: base };
  }

  let gatewayFee = 0;
  for (let i = 0; i < 10; i += 1) {
    const next = paystackFeeNgn(base + gatewayFee);
    if (next === gatewayFee) break;
    gatewayFee = next;
  }

  return {
    amount: amountNgn,
    platformFee,
    gatewayFee,
    total: base + gatewayFee,
  };
}
