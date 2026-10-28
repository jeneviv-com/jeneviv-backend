import { getGateway } from "../src/gateways/registry.js";

/**
 * Test the verifyPayment method with a specific transaction reference.
 */

async function main(): Promise<void> {
  const gateway = getGateway("paystack");
  console.log(`\n[test-verify-specific] Using gateway: ${gateway.name}\n`);

  // Test with successful transactions from the account
  const testReferences = [
    "187005c0aeac4e4a8c360d41dab89b7505c45a9e4b164606", // Success
    "f4084967e968b6ae94c6e206938fb0b965f79e6af21c426a", // Success
    "txnRSMqiGRAOiCRWdFF2AVAsFm5", // Failed
  ];

  console.log("=".repeat(80));
  console.log("TESTING VERIFY PAYMENT METHOD");
  console.log("=".repeat(80));

  for (const reference of testReferences) {
    console.log(`\n\n📋 Reference: ${reference}`);
    console.log("-".repeat(80));

    try {
      if (!gateway.verifyPayment) {
        console.log("❌ verifyPayment method not available on gateway");
        continue;
      }

      const result = await gateway.verifyPayment(reference);

      if (!result) {
        console.log("⚠️  No payment found for this reference");
        continue;
      }

      console.log("\n✅ PAYMENT VERIFIED\n");
      
      console.log("Payment Details:");
      console.log(`  Status:           ${result.status.toUpperCase()}`);
      console.log(`  Gateway ID:       ${result.gatewayId}`);
      console.log(`  Currency:         ${result.currency}`);
      console.log(`  Paid At:          ${result.paidAt?.toISOString() ?? "Not paid yet"}`);
      
      console.log("\nAmounts (in minor units):");
      console.log(`  Amount Paid:      ${result.amountPaidMinor} (${result.amountPaidMinor / 100} ${result.currency})`);
      console.log(`  Gateway Fee:      ${result.gatewayFeeMinor} (${result.gatewayFeeMinor / 100} ${result.currency})`);
      
      const netAmount = result.amountPaidMinor - result.gatewayFeeMinor;
      console.log(`  Net Amount:       ${netAmount} (${netAmount / 100} ${result.currency})`);

      // Additional calculations for split scenarios
      if (result.status === "success") {
        console.log("\nSplit Calculation Example:");
        const platformFee = 75; // 0.75 NGN
        const merchantShare = netAmount - platformFee;
        console.log(`  Platform Fee:     ${platformFee} (${platformFee / 100} ${result.currency})`);
        console.log(`  Merchant Share:   ${merchantShare} (${merchantShare / 100} ${result.currency})`);
      }

    } catch (error) {
      console.error("\n❌ ERROR VERIFYING PAYMENT\n");
      if (error instanceof Error) {
        console.error(`Message: ${error.message}`);
        if ("status" in error) {
          console.error(`HTTP Status: ${(error as any).status}`);
        }
        if ("raw" in error) {
          console.error(`\nRaw Response:`);
          console.error(JSON.stringify((error as any).raw, null, 2));
        }
      } else {
        console.error(error);
      }
    }
  }

  console.log("\n" + "=".repeat(80));
  console.log("TEST COMPLETE");
  console.log("=".repeat(80) + "\n");
}

main().catch((err) => {
  console.error("\n[test-verify-specific] Fatal error:", err);
  process.exit(1);
});
