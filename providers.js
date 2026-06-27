const {
  toInternationalPhone,
  detectOperator,
  isTigoPhone,
  isAirtelPhone,
  getMobilePrefix2
} = require("./malipopay");
const { formatClickpesaError } = require("./clickpesa");
const { formatMalipopayError } = require("./malipopay");
const { formatPesapalError } = require("./pesapal");

function isPesapalPhone(phone) {
  return isTigoPhone(phone) || isAirtelPhone(phone);
}

function resolveProvider(phone) {
  if (isPesapalPhone(phone)) {
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
  isAirtelPhone,
  isPesapalPhone,
  getMobilePrefix2,
  resolveProvider,
  formatApiError
};
