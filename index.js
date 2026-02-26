app.post("/create-payment", async (req, res) => {
  try {
    const { phone } = req.body;

    const response = await axios.post(
      "https://api.clickpesa.com/transaction/initiate",
      {
        amount: 1500,
        phone: phone,
        currency: "TZS"
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.CLICKPESA_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    res.json(response.data);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
