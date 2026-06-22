require("dotenv").config();
const { resolveProvider, detectOperator, toInternationalPhone } = require("./providers");
const { collectPayment } = require("./malipopay");

const testNumbers = [
  { label: "Airtel", phone: "255784000001" },
  { label: "Tigo/Mixx", phone: "255712000001" },
  { label: "Halotel", phone: "255622000001" }
];

(async () => {
  console.log("=== MaliPoPay non-Vodacom routing test ===\n");

  for (const { label, phone } of testNumbers) {
    const phoneNumber = toInternationalPhone(phone);
    const provider = resolveProvider(phoneNumber);
    const operator = detectOperator(phoneNumber);
    const reference = "TEST" + label.toUpperCase().replace(/\W/g, "") + Date.now();

    console.log(`--- ${label} (${operator}) ---`);
    console.log("Phone:", phoneNumber);
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
