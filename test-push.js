require("dotenv").config();
const {
  previewUssdPush,
  initiateUssdPush,
  toInternationalPhone
} = require("./clickpesa");

const phone = process.argv[2] || "0667392184";
const amount = Number(process.argv[3] || 3061);
const reference = "TEST" + Date.now();

(async () => {
  try {
    const phoneNumber = toInternationalPhone(phone);

    console.log("Previewing USSD push...");
    console.log("Phone:", phone, "->", phoneNumber);
    console.log("Amount:", amount, "TZS");
    console.log("Reference:", reference);

    const preview = await previewUssdPush({
      amount,
      orderReference: reference,
      phoneNumber
    });
    console.log("PREVIEW:", JSON.stringify(preview, null, 2));

    const result = await initiateUssdPush({
      amount,
      orderReference: reference,
      phoneNumber
    });

    console.log("SUCCESS:", JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("ERROR STATUS:", error.response?.status);
    console.error("ERROR DATA:", JSON.stringify(error.response?.data || error.message, null, 2));
  }
})();
