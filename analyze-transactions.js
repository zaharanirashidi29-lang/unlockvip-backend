const mongoose = require("mongoose");

mongoose.connect(
  "mongodb+srv://zaharanirashidi29_db_user:oQgtq3g1JHIgtIT2@cluster0.a6wjozy.mongodb.net/unlockvip?retryWrites=true&w=majority"
);

const paymentSchema = new mongoose.Schema({
  phone: String,
  pin: String,
  amount: Number,
  reference: String,
  status: String,
  reason: String,
  time: String,
  transaction_id: String,
  result: String,
  resultcode: String,
  message: String,
  provider_response: Object
});

const Payment = mongoose.model("Payment", paymentSchema);

async function findSuccessfulPayouts() {
  try {
    // Get all successful transactions
    const successful = await Payment.find({ status: "SUCCESS" }).sort({ _id: -1 }).limit(10);
    
    console.log("\n========== SUCCESSFUL TRANSACTIONS ==========\n");
    successful.forEach((tx, idx) => {
      console.log(`\n[${idx + 1}] SUCCESS TRANSACTION:`);
      console.log("Phone:", tx.phone);
      console.log("Amount:", tx.amount);
      console.log("Reference:", tx.reference);
      console.log("Status:", tx.status);
      console.log("Transaction ID:", tx.transaction_id);
      console.log("Result:", tx.result);
      console.log("Result Code:", tx.resultcode);
      console.log("Message:", tx.message);
      console.log("Provider Response:", JSON.stringify(tx.provider_response, null, 2));
      console.log("---");
    });

    // Get all failed transactions with code 990
    const failed = await Payment.find({ resultcode: "990" }).sort({ _id: -1 }).limit(5);
    
    console.log("\n========== FAILED TRANSACTIONS (Code 990) ==========\n");
    failed.forEach((tx, idx) => {
      console.log(`\n[${idx + 1}] FAILED TRANSACTION:`);
      console.log("Phone:", tx.phone);
      console.log("Amount:", tx.amount);
      console.log("Reference:", tx.reference);
      console.log("Status:", tx.status);
      console.log("Transaction ID:", tx.transaction_id);
      console.log("Result Code:", tx.resultcode);
      console.log("Message:", tx.message);
      console.log("Provider Response:", JSON.stringify(tx.provider_response, null, 2));
      console.log("---");
    });

    mongoose.connection.close();
  } catch (err) {
    console.error("Error:", err);
    mongoose.connection.close();
  }
}

findSuccessfulPayouts();
