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
}, { strict: false });

const Payment = mongoose.model("Payment", paymentSchema);

async function findAllTransactions() {
  try {
    // Get ALL transactions
    const all = await Payment.find({}).sort({ _id: -1 });
    
    console.log("\n========== ALL TRANSACTIONS IN DATABASE ==========\n");
    console.log(`Total documents: ${all.length}\n`);
    
    all.forEach((tx, idx) => {
      console.log(`\n[${idx + 1}]`);
      console.log("_id:", tx._id);
      console.log("Phone:", tx.phone);
      console.log("Amount:", tx.amount);
      console.log("Reference:", tx.reference);
      console.log("Status:", tx.status);
      console.log("Transaction ID:", tx.transaction_id);
      console.log("Result Code:", tx.resultcode);
      console.log("Full Doc:", JSON.stringify(tx, null, 2));
      console.log("---");
    });

    mongoose.connection.close();
  } catch (err) {
    console.error("Error:", err);
    mongoose.connection.close();
  }
}

findAllTransactions();
