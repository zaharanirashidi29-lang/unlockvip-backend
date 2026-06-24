require("dotenv").config();
const { resolveProvider, detectOperator, toInternationalPhone } = require("./providers");
const { collectPayment, resolvePaymentMethodType } = require("./malipopay");

const testNumbers = [
  { label: "Vodacom", phone: "0794316132" },
  { label: "Airtel 066", phone: "0667392184" },
  { label: "Airtel 078", phone: "0784000001" },
  { label: "Tigo/Mixx", phone: "0712000001" },
  { label: "Halotel", phone: "0617119863" }
];

(async () => {
  console.log("=== MaliPoPay payment intent test (all networks) ===\n");

  for (const { label, phone } of testNumbers) {
    const phoneNumber = toInternationalPhone(phone);
    const provider = resolveProvider(phoneNumber);
    const operator = detectOperator(phoneNumber);
    const methodType = resolvePaymentMethodType(phoneNumber);
    const reference = "TEST" + label.toUpperCase().replace(/\W/g, "") + Date.now();

    console.log(`--- ${label} (${operator}) ---`);
    console.log("Phone:", phoneNumber);
    console.log("Method:", methodType);
    console.log("Provider:", provider);
    console.log("Reference:", reference);

    try {
      const result = await collectPayment({
        amount: 3061,
        phoneNumber,
        reference,
        description: `UnlockVIP ${label} MaliPoPay test`
      });
      console.log("SUCCESS:", JSON.stringify(result, null, 2));
    } catch (error) {
      console.log("FAILED:", error.message);
      if (error.details) {
        console.log("Details:", JSON.stringify(error.details, null, 2));
      }
    }

    console.log("");
  }
})();
