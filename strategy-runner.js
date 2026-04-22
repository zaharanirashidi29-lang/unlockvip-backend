const http = require('http');

function post(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        hostname: 'localhost',
        port: 10000,
        path: '/test-payout',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        }
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          try {
            resolve({ statusCode: res.statusCode, body: JSON.parse(raw) });
          } catch {
            resolve({ statusCode: res.statusCode, body: raw });
          }
        });
      }
    );

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeRef() {
  return 'PAYOUT_' + Date.now();
}

function logAttempt(attempt, payload, response) {
  console.log(
    JSON.stringify(
      {
        attempt,
        payload,
        httpStatus: response.statusCode,
        result_code:
          response.body?.error?.result_code ||
          response.body?.data?.result_code ||
          response.body?.data?.provider_response?.resultcode ||
          null,
        provider_response:
          response.body?.error?.provider_request ||
          response.body?.data?.provider_response ||
          response.body
      },
      null,
      2
    )
  );
}

(async () => {
  const firstPayload = {
    amount: 90000,
    msisdn: '255757230102',
    reference: makeRef()
  };

  const first = await post(firstPayload);
  logAttempt(1, firstPayload, first);

  const firstFailed = first.statusCode >= 400 || first.body?.success === false;
  if (!firstFailed) return;

  await sleep(10000);

  const secondPayload = {
    amount: 90000,
    msisdn: '255757230102',
    reference: makeRef()
  };

  const second = await post(secondPayload);
  logAttempt(2, secondPayload, second);

  const secondFailed = second.statusCode >= 400 || second.body?.success === false;
  if (!secondFailed) return;

  const thirdPayload = {
    amount: 5000,
    msisdn: '255757230102',
    reference: makeRef()
  };

  const third = await post(thirdPayload);
  logAttempt(3, thirdPayload, third);
})();
