require("dotenv").config();
const {
  disbursePayment,
  verifyPayment,
  toInternationalPhone,
  detectOperator,
  resolveDisbursementProvider,
  formatMalipopayError
} = require("./malipopay");

const phone = process.argv[2] || "255794316132";
const amount = Number(process.argv[3] || 185000);
const reference = `DISB${Date.now()}`;

(async () => {
  try {
    const phoneNumber = toInternationalPhone(phone);

    console.log("=== MaliPoPay Disbursement (doc flow) ===");
    console.log("Phone:", phoneNumber);
    console.log("Operator:", detectOperator(phoneNumber));
    console.log("Provider:", resolveDisbursementProvider(phoneNumber));
    console.log("Amount:", amount);
    console.log("Reference:", reference);
    console.log("Fee estimate: ~2% (~", Math.round(amount * 0.02), "TZS)");
    console.log("Total needed: ~", amount + Math.round(amount * 0.02), "TZS");

    const result = await disbursePayment({
      amount,
      phoneNumber,
      reference,
      description: "UnlockVIP disbursement"
    });

    console.log("METHOD:", result.method);
    console.log("STATUS:", result.status);
    console.log("MALIPOPAY REF:", result.reference);

    if (String(result.status).toUpperCase() === "PENDING_APPROVAL") {
      console.log("NEXT STEP: Admin must approve in MaliPoPay dashboard or via POST /payment/approve + OTP confirm.");
    }

    console.log("RESULT:", JSON.stringify(result, null, 2));

    if (result.reference) {
      const verified = await verifyPayment(result.reference, { bypassCache: true }).catch(() => null);
      if (verified) {
        console.log("VERIFY:", verified.status, verified.failureReason || "");
      }
    }
  } catch (error) {
    const formatted = formatMalipopayError(error);
    console.error("FAILED:", formatted.message);
    console.error("CODE:", formatted.code);
    if (formatted.details?.failureReason) {
      console.error("REASON:", formatted.details.failureReason);
    }
    if (formatted.details?.method) {
      console.error("METHOD:", formatted.details.method);
    }
    console.error("DETAILS:", JSON.stringify(formatted.details, null, 2));
    process.exitCode = 1;
  }
})();
