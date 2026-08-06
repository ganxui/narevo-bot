import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createCryptoPayInvoice,verifyCryptoPayWebhook } from '../src/cryptobot.js';

test('CryptoBot webhook signature uses the raw request body',()=>{
  const token='123:test-token';const raw='{"update_type":"invoice_paid","payload":{"invoice_id":7}}';
  const secret=crypto.createHash('sha256').update(token).digest();
  const signature=crypto.createHmac('sha256',secret).update(raw).digest('hex');
  assert.equal(verifyCryptoPayWebhook(token,raw,signature),true);
  assert.equal(verifyCryptoPayWebhook(token,`${raw} `,signature),false);
});

test('CryptoBot invoice is RUB-priced and accepts only USDT',async()=>{
  const original=globalThis.fetch;let request;
  globalThis.fetch=async(url,options)=>{request={url,options};return new Response(JSON.stringify({ok:true,result:{invoice_id:42,bot_invoice_url:'https://t.me/CryptoBot?start=invoice'}}),{status:200,headers:{'content-type':'application/json'}})};
  try{const invoice=await createCryptoPayInvoice({cryptoPay:{token:'token',testnet:true}},{amount:500,userId:1,topupId:'12345678-test'});assert.equal(invoice.invoiceId,'42');const payload=JSON.parse(request.options.body);assert.equal(request.url,'https://testnet-pay.crypt.bot/api/createInvoice');assert.deepEqual({currency_type:payload.currency_type,fiat:payload.fiat,accepted_assets:payload.accepted_assets,amount:payload.amount},{currency_type:'fiat',fiat:'RUB',accepted_assets:'USDT',amount:'500'})}finally{globalThis.fetch=original}
});
