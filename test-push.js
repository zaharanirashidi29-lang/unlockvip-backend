require("dotenv").config();
const { resolveProvider, detectOperator, toInternationalPhone } = require("./providers");
const { collectPayment } = require("./malipopay");
const { initiateUssdPush } = require("./clickpesa");

const phone = process.argv[2] || "255794316132";
const amount = Number(process.argv[3] || 3061);
const reference = "ORD" + Date.now();

(async () => {
  try {
    const phoneNumber = toInternationalPhone(phone);
    const provider = resolveProvider(phoneNumber);
    const operator = detectOperator(phoneNumber);

    console.log("Phone:", phoneNumber);
    console.log("Operator:", operator);
    console.log("Provider:", provider);
    console.log("Reference:", reference);

    if (provider === "malipopay") {
      const result = await collectPayment({
        amount,
        phoneNumber,
        reference,
        description: "UnlockVIP payment test"
      });
      console.log("MaliPoPay SUCCESS:", JSON.stringify(result, null, 2));
      return;
    }

    const result = await initiateUssdPush({
      amount,
      orderReference: reference,
      phoneNumber
    });
    console.log("ClickPesa SUCCESS:", JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("ERROR STATUS:", error.response?.status);
    console.error("ERROR DATA:", JSON.stringify(error.response?.data || error.message, null, 2));
  }
})();
