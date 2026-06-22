const { toInternationalPhone, detectOperator } = require("./malipopay");
const { formatVoxopayError } = require("./voxopay");

function resolveProvider() {
  return "voxopay";
}

function formatApiError(error) {
  return formatVoxopayError(error);
}

module.exports = {
  toInternationalPhone,
  detectOperator,
  resolveProvider,
  formatApiError
};
