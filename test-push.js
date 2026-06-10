require("dotenv").config();
const { collectPayment, toInternationalPhone } = require("./malipopay");

const phone = process.argv[2] || "255794316132";
const amount = Number(process.argv[3] || 3061);
const reference = "ORD" + Date.now();

(async () => {
  try {
    const phoneNumber = toInternationalPhone(phone);

    console.log("Sending MaliPoPay USSD push...");
    console.log("Phone:", phone, "->", phoneNumber);
    console.log("Amount:", amount, "TZS");
    console.log("Reference:", reference);

    const result = await collectPayment({
      amount,
      phoneNumber,
      reference,
      description: "UnlockVIP payment test"
    });

    console.log("SUCCESS:", JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("ERROR STATUS:", error.response?.status);
    console.error("ERROR DATA:", JSON.stringify(error.response?.data || error.message, null, 2));
  }
})();
