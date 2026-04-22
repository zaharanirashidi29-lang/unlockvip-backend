const crypto = require('crypto');
const axios = require('axios');

const APP_ID = 'CHUO_ASILI';
const SECRET_KEY = 'UrESzERfxSxNOcGmtigm5ovnztw49F7bJMuBFJJ/NeA=';

const payload = {
  action: 'disbursement',
  amount: 2000,
  msisdn: '255757230102',
  reference: 'PAYOUT_' + Date.now(),
  channel: 'MPESA'
};

const timestamp = Math.floor(Date.now() / 1000);
const payloadStr = JSON.stringify(payload);
const sign_str = payloadStr + timestamp;
const signature = crypto.createHmac('sha256', SECRET_KEY).update(sign_str).digest('base64');

console.log('PAYLOAD:', payloadStr);
console.log('TIMESTAMP:', timestamp);
console.log('SIGNATURE:', signature);

axios.post('https://paymentgw.textify.africa/api/v1/transact', payload, {
  headers: {
    'Content-Type': 'application/json',
    'X-App-ID': APP_ID,
    'X-Timestamp': timestamp,
    'X-Signature': signature
  }
}).then(res => {
  console.log('RESPONSE:', JSON.stringify(res.data, null, 2));
}).catch(err => {
  console.log('ERROR:', JSON.stringify(err.response?.data || err.message, null, 2));
});
