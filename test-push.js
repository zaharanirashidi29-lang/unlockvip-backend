require("dotenv").config();
const { resolveProvider, detectOperator, toInternationalPhone } = require("./providers");
const { createDeposit } = require("./grebo");

const phone = process.argv[2] || "255794316132";
const amount = Number(process.argv[3] || 3061);
const reference = "ORD" + Date.now();
const callbackUrl =
  process.env.CALLBACK_URL || "https://unlockvip-backend-1.onrender.com/webhook/grebo";

(async () => {
  try {
    const phoneNumber = toInternationalPhone(phone);
    const provider = resolveProvider(phoneNumber);
    const operator = detectOperator(phoneNumber);

    console.log("Phone:", phoneNumber);
    console.log("Operator:", operator);
    console.log("Provider:", provider);
    console.log("Reference:", reference);

    const result = await createDeposit({
      amount,
      phone: phoneNumber,
      reference,
      callbackUrl
    });
    console.log("Grebo SUCCESS:", JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("ERROR STATUS:", error.response?.status);
    console.error("ERROR DATA:", JSON.stringify(error.response?.data || error.message, null, 2));
  }
})();
