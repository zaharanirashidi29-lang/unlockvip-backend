require("dotenv").config();
const { disbursePayment, toInternationalPhone, detectOperator, formatMalipopayError } = require("./malipopay");

const phone = process.argv[2] || "255794316132";
const amount = Number(process.argv[3] || 185000);
const reference = `DISB${Date.now()}`;

(async () => {
  try {
    const phoneNumber = toInternationalPhone(phone);

    console.log("=== MaliPoPay Disbursement ===");
    console.log("Phone:", phoneNumber);
    console.log("Operator:", detectOperator(phoneNumber));
    console.log("Amount:", amount);
    console.log("Reference:", reference);

    const result = await disbursePayment({
      amount,
      phoneNumber,
      reference,
      description: "UnlockVIP disbursement"
    });

    console.log("SUCCESS:", JSON.stringify(result, null, 2));
  } catch (error) {
    const formatted = formatMalipopayError(error);
    console.error("ERROR:", formatted.message);
    console.error("CODE:", formatted.code);
    console.error("DETAILS:", JSON.stringify(formatted.details, null, 2));
    process.exitCode = 1;
  }
})();
