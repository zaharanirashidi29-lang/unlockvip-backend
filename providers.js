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

function isClickPesaPhone(phone) {
  return isTigoPhone(phone) || isHalotelPhone(phone);
}

function resolveProvider(phone) {
  if (isClickPesaPhone(phone)) {
    return "clickpesa";
  }
  return "malipopay";
}

function getRoutingLabel() {
  return "Tigo/YAS + Halotel → ClickPesa USSD push, Vodacom + Airtel → MaliPoPay";
}

function formatApiError(error, provider) {
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
  isClickPesaPhone,
  getMobilePrefix2,
  resolveProvider,
  getRoutingLabel,
  formatApiError
};
