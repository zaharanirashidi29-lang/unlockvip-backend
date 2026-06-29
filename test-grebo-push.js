require("dotenv").config();
const {
  getBalance,
  createDeposit,
  getTransaction,
  makeReference,
  normalizePhone,
  formatGreboError
} = require("./grebo");

const phone = process.argv[2] || "0794316132";
const amount = Number(process.argv[3] || 1000);
const reference = process.argv[4] || makeReference("GREBO-TEST");

(async () => {
  try {
    if (!process.env.GREBO_API_KEY) {
      throw new Error("Set GREBO_API_KEY in .env before running this test");
    }

    const phoneNumber = normalizePhone(phone);

    console.log("=== Grebo Pay Integration Test ===");
    console.log("Phone:", phoneNumber);
    console.log("Amount:", amount, "TZS");
    console.log("Reference:", reference);

    console.log("\n--- Step 1: Balance ---");
    const balance = await getBalance();
    console.log(JSON.stringify(balance, null, 2));

    console.log("\n--- Step 2: Mobile deposit (USSD push) ---");
    const deposit = await createDeposit({
      amount,
      phone: phoneNumber,
      reference,
      callbackUrl:
        process.env.GREBO_CALLBACK_URL ||
        process.env.CALLBACK_URL ||
        "https://unlockvip-backend-1.onrender.com/webhook"
    });
    console.log(JSON.stringify(deposit, null, 2));

    const txId = deposit?.data?.id;
    if (txId) {
      console.log("\n--- Step 3: Recent transactions ---");
      const tx = await getTransaction(txId);
      console.log(JSON.stringify(tx, null, 2));
    }

    if (deposit?.status === "success" && deposit?.data?.status === "pending") {
      console.log("\nUSSD push should appear on the phone. Approve on the handset to complete.");
    }
  } catch (error) {
    const formatted = formatGreboError(error);
    console.error("FAILED:", formatted.message);
    if (formatted.error) console.error("ERROR CODE:", formatted.error);
    if (formatted.requestId) console.error("REQUEST ID:", formatted.requestId);
    console.error("DETAILS:", JSON.stringify(formatted.details, null, 2));
    process.exitCode = 1;
  }
})();
