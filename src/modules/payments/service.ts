import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import type { User } from "../../db/schema/auth.js";
import {
  collectionFields,
  collections,
  customerFields,
  type Collection,
  type CollectionField,
} from "../../db/schema/collections.js";
import type { CollectionFieldType } from "../../db/schema/enums.js";
import { merchants, type Merchant } from "../../db/schema/merchants.js";
import {
  paymentAccounts,
  transactionFields,
  transactions,
  type PaymentAccount,
  type Transaction,
} from "../../db/schema/transactions.js";
import { env } from "../../env.js";
import { getDefaultGateway } from "../../gateways/registry.js";
import { GatewayError } from "../../gateways/types.js";
import { isCloudinaryUrlOnOurCloud } from "../../lib/cloudinary.js";
import { computeTotalCharge } from "../../lib/fees.js";
import { newId } from "../../lib/short-code.js";
import { HttpError } from "../../middleware/error.js";
import type { InitPaymentInput } from "./schemas.js";

const REFERENCE_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function newReference(): string {
  let out = "txn";
  for (let i = 0; i < 24; i++) {
    out += REFERENCE_ALPHABET[Math.floor(Math.random() * REFERENCE_ALPHABET.length)];
  }
  return out;
}

function coerceFieldValue(field: CollectionField, raw: unknown): string {
  if (raw === undefined || raw === null) {
    if (field.required) {
      throw new HttpError(
        422,
        "field_required",
        `Field "${field.fieldId}" is required`,
      );
    }
    return "";
  }

  switch (field.type as CollectionFieldType) {
    case "number": {
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(n)) {
        throw new HttpError(
          422,
          "invalid_field",
          `Field "${field.fieldId}" must be a number`,
        );
      }
      return String(n);
    }
    case "select": {
      const str = String(raw);
      const opts = (field.options as string[] | null) ?? [];
      if (!opts.includes(str)) {
        throw new HttpError(
          422,
          "invalid_field",
          `Field "${field.fieldId}" must be one of: ${opts.join(", ")}`,
        );
      }
      return str;
    }
    case "multiselect": {
      const arr = Array.isArray(raw) ? raw : [raw];
      const opts = (field.options as string[] | null) ?? [];
      const picked: string[] = [];
      for (const item of arr) {
        const s = String(item);
        if (!opts.includes(s)) {
          throw new HttpError(
            422,
            "invalid_field",
            `Field "${field.fieldId}" contains invalid option: ${s}`,
          );
        }
        picked.push(s);
      }
      if (field.required && picked.length === 0) {
        throw new HttpError(
          422,
          "field_required",
          `Field "${field.fieldId}" requires at least one selection`,
        );
      }
      return JSON.stringify(picked);
    }
    case "email": {
      const str = String(raw).trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str)) {
        throw new HttpError(
          422,
          "invalid_field",
          `Field "${field.fieldId}" must be a valid email`,
        );
      }
      return str;
    }
    case "date": {
      const str = String(raw).trim();
      const d = new Date(str);
      if (Number.isNaN(d.getTime())) {
        throw new HttpError(
          422,
          "invalid_field",
          `Field "${field.fieldId}" must be a valid date`,
        );
      }
      return str;
    }
    case "image":
    case "file": {
      const str = String(raw).trim();
      if (!str) {
        if (field.required) {
          throw new HttpError(
            422,
            "field_required",
            `Field "${field.fieldId}" is required`,
          );
        }
        return "";
      }
      if (!isCloudinaryUrlOnOurCloud(str)) {
        throw new HttpError(
          422,
          "invalid_field",
          `Field "${field.fieldId}" must be a Cloudinary URL on our cloud (use POST /api/uploads/sign first)`,
        );
      }
      return str;
    }
    default: {
      const str = String(raw).trim();
      if (field.required && str.length === 0) {
        throw new HttpError(
          422,
          "field_required",
          `Field "${field.fieldId}" is required`,
        );
      }
      return str;
    }
  }
}

async function ensureGatewayCustomerForMerchant(
  merchant: Merchant,
  ownerEmail: string,
  ownerName: string,
): Promise<string> {
  const gateway = getDefaultGateway();
  const existing = merchant.gatewayCustomerIds?.[gateway.name];
  if (existing) return existing;

  try {
    const { customerId } = await gateway.ensureCustomer({
      uid: merchant.userId,
      email: ownerEmail,
      name: ownerName,
    });
    await db
      .update(merchants)
      .set({
        gatewayCustomerIds: sql`jsonb_set(${merchants.gatewayCustomerIds}, ${`{${gateway.name}}`}, ${`"${customerId}"`}::jsonb, true)`,
        updatedAt: new Date(),
      })
      .where(eq(merchants.id, merchant.id));
    return customerId;
  } catch (err) {
    if (err instanceof GatewayError) {
      throw new HttpError(
        502,
        "gateway_error",
        `Failed to ensure gateway customer: ${err.message}`,
      );
    }
    throw err;
  }
}

export interface InitPaymentResult {
  transaction: Transaction;
  payment_account: PaymentAccount;
  breakdown: {
    amount: number;
    platform_fee: number;
    gateway_fee: number;
    total_charged: number;
    currency: string;
  };
}

