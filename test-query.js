require("dotenv").config();
const { verifyPayment } = require("./malipopay");

const reference = process.argv[2];

if (!reference) {
  console.error("Usage: node test-query.js <malipopayReference>");
  process.exit(1);
}

verifyPayment(reference)
  .then((data) => console.log("QUERY RESPONSE:", JSON.stringify(data, null, 2)))
  .catch((error) => {
    console.error("ERROR STATUS:", error.response?.status);
    console.error("ERROR DATA:", JSON.stringify(error.response?.data || error.message, null, 2));
  });
