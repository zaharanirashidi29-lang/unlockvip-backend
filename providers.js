const { toInternationalPhone, detectOperator } = require("./malipopay");
const { formatClickpesaError } = require("./clickpesa");
const { formatMalipopayError } = require("./malipopay");

function resolveProvider() {
  return "malipopay";
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
