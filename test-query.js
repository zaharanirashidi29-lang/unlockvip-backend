require("dotenv").config();
const { getPaymentStatus } = require("./clickpesa");

const orderReference = process.argv[2];

if (!orderReference) {
  console.error("Usage: node test-query.js <orderReference>");
  process.exit(1);
}

getPaymentStatus(orderReference)
  .then((data) => console.log("QUERY RESPONSE:", JSON.stringify(data, null, 2)))
  .catch((error) => {
    console.error("ERROR STATUS:", error.response?.status);
    console.error("ERROR DATA:", JSON.stringify(error.response?.data || error.message, null, 2));
  });
