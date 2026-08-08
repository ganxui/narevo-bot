import crypto from 'node:crypto';

export function cryptoPayReady(config){return Boolean(config.cryptoPay.token)}
const baseUrl=config=>config.cryptoPay.testnet?'https://testnet-pay.crypt.bot':'https://pay.crypt.bot';

async function call(config,method,payload={}){
  if(!cryptoPayReady(config))throw Error('CryptoBot ещё не настроен');
  const response=await fetch(`${baseUrl(config)}/api/${method}`,{method:'POST',headers:{'content-type':'application/json','Crypto-Pay-API-Token':config.cryptoPay.token},body:JSON.stringify(payload)});
  const data=await response.json().catch(()=>({ok:false,error:{name:`HTTP_${response.status}`}}));
  if(!response.ok||!data.ok)throw Error(`CryptoBot: ${data.error?.name||data.error||`HTTP ${response.status}`}`);
  return data.result;
}

export async function createCryptoPayInvoice(config,{amount,userId,topupId}){
  const invoice=await call(config,'createInvoice',{currency_type:'fiat',fiat:'RUB',accepted_assets:'USDT',amount:String(amount),description:`Пополнение NAREVO · ${topupId.slice(0,8)}`,payload:topupId,expires_in:3600,allow_comments:false,allow_anonymous:false});
  const paymentUrl=invoice.bot_invoice_url||invoice.mini_app_invoice_url||invoice.web_app_invoice_url;
  if(!invoice.invoice_id||!paymentUrl)throw Error('CryptoBot вернул неполные данные счёта');
  return {invoiceId:String(invoice.invoice_id),paymentUrl,userId};
}

export async function getCryptoPayInvoices(config,invoiceIds){
  const ids=[...new Set((invoiceIds||[]).map(String).filter(Boolean))];
  if(!ids.length)return [];
  const result=await call(config,'getInvoices',{invoice_ids:ids.join(',')});
  return Array.isArray(result)?result:(result.items||[]);
}

export async function getCryptoPayInvoice(config,invoiceId){
  const invoice=(await getCryptoPayInvoices(config,[invoiceId]))[0];
  if(!invoice)throw Error('Счёт CryptoBot не найден');
  return invoice;
}

export function verifyCryptoPayWebhook(token,rawBody,signature){if(!token||!signature)return false;const secret=crypto.createHash('sha256').update(token).digest();const expected=crypto.createHmac('sha256',secret).update(rawBody).digest('hex');const left=Buffer.from(expected);const right=Buffer.from(String(signature));return left.length===right.length&&crypto.timingSafeEqual(left,right)}
