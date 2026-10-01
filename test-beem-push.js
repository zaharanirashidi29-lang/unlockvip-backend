require("dotenv").config();
const { initiateCheckout, makeReference, formatBeemError } = require("./beem");

const phone = process.argv[2] || "255794316132";
const amount = Number(process.argv[3] || 3061);
const referencePrefix = process.argv[4] || "SAMPLE";

(async () => {
  try {
    const referenceNumber = makeReference(referencePrefix);

    console.log("=== Beem Checkout / USSD Push Test ===");
    console.log("Phone:", phone);
    console.log("Amount:", amount);
    console.log("Reference:", referenceNumber);
    console.log("API key set:", Boolean(process.env.BEEM_API_KEY));

    const result = await initiateCheckout({
      amount,
      phoneNumber: phone,
      referenceNumber,
      callbackToken: referenceNumber
    });

    console.log("HTTP status:", result.status);
    console.log("Transaction ID:", result.transactionId);
    if (result.checkoutUrl) {
      console.log("Checkout URL:", result.checkoutUrl);
    }
    console.log("Response:", JSON.stringify(result.data, null, 2));
  } catch (error) {
    const formatted = formatBeemError(error);
    console.error("ERROR:", formatted.message);
    console.error("STATUS:", formatted.status);
    console.error("DETAILS:", JSON.stringify(formatted.details, null, 2));
    process.exitCode = 1;
  }
})();
