import test from 'node:test';
import assert from 'node:assert/strict';
import { createLztInvoice,getLztInvoice,verifyLztWebhook } from '../src/lzt.js';

const config={
  publicUrl:'https://example.com',
  lzt:{apiToken:'api-token',merchantId:'123',merchantToken:'merchant-secret',currency:'RUB',baseUrl:'https://prod-api.lzt.market'}
};

test('LZT webhook verifies x-secret-key against merchant token',()=>{
  assert.equal(verifyLztWebhook(config,'merchant-secret'),true);
  assert.equal(verifyLztWebhook(config,'wrong'),false);
});

test('LZT creates RUB invoice with callback and unique payment id',async()=>{
  const previous=global.fetch;
  let captured;
  global.fetch=async(url,options)=>{
    captured={url,options};
    return new Response(JSON.stringify({invoice:{invoice_id:77,url:'https://lzt.market/invoice/77/',status:'not_paid'}}),{status:200,headers:{'content-type':'application/json'}});
  };
  try{
    const out=await createLztInvoice(config,{amount:500,topupId:'topup-1',user:{id:123456,username:'tester'}});
    assert.equal(out.invoiceId,'77');
    assert.equal(captured.url,'https://prod-api.lzt.market/invoice');
    assert.equal(captured.options.headers.Authorization,'Bearer api-token');
    const body=JSON.parse(captured.options.body);
    assert.equal(body.currency,'RUB');
    assert.equal(body.amount,500);
    assert.equal(body.payment_id,'topup-1');
    assert.equal(body.merchant_id,123);
    assert.equal(body.url_callback,'https://example.com/api/payments/lzt/webhook');
    assert.equal(body.required_telegram_id,123456);
    assert.equal(body.required_telegram_username,'@tester');
  }finally{global.fetch=previous;}
});

test('LZT gets invoice status by invoice_id',async()=>{
  const previous=global.fetch;
  let url;
  global.fetch=async(input)=>{url=input;return new Response(JSON.stringify({invoice:{invoice_id:77,status:'paid',amount:500,payment_id:'topup-1',currency:'RUB'}}),{status:200,headers:{'content-type':'application/json'}})};
  try{
    const invoice=await getLztInvoice(config,77);
    assert.equal(url,'https://prod-api.lzt.market/invoice?invoice_id=77');
    assert.equal(invoice.status,'paid');
  }finally{global.fetch=previous;}
});
