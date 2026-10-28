import { psRequest } from "../src/gateways/paystack/client.js";

/**
 * Simple script to list recent Paystack transactions to find references for testing.
 */

interface PsTransaction {
  id: number;
  reference: string;
  amount: number;
  status: string;
  paid_at: string | null;
  customer?: {
    email?: string;
  };
  split?: {
    id: number;
    name: string;
  };
}

interface PsEnvelope<T> {
  status: boolean;
  message: string;
  data: T;
}

async function main(): Promise<void> {
  console.log("\n[test-ps-transactions] Fetching recent transactions...\n");

  try {
    const response = await psRequest<PsEnvelope<PsTransaction[]>>({
      method: "GET",
      path: "/transaction",
      query: {
        perPage: 20,
      },
    });

    const transactions = response.data?.data ?? [];

    if (transactions.length === 0) {
      console.log("No transactions found.");
      console.log("\nTo test split verification, you need to:");
      console.log("1. Create a payment using the Paystack test credentials");
      console.log("2. Use the transaction reference to test verification");
      return;
    }

    console.log(`Found ${transactions.length} transactions:\n`);
    console.log("=".repeat(80));

    for (const tx of transactions) {
      console.log(`\nReference:  ${tx.reference}`);
      console.log(`Amount:     ${tx.amount / 100} NGN`);
      console.log(`Status:     ${tx.status}`);
      console.log(`Paid At:    ${tx.paid_at ?? "Not paid"}`);
      if (tx.customer?.email) {
        console.log(`Customer:   ${tx.customer.email}`);
      }
      if (tx.split) {
        console.log(`Split:      ${tx.split.name} (ID: ${tx.split.id})`);
      }
      console.log(`Has Split:  ${tx.split ? "Yes" : "No"}`);
      console.log("-".repeat(80));
    }

    // Find transactions with splits
    const splitTransactions = transactions.filter((tx) => tx.split);
    if (splitTransactions.length > 0) {
      console.log(`\n\n✅ Found ${splitTransactions.length} transaction(s) with splits!`);
      console.log("\nYou can test verification with these references:");
      splitTransactions.forEach((tx) => {
        console.log(`  - ${tx.reference} (Status: ${tx.status})`);
      });
    } else {
      console.log("\n\nℹ️  No transactions with splits found.");
      console.log("To create a test split transaction, use the virtual account creation flow.");
    }

  } catch (error) {
    console.error("❌ Error fetching transactions:");
    if (error instanceof Error) {
      console.error(`  Message: ${error.message}`);
      if ("raw" in error) {
        console.error(`  Details:`, JSON.stringify((error as any).raw, null, 2));
      }
    }
  }

  console.log("\n");
}

main().catch((err) => {
  console.error("\n[test-ps-transactions] Fatal error:", err);
  process.exit(1);
});
