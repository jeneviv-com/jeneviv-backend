import { psRequest } from "../src/gateways/paystack/client.js";

/**
 * Fetch detailed transaction information to see split details.
 */

interface PsSplitShare {
  subaccount?: string;
  share?: number;
  split_code?: string;
  type?: string;
}

interface PsTransaction {
  id: number;
  reference: string;
  amount: number;
  fees: number | null;
  status: string;
  paid_at: string | null;
  currency: string;
  customer?: {
    email?: string;
  };
  split?: {
    id: number;
    name: string;
    type: string;
    currency: string;
    split_code: string;
    active: boolean;
    bearer_type: string;
    bearer_subaccount: string | null;
  };
  split_config?: {
    subaccount?: string;
    share?: number;
  };
  subaccount?: {
    id: number;
    subaccount_code: string;
    business_name: string;
    settlement_bank: string;
    account_number: string;
    percentage_charge?: number;
  };
  transaction_date?: string;
  log?: {
    time_spent?: number;
    attempts?: number;
    success?: boolean;
    mobile?: boolean;
    history?: Array<{
      type: string;
      message: string;
      time: number;
    }>;
  };
}

interface PsEnvelope<T> {
  status: boolean;
  message: string;
  data: T;
}

async function main(): Promise<void> {
  // Use one of the successful transaction references
  const references = [
    "187005c0aeac4e4a8c360d41dab89b7505c45a9e4b164606",
    "f4084967e968b6ae94c6e206938fb0b965f79e6af21c426a",
  ];

  console.log("\n" + "=".repeat(80));
  console.log("DETAILED TRANSACTION INFORMATION");
  console.log("=".repeat(80));

  for (const reference of references) {
    console.log(`\n\n📋 Fetching details for: ${reference}`);
    console.log("-".repeat(80));

    try {
      const response = await psRequest<PsEnvelope<PsTransaction>>({
        method: "GET",
        path: `/transaction/verify/${encodeURIComponent(reference)}`,
      });

      const tx = response.data?.data;
      if (!tx) {
        console.log("❌ No transaction data returned");
        continue;
      }

      console.log("\n✅ TRANSACTION FOUND\n");

      console.log("Basic Information:");
      console.log(`  ID:               ${tx.id}`);
      console.log(`  Reference:        ${tx.reference}`);
      console.log(`  Status:           ${tx.status}`);
      console.log(`  Amount:           ${tx.amount / 100} ${tx.currency}`);
      console.log(`  Fees:             ${(tx.fees ?? 0) / 100} ${tx.currency}`);
      console.log(`  Paid At:          ${tx.paid_at ?? "Not paid"}`);
      
      if (tx.customer?.email) {
        console.log(`  Customer Email:   ${tx.customer.email}`);
      }

      // Check for split information
      if (tx.split) {
        console.log("\n🔀 SPLIT INFORMATION:");
        console.log(`  Split ID:         ${tx.split.id}`);
        console.log(`  Split Name:       ${tx.split.name}`);
        console.log(`  Split Code:       ${tx.split.split_code}`);
        console.log(`  Split Type:       ${tx.split.type}`);
        console.log(`  Currency:         ${tx.split.currency}`);
        console.log(`  Active:           ${tx.split.active}`);
        console.log(`  Bearer Type:      ${tx.split.bearer_type}`);
        if (tx.split.bearer_subaccount) {
          console.log(`  Bearer Subacct:   ${tx.split.bearer_subaccount}`);
        }
      }

      // Check for subaccount information
      if (tx.subaccount) {
        console.log("\n💼 SUBACCOUNT INFORMATION:");
        console.log(`  Code:             ${tx.subaccount.subaccount_code}`);
        console.log(`  Business:         ${tx.subaccount.business_name}`);
        console.log(`  Bank:             ${tx.subaccount.settlement_bank}`);
        console.log(`  Account:          ${tx.subaccount.account_number}`);
        if (tx.subaccount.percentage_charge !== undefined) {
          console.log(`  % Charge:         ${tx.subaccount.percentage_charge}%`);
        }
      }

      // Check for split config
      if (tx.split_config) {
        console.log("\n⚙️  SPLIT CONFIG:");
        if (tx.split_config.subaccount) {
          console.log(`  Subaccount:       ${tx.split_config.subaccount}`);
        }
        if (tx.split_config.share !== undefined) {
          console.log(`  Share:            ${tx.split_config.share}`);
        }
      }

      // Calculate split amounts
      if (tx.status === "success" && tx.amount && tx.fees !== null) {
        console.log("\n💰 SPLIT CALCULATIONS:");
        const grossAmount = tx.amount;
        const gatewayFee = tx.fees;
        const netAmount = grossAmount - gatewayFee;
        
        console.log(`  Gross Amount:     ${grossAmount / 100} ${tx.currency}`);
        console.log(`  Gateway Fee:      ${gatewayFee / 100} ${tx.currency}`);
        console.log(`  Net Amount:       ${netAmount / 100} ${tx.currency}`);

        // Example platform fee calculation
        const platformFee = 75; // 0.75 NGN
        const merchantShare = netAmount - platformFee;
        console.log(`\n  Platform Fee:     ${platformFee / 100} ${tx.currency}`);
        console.log(`  Merchant Share:   ${merchantShare / 100} ${tx.currency}`);
        console.log(`  Merchant %:       ${((merchantShare / grossAmount) * 100).toFixed(2)}%`);
      }

      // Show full raw data for debugging
      console.log("\n📦 RAW DATA:");
      console.log(JSON.stringify(tx, null, 2));

    } catch (error) {
      console.error("\n❌ ERROR FETCHING TRANSACTION\n");
      if (error instanceof Error) {
        console.error(`Message: ${error.message}`);
        if ("raw" in error) {
          console.error(`\nRaw Response:`);
          console.error(JSON.stringify((error as any).raw, null, 2));
        }
      }
    }
  }

  console.log("\n" + "=".repeat(80));
  console.log("COMPLETE");
  console.log("=".repeat(80) + "\n");
}

main().catch((err) => {
  console.error("\n[test-split-details] Fatal error:", err);
  process.exit(1);
});
