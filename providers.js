const { toInternationalPhone, detectOperator, isTigoPhone } = require("./malipopay");
const { formatClickpesaError } = require("./clickpesa");
const { formatMalipopayError } = require("./malipopay");
const { formatPesapalError } = require("./pesapal");

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