export async function initPayment(
  user: User,
  input: InitPaymentInput,
): Promise<InitPaymentResult> {
  const collection = await db.query.collections.findFirst({
    where: eq(collections.shortCode, input.collection_short_code),
  });
  if (!collection || !collection.isActive) {
    throw new HttpError(404, "not_found", "Collection not found");
  }

  const fields = await db.query.collectionFields.findMany({
    where: eq(collectionFields.collectionId, collection.id),
    orderBy: [asc(collectionFields.position), asc(collectionFields.fieldId)],
  });

  const merchant = await db.query.merchants.findFirst({
    where: eq(merchants.id, collection.merchantId),
  });
  if (!merchant || merchant.status !== "approved") {
    throw new HttpError(
      403,
      "merchant_unavailable",
      "Merchant is not currently accepting payments",
    );
  }

  const merchantUser = await db.query.users.findFirst({
    where: (u, { eq: eqf }) => eqf(u.id, merchant.userId),
  });
  if (!merchantUser) {
    throw new HttpError(500, "internal_error", "Merchant owner missing");
  }

  const collectionForResult = collection as Collection;
  const breakdown = computeTotalCharge({
    amount: collectionForResult.amount,
    currency: collectionForResult.currency,
  });

  const validatedValues: Array<{
    fieldId: string;
    displayName: string;
    type: CollectionFieldType;
    value: string;
  }> = [];
  for (const f of fields) {
    const raw = (input.field_values as Record<string, unknown>)[f.fieldId];
    const value = coerceFieldValue(f, raw);
    if (value !== "") {
      validatedValues.push({
        fieldId: f.fieldId,
        displayName: f.displayName,
        type: f.type as CollectionFieldType,
        value,
      });
    }
  }

  const gateway = getDefaultGateway();

  let subaccountCode: string | undefined;
  if (gateway.ensureSubaccount) {
    subaccountCode = merchant.gatewaySubaccountIds?.[gateway.name];
    if (!subaccountCode) {
      throw new HttpError(
        403,
        "merchant_not_onboarded",
        "Merchant has not completed payout setup",
      );
    }
  }

  const customerId = gateway.usesCustomerForVirtualAccount
    ? await ensureGatewayCustomerForMerchant(
        merchant,
        merchantUser.email,
        merchantUser.name,
      )
    : "";

  const reference = newReference();
  const narration = `${merchant.displayName ?? "Jeneviv"} - ${collectionForResult.name}`.slice(
    0,
    100,
  );

  let virtualAccount;
  try {
    virtualAccount = await gateway.createVirtualAccount({
      reference,
      customerId,
      customerEmail: user.email,
      customerName: user.name,
      amount: breakdown.total,
      currency: collectionForResult.currency,
      narration,
      expirySeconds: env.VIRTUAL_ACCOUNT_EXPIRY_SECONDS,
      subaccountCode,
      platformFeeMinor: breakdown.platformFee,
    });
  } catch (err) {
    if (err instanceof GatewayError) {
      throw new HttpError(
        502,
        "gateway_error",
        `Failed to create virtual account: ${err.message}`,
      );
    }
    throw err;
  }

  // Split gateways (Paystack) gross up the customer charge to cover their fee,
  // so the real gateway fee is only known once the account is created.
  const totalCharged = virtualAccount.totalCharged;
  const gatewayFee = Math.max(
    0,
    totalCharged - (breakdown.amount + breakdown.platformFee),
  );

  const txId = newId();
  const accountId = newId();
  const now = new Date();

  return db.transaction(async (tx) => {
    const [createdTx] = await tx
      .insert(transactions)
      .values({
        id: txId,
        reference,
        customerId: user.id,
        merchantId: merchant.id,
        collectionId: collectionForResult.id,
        status: "pending",
        amount: breakdown.amount,
        platformFee: breakdown.platformFee,
        gatewayFee,
        totalCharged,
        currency: collectionForResult.currency,
        gateway: gateway.name,
        paymentAccountId: accountId,
      })
      .returning();
    if (!createdTx) {
      throw new HttpError(500, "internal_error", "Failed to create transaction");
    }

    if (validatedValues.length > 0) {
      await tx.insert(transactionFields).values(
        validatedValues.map((v) => ({
          id: newId(),
          transactionId: txId,
          fieldId: v.fieldId,
          displayName: v.displayName,
          value: v.value,
        })),
      );

      await tx
        .insert(customerFields)
        .values(
          validatedValues.map((v) => ({
            id: newId(),
            userId: user.id,
            fieldId: v.fieldId,
            displayName: v.displayName,
            type: v.type,
            value: v.value,
            lastUsedAt: now,
          })),
        )
        .onConflictDoUpdate({
          target: [customerFields.userId, customerFields.fieldId],
          set: {
            value: sql`excluded.value`,
            displayName: sql`excluded.display_name`,
            type: sql`excluded.type`,
            lastUsedAt: now,
          },
        });
    }

    const [createdAccount] = await tx
      .insert(paymentAccounts)
      .values({
        id: accountId,
        transactionId: txId,
        forUserId: user.id,
        gateway: gateway.name,
        gatewayAccountId: virtualAccount.gatewayAccountId,
        accountNumber: virtualAccount.accountNumber,
        accountName: virtualAccount.accountName,
        bankCode: virtualAccount.bankCode,
        bankName: virtualAccount.bankName,
        currency: collectionForResult.currency,
        expiryAt: virtualAccount.expiryAt,
      })
      .returning();
    if (!createdAccount) {
      throw new HttpError(500, "internal_error", "Failed to record payment account");
    }

    return {
      transaction: createdTx,
      payment_account: createdAccount,
      breakdown: {
        amount: breakdown.amount,
        platform_fee: breakdown.platformFee,
        gateway_fee: gatewayFee,
        total_charged: totalCharged,
        currency: collectionForResult.currency,
      },
    };
  });
}
