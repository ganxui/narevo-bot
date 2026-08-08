import crypto from 'node:crypto';

export const heleketReady = config => Boolean(config.heleket?.merchantId && config.heleket?.apiKey);

export function signHeleketBody(rawBody, apiKey) {
  const base64 = Buffer.from(rawBody, 'utf8').toString('base64');
  return crypto.createHash('md5').update(base64 + apiKey).digest('hex');
}

export function verifyHeleketWebhook(rawBody, apiKey) {
  let payload;
  try { payload = JSON.parse(rawBody || '{}'); } catch { return false; }
  const received = String(payload.sign || '');
  if (!received) return false;
  delete payload.sign;
  const normalized = JSON.stringify(payload).replace(/\//g, '\\/');
  const expected = signHeleketBody(normalized, apiKey);
  if (received.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

async function callHeleket(config, path, payload) {
  if (!heleketReady(config)) throw Error('Heleket пока не настроен');
  const rawBody = JSON.stringify(payload);
  const response = await fetch(`${config.heleket.baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      merchant: config.heleket.merchantId,
      sign: signHeleketBody(rawBody, config.heleket.apiKey),
    },
    body: rawBody,
  });
  let data;
  try { data = await response.json(); } catch { throw Error(`Heleket: неверный ответ (${response.status})`); }
  if (!response.ok || data.state !== 0 || !data.result) {
    const details = data.message || Object.values(data.errors || {}).flat().join(', ') || `HTTP ${response.status}`;
    throw Error(`Heleket: ${details}`);
  }
  return data.result;
}

export async function createHeleketInvoice(config, { amount, topupId }) {
  const payload = {
    amount: String(amount),
    currency: 'RUB',
    order_id: topupId,
    lifetime: 3600,
    is_payment_multiple: true,
    theme: 'dark',
    additional_data: topupId,
  };
  if (config.publicUrl && !/^https?:\/\/(localhost|127\.0\.0\.1)(?::|\/|$)/i.test(config.publicUrl)) {
    payload.url_callback = `${config.publicUrl}/api/payments/heleket/webhook`;
  }
  const result = await callHeleket(config, '/v1/payment', payload);
  if (!result.uuid || !result.url) throw Error('Heleket не вернул ссылку на оплату');
  return { invoiceId: result.uuid, paymentUrl: result.url, status: result.payment_status };
}

export function getHeleketInvoice(config, invoiceId) {
  return callHeleket(config, '/v1/payment/info', { uuid: String(invoiceId) });
}
