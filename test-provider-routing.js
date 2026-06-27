require("dotenv").config();
const { resolveProvider, detectOperator, isTigoPhone } = require("./providers");
const { toInternationalPhone } = require("./malipopay");

const testNumbers = [
  { label: "Vodacom 079", phone: "0794316132", expectProvider: "malipopay" },
  { label: "Vodacom 074", phone: "0742000001", expectProvider: "malipopay" },
  { label: "Airtel 066", phone: "0667392184", expectProvider: "malipopay" },
  { label: "Airtel 078", phone: "0784000001", expectProvider: "malipopay" },
  { label: "Tigo 065", phone: "0652000001", expectProvider: "pesapal" },
  { label: "Tigo 067", phone: "0672000001", expectProvider: "pesapal" },
  { label: "Tigo 071", phone: "0712000001", expectProvider: "pesapal" },
  { label: "Tigo 077", phone: "0771990575", expectProvider: "pesapal" },
  { label: "Halotel 061", phone: "0617119863", expectProvider: "malipopay" },
  { label: "Halotel 062", phone: "0622000001", expectProvider: "malipopay" }
];

let failed = 0;

for (const { label, phone, expectProvider } of testNumbers) {
  const phoneNumber = toInternationalPhone(phone);
  const provider = resolveProvider(phoneNumber);
  const operator = detectOperator(phoneNumber);
  const tigo = isTigoPhone(phoneNumber);
  const ok = provider === expectProvider;

  console.log(
    `${ok ? "OK" : "FAIL"} | ${label} | ${phoneNumber} | ${operator} | provider=${provider} | tigo=${tigo}`
  );

  if (!ok) failed += 1;
}

if (failed) {
  process.exitCode = 1;
}
