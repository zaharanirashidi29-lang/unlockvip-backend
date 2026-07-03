const {
  toInternationalPhone,
  detectOperator,
  isTigoPhone,
  isAirtelPhone,
  isHalotelPhone,
  getMobilePrefix2
} = require("./malipopay");
const { formatClickpesaError } = require("./clickpesa");
const { formatMalipopayError } = require("./malipopay");
const { formatPesapalError } = require("./pesapal");
const { formatGreboError } = require("./grebo");

function resolveProvider() {
  return "grebo";
}

function getRoutingLabel() {
  return "All networks → Grebo USSD push";
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
  isHalotelPhone,
  getMobilePrefix2,
  resolveProvider,
  getRoutingLabel,
  formatApiError
};
