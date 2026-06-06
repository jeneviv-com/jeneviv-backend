import { env } from "../env.js";
import { flutterwaveAdapter } from "./flutterwave/adapter.js";
import { paystackAdapter } from "./paystack/adapter.js";
import type { GatewayName, PaymentGateway } from "./types.js";

const adapters: Record<GatewayName, PaymentGateway | undefined> = {
  flutterwave: flutterwaveAdapter,
  paystack: paystackAdapter,
  monnify: undefined,
};

export function getGateway(name: string): PaymentGateway {
  const adapter = adapters[name as GatewayName];
  if (!adapter) {
    throw new Error(`Unknown or unconfigured gateway: ${name}`);
  }
  return adapter;
}

export function getDefaultGateway(): PaymentGateway {
  return getGateway(env.DEFAULT_GATEWAY);
}
