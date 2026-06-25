const { toInternationalPhone, detectOperator } = require("./malipopay");
const { formatClickpesaError } = require("./clickpesa");
const { formatMalipopayError } = require("./malipopay");

function resolveProvider(phone) {
  const prefix3 = toInternationalPhone(phone).substring(3, 6);

  // Vodacom M-Pesa and Airtel → MaliPoPay
  if (/^(74|75|76|79|66|68|69|78)/.test(prefix3)) {
    return "malipopay";
  }

  // Tigo/Mixx and Halotel → ClickPesa
  if (/^(71|65|67|61|62|63)/.test(prefix3)) {
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
