require("dotenv").config();
const { resolveProvider, detectOperator } = require("./providers");
const { toInternationalPhone } = require("./malipopay");

const testNumbers = [
  { label: "Vodacom 079", phone: "0794316132", expectProvider: "snippe" },
  { label: "Vodacom 074", phone: "0742000001", expectProvider: "snippe" },
  { label: "Halotel 061", phone: "0617119863", expectProvider: "snippe" },
  { label: "Halotel 062", phone: "0622000001", expectProvider: "snippe" },
  { label: "Airtel 066", phone: "0667392184", expectProvider: "snippe" },
  { label: "Airtel 068", phone: "0687392184", expectProvider: "snippe" },
  { label: "Airtel 078", phone: "0784000001", expectProvider: "snippe" },
  { label: "Tigo 065", phone: "0652000001", expectProvider: "snippe" },
  { label: "Tigo 067", phone: "0672000001", expectProvider: "snippe" },
  { label: "Tigo 070", phone: "0702000001", expectProvider: "snippe" },
  { label: "Tigo 071", phone: "0712000001", expectProvider: "snippe" },
  { label: "Tigo 077", phone: "0771990575", expectProvider: "snippe" }
];

let failed = 0;

for (const { label, phone, expectProvider } of testNumbers) {
  const phoneNumber = toInternationalPhone(phone);
  const provider = resolveProvider(phoneNumber);
  const operator = detectOperator(phoneNumber);
  const ok = provider === expectProvider;

  console.log(
    `${ok ? "OK" : "FAIL"} | ${label} | ${phoneNumber} | ${operator} | provider=${provider}`
  );

  if (!ok) failed += 1;
}

if (failed) {
  process.exitCode = 1;
}
