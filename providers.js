const { toInternationalPhone, detectOperator } = require("./malipopay");
const { formatClickpesaError } = require("./clickpesa");
const { formatMalipopayError } = require("./malipopay");
const { formatPesapalError } = require("./pesapal");

function isTigoPhone(phone) {
  const normalized = toInternationalPhone(phone);
  const prefix3 = normalized.substring(3, 6);
  return /^(71|65|67)/.test(prefix3);
}

function resolveProvider(phone) {
  if (isTigoPhone(phone)) {
    return "pesapal";
  }
  return "malipopay";
}

function formatApiError(error, provider) {
  if (provider === "pesapal") {
    return formatPesapalError(error);
  }
  if (provider === "malipopay") {
    return formatMalipopayError(error);
  }
  return formatClickpesaError(error);
}

module.exports = {
  toInternationalPhone,
  detectOperator,
  isTigoPhone,
  resolveProvider,
  formatApiError
};
