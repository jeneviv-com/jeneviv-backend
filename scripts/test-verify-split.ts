import { getGateway } from "../src/gateways/registry.js";

/**
 * Test script to verify Paystack split payment verification.
 * This tests the verifyPayment method which should return details including
 * the split amounts and fees.
 */

async function main(): Promise<void> {
  const gateway = getGateway("paystack");
  console.log(`\n[test-verify-split] Using gateway: ${gateway.name}\n`);

  // Test with a known reference or create a new one
  // Replace this with an actual test transaction reference from Paystack
  const testReferences = [
    // Add test transaction references here
    "test_ref_123",
  ];

  console.log("=".repeat(60));
  console.log("Testing verifyPayment for split transactions");
  console.log("=".repeat(60));

  for (const reference of testReferences) {
    console.log(`\nVerifying payment: ${reference}`);
    console.log("-".repeat(60));

    try {
      const result = await gateway.verifyPayment?.(reference);

      if (!result) {
        console.log("❌ No payment found for this reference");
        continue;
      }

      console.log("✅ Payment verified successfully!");
      console.log("\nPayment Details:");
      console.log(`  Status:          ${result.status}`);
      console.log(`  Gateway ID:      ${result.gatewayId}`);
      console.log(`  Amount Paid:     ${result.amountPaidMinor / 100} ${result.currency}`);
      console.log(`  Gateway Fee:     ${result.gatewayFeeMinor / 100} ${result.currency}`);
      console.log(`  Currency:        ${result.currency}`);
      console.log(`  Paid At:         ${result.paidAt?.toISOString() ?? "Not paid yet"}`);

      // Calculate net amounts
      const netAmount = result.amountPaidMinor - result.gatewayFeeMinor;
      console.log(`  Net Amount:      ${netAmount / 100} ${result.currency}`);

    } catch (error) {
      console.error("❌ Error verifying payment:");
      if (error instanceof Error) {
        console.error(`  Message: ${error.message}`);
        if ("status" in error) {
          console.error(`  Status: ${error.status}`);
        }
        if ("raw" in error) {
          console.error(`  Raw response:`, JSON.stringify(error.raw, null, 2));
        }
      } else {
        console.error(error);
      }
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("Testing complete!");
  console.log("=".repeat(60) + "\n");

  // Additional test: Create a virtual account with split to verify the flow
  console.log("\nTesting virtual account creation with split:");
  console.log("-".repeat(60));

  try {
    // First, ensure we have a subaccount for testing
    const testSubaccount = {
      businessName: "Test Merchant Split",
      bankCode: "058", // GTBank
      accountNumber: "0123456789", // Test account
      percentageCharge: 0, // Using flat fee instead
    };

    console.log("\n1. Creating/verifying subaccount...");
    let subaccountCode: string;
    try {
      const subaccountResult = await gateway.ensureSubaccount?.(testSubaccount);
      subaccountCode = subaccountResult!.subaccountCode;
      console.log(`   ✅ Subaccount: ${subaccountCode}`);
    } catch (error) {
      console.log("   ℹ️  Using existing subaccount (creation failed, might already exist)");
      // In a real scenario, you'd fetch the existing subaccount code
      throw error;
    }

    // Create a virtual account with split
    const reference = `test_split_${Date.now()}`;
    const amount = 10000; // 100 NGN in kobo
    const platformFee = 75; // 0.75 NGN platform fee

    console.log("\n2. Creating virtual account with split...");
    console.log(`   Reference:     ${reference}`);
    console.log(`   Amount:        ${amount / 100} NGN`);
    console.log(`   Platform Fee:  ${platformFee / 100} NGN`);

    const virtualAccount = await gateway.createVirtualAccount({
      reference,
      customerId: "",
      amount,
      currency: "NGN",
      narration: "Test split payment",
      expirySeconds: 3600,
      customerEmail: "test@example.com",
      subaccountCode,
      platformFeeMinor: platformFee,
    });

    console.log("\n   ✅ Virtual account created:");
    console.log(`   Account Number: ${virtualAccount.accountNumber}`);
    console.log(`   Account Name:   ${virtualAccount.accountName}`);
    console.log(`   Bank:           ${virtualAccount.bankName}`);
    console.log(`   Total Charged:  ${virtualAccount.totalCharged / 100} NGN`);
    console.log(`   Expires At:     ${virtualAccount.expiryAt.toISOString()}`);

    console.log("\n   ℹ️  To complete the test:");
    console.log(`   1. Transfer ${virtualAccount.totalCharged / 100} NGN to:`);
    console.log(`      ${virtualAccount.accountNumber} - ${virtualAccount.bankName}`);
    console.log(`   2. Wait for payment confirmation`);
    console.log(`   3. Run: tsx scripts/test-verify-split.ts with reference: ${reference}`);

  } catch (error) {
    console.error("\n   ❌ Error in virtual account flow:");
    if (error instanceof Error) {
      console.error(`   Message: ${error.message}`);
    }
  }

  console.log("\n");
}

main().catch((err) => {
  console.error("\n[test-verify-split] Fatal error:", err);
  process.exit(1);
});
