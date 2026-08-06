import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createHeleketInvoice, getHeleketInvoice, signHeleketBody } from '../src/heleket.js';

const config={heleket:{merchantId:'merchant-id',apiKey:'payment-key',baseUrl:'https://api.heleket.com'}};

test('Heleket signature is MD5(base64(JSON) + payment key)',()=>{
  const raw=JSON.stringify({uuid:'invoice-id'});
  const expected=crypto.createHash('md5').update(Buffer.from(raw).toString('base64')+'payment-key').digest('hex');
  assert.equal(signHeleketBody(raw,'payment-key'),expected);
});

test('creates RUB invoice and signs the exact request body',async()=>{
  const original=global.fetch;
  global.fetch=async(url,options)=>{
    assert.equal(url,'https://api.heleket.com/v1/payment');
    const payload=JSON.parse(options.body);
    assert.equal(payload.amount,'500');
    assert.equal(payload.currency,'RUB');
    assert.equal(payload.order_id,'topup-id');
    assert.equal(payload.theme,'dark');
    assert.equal(options.headers.merchant,'merchant-id');
    assert.equal(options.headers.sign,signHeleketBody(options.body,'payment-key'));
    return new Response(JSON.stringify({state:0,result:{uuid:'invoice-id',url:'https://pay.example/invoice-id',payment_status:'check'}}),{status:200,headers:{'content-type':'application/json'}});
  };
  try { assert.deepEqual(await createHeleketInvoice(config,{amount:500,topupId:'topup-id'}),{invoiceId:'invoice-id',paymentUrl:'https://pay.example/invoice-id',status:'check'}); }
  finally { global.fetch=original; }
});

test('requests current payment information by UUID',async()=>{
  const original=global.fetch;
  global.fetch=async(url,options)=>{
    assert.equal(url,'https://api.heleket.com/v1/payment/info');
    assert.deepEqual(JSON.parse(options.body),{uuid:'invoice-id'});
    return new Response(JSON.stringify({state:0,result:{uuid:'invoice-id',payment_status:'paid',amount:'500.00',currency:'RUB'}}),{status:200,headers:{'content-type':'application/json'}});
  };
  try { assert.equal((await getHeleketInvoice(config,'invoice-id')).payment_status,'paid'); }
  finally { global.fetch=original; }
});
