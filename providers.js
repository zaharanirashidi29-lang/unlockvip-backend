const { toInternationalPhone, detectOperator } = require("./malipopay");
const { formatClickpesaError } = require("./clickpesa");
const { formatMalipopayError } = require("./malipopay");

function resolveProvider(phone) {
  const prefix3 = toInternationalPhone(phone).substring(3, 6);

  // Vodacom M-Pesa → MaliPoPay
  if (/^(74|75|76|79)/.test(prefix3)) {
    return "malipopay";
  }

  // Airtel, Tigo/Mixx, Halotel → ClickPesa
  if (/^(68|69|78|71|65|67|62|61)/.test(prefix3)) {
    return "clickpesa";
  }

  return "clickpesa";
}

function formatApiError(error, provider) {
  if (provider === "malipopay") {
    return formatMalipopayError(error);
  }
  return formatClickpesaError(error);
}

module.exports = {
  toInternationalPhone,
  detectOperator,
  resolveProvider,
  formatApiError
};
