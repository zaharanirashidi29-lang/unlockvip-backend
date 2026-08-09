const {
  toInternationalPhone,
  detectOperator,
  isTigoPhone,
  isAirtelPhone,
  isHalotelPhone,
  isVodacomPhone,
  getMobilePrefix2
} = require("./malipopay");
const { formatClickpesaError } = require("./clickpesa");
const { formatMalipopayError } = require("./malipopay");
const { formatPesapalError } = require("./pesapal");
const { formatGreboError } = require("./grebo");
const { formatAblinerError } = require("./abliner");
const { formatPaymeError } = require("./paymeafrica");

function isPesapalPhone(_phone) {
  return false;
}

function resolveProvider(_phone) {
  return "abliner";
}

function getRoutingLabel() {
  return "All networks → Abliner";
}

function formatApiError(error, provider) {
  if (provider === "paymeafrica") {
    return formatPaymeError(error);
  }
  if (provider === "grebo") {
    return formatGreboError(error);
  }
  if (provider === "abliner") {
    return formatAblinerError(error);
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
  isVodacomPhone,
  isPesapalPhone,
  getMobilePrefix2,
  resolveProvider,
  getRoutingLabel,
  formatApiError
};
