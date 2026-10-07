const {
  isPaid,
  isFailed,
  hasUsableFimiStatus,
  paymentStatusOf
} = require("./paribet/fimipay");
const { normalizeFimipayStatus } = require("./fimipay");

const pendingOrder = {
  result: "SUCCESS",
  resultcode: "SUCCESS",
  message: "OK",
  data: [
    {
      order_id: "FP-JDFE7GZA2EPG",
      amount: "3061",
      payment_status: "PENDING",
      msisdn: "255669169064"
    }
  ]
};

const paidOrder = {
  result: "SUCCESS",
  data: [
    {
      order_id: "FP-CR5SQQADRSXW",
      payment_status: "COMPLETED"
    }
  ]
};

const pushOnly = {
  result: "SUCCESS",
  order_id: "FP-NEW",
  message: "Push sent"
};

const vpn = {
  error: "vpn_blocked",
  message: "Turn off your VPN or proxy to continue."
};

const cases = [
  ["pending not paid", pendingOrder, false, "PROCESSING", "PENDING", true],
  ["completed is paid", paidOrder, true, "COMPLETED", "COMPLETED", true],
  ["create-order success is not paid", pushOnly, false, "PROCESSING", "", false],
  ["vpn is not a payment status", vpn, false, "PROCESSING", "", false]
];

let failed = 0;
for (const [label, data, expectPaid, expectNorm, expectStatus, expectUsable] of cases) {
  const paid = isPaid(data);
  const norm = normalizeFimipayStatus(data);
  const status = paymentStatusOf(data);
  const usable = hasUsableFimiStatus(data);
  const ok =
    paid === expectPaid &&
    norm === expectNorm &&
    status === expectStatus &&
    usable === expectUsable &&
    isFailed(pendingOrder) === false;
  console.log(`${ok ? "OK" : "FAIL"} | ${label} | paid=${paid} status=${norm} fimi=${status || "-"} usable=${usable}`);
  if (!ok) failed += 1;
}

if (failed) process.exit(1);

const watchdog = normalizeFimipayStatus(pendingOrder) === "PROCESSING" &&
  normalizeFimipayStatus(paidOrder) === "COMPLETED";
console.log(`${watchdog ? "OK" : "FAIL"} | watchdog only completes Fimi payment_status COMPLETED`);
if (!watchdog) process.exit(1);

const falseComplete = hasUsableFimiStatus(pendingOrder) && !isPaid(pendingOrder);
console.log(`${falseComplete ? "OK" : "FAIL"} | stored SUCCESS+PENDING must un-complete, not stay paid`);
if (!falseComplete) process.exit(1);
