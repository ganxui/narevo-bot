import test from 'node:test';
import assert from 'node:assert/strict';
import { createCasheraSbpPayment,getCasheraTransaction,verifyCasheraWebhook } from '../src/cashera.js';

const config={cashera:{apiKey:'pk_test',apiSecret:'sk_test',baseUrl:'https://api.cashera.cash/api/v1',callbackUrl:'https://bot.example/api/payments/cashera/webhook'}};

test('Cashera creates SBP payment in kopecks and sends callback URL',async()=>{
  const previous=global.fetch;
  global.fetch=async(url,options)=>{
    assert.equal(url,'https://api.cashera.cash/api/v1/integration/transactions');
    assert.equal(options.headers['X-Api-Key'],'pk_test');
    const payload=JSON.parse(options.body);
    assert.equal(payload.amount,57000);
    assert.equal(payload.currency,'RUB');
    assert.equal(payload.payment_method,'sbp');
    assert.equal(payload.external_id,'topup-1');
    assert.equal(payload.callback_url,'https://bot.example/api/payments/cashera/webhook');
    return new Response(JSON.stringify({uuid:'tx-1',status:'pending',payment_url:'https://pay.cashera.cash/tx-1'}),{status:201,headers:{'content-type':'application/json'}});
  };
  try{
    const out=await createCasheraSbpPayment(config,{paymentAmount:570,topupId:'topup-1',user:{id:123}});
    assert.equal(out.uuid,'tx-1');
    assert.equal(out.paymentUrl,'https://pay.cashera.cash/tx-1');
  }finally{global.fetch=previous;}
});

test('Cashera gets transaction status by UUID',async()=>{
  const previous=global.fetch;
  global.fetch=async(url,options)=>{
    assert.equal(url,'https://api.cashera.cash/api/v1/integration/transactions/tx-1');
    assert.equal(options.headers['X-Api-Key'],'pk_test');
    return new Response(JSON.stringify({uuid:'tx-1',external_id:'topup-1',status:'paid',amount:57000,currency:'RUB',payment_method:'sbp'}),{status:200});
  };
  try{assert.equal((await getCasheraTransaction(config,'tx-1')).status,'paid');}
  finally{global.fetch=previous;}
});

test('Cashera webhook requires both API key and secret',()=>{
  assert.equal(verifyCasheraWebhook(config,{'x-api-key':'pk_test','x-secret':'sk_test'}),true);
  assert.equal(verifyCasheraWebhook(config,{'x-api-key':'pk_test','x-secret':'wrong'}),false);
  assert.equal(verifyCasheraWebhook(config,{'x-api-key':'wrong','x-secret':'sk_test'}),false);
});
