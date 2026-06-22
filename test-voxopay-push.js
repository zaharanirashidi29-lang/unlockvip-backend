require("dotenv").config();
const { initiateStkPush, verifyPayment, toVoxopayPhone } = require("./voxopay");

const phone = process.argv[2] || "0794316132";
const amount = Number(process.argv[3] || 3061);
const refTrx = "ORD" + Date.now();

(async () => {
  try {
    console.log("=== VoxoPay STK Push Test ===");
    console.log("Phone:", toVoxopayPhone(phone));
    console.log("Amount:", amount, "TZS");
    console.log("Reference:", refTrx);
    console.log("Environment:", process.env.VOXOPAY_ENV || "production");
    console.log("");

    const result = await initiateStkPush({
      amount,
      phone,
      refTrx,
      description: "UnlockVIP VoxoPay test"
    });

    console.log("SUCCESS:", JSON.stringify(result, null, 2));

    if (result.trx_id) {
      console.log("\nWaiting 8s before verify...");
      await new Promise((r) => setTimeout(r, 8000));
      const verified = await verifyPayment(result.trx_id);
      console.log("VERIFY:", JSON.stringify(verified, null, 2));
    }
  } catch (error) {
    console.error("FAILED:", error.message);
    if (error.details) {
      console.error("DETAILS:", JSON.stringify(error.details, null, 2));
    }
    if (error.response?.data) {
      console.error("RESPONSE:", JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
})();
