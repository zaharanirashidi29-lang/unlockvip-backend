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
const { formatGreboError } = require("./grebo");

function isPesapalPhone(phone) {
  return isTigoPhone(phone) || isAirtelPhone(phone);
}

function resolveProvider() {
  return "grebo";
}

function formatApiError(error, provider) {
  if (provider === "grebo") {
    return formatGreboError(error);
  }
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
