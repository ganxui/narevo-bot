import test from 'node:test';
import assert from 'node:assert/strict';
import { createLztInvoice,getLztInvoice,verifyLztWebhook,__resetLztTokenCacheForTests } from '../src/lzt.js';

const config={
  lzt:{
    clientId:'client-id',clientSecret:'client-secret',merchantId:'123',merchantKey:'merchant-secret',
    currency:'RUB',baseUrl:'https://prod-api.lzt.market',oauthUrl:'https://api.lolz.team/oauth/token',
    successUrl:'https://t.me/narevo_bot',callbackUrl:''
  }
};

const tokenResponse=()=>new Response(JSON.stringify({access_token:'invoice-token',expires_in:3600}),{status:200,headers:{'content-type':'application/json'}});

test('LZT webhook verifies x-secret-key against merchant key',()=>{
  assert.equal(verifyLztWebhook(config,'merchant-secret'),true);
  assert.equal(verifyLztWebhook(config,'wrong'),false);
});

test('LZT obtains invoice token with client_credentials and creates invoice without callback',async()=>{
  __resetLztTokenCacheForTests();
  const previous=global.fetch;
  const calls=[];
  global.fetch=async(url,options)=>{
    calls.push({url,options});
    if(url==='https://api.lolz.team/oauth/token') return tokenResponse();
    return new Response(JSON.stringify({invoice:{invoice_id:77,url:'https://lzt.market/invoice/77/',status:'not_paid'}}),{status:200,headers:{'content-type':'application/json'}});
  };
  try{
    const out=await createLztInvoice(config,{amount:500,topupId:'topup-1',user:{id:123456,username:'tester'}});
    assert.equal(out.invoiceId,'77');
    assert.equal(calls.length,2);
    const oauthBody=JSON.parse(calls[0].options.body);
    assert.equal(oauthBody.grant_type,'client_credentials');
    assert.deepEqual(oauthBody.scope,['invoice']);
    assert.equal(oauthBody.client_id,'client-id');
    assert.equal(oauthBody.client_secret,'client-secret');
    assert.equal(calls[1].options.headers.Authorization,'Bearer invoice-token');
    const body=JSON.parse(calls[1].options.body);
    assert.equal(body.currency,'RUB');
    assert.equal(body.amount,500);
    assert.equal(body.payment_id,'topup-1');
    assert.equal(body.merchant_id,123);
    assert.equal(body.url_success,'https://t.me/narevo_bot');
    assert.equal('url_callback' in body,false);
    assert.equal(body.required_telegram_id,123456);
    assert.equal(body.required_telegram_username,'@tester');
  }finally{global.fetch=previous;}
});

test('LZT check button backend gets invoice status by invoice_id',async()=>{
  __resetLztTokenCacheForTests();
  const previous=global.fetch;
  const calls=[];
  global.fetch=async(url,options)=>{
    calls.push({url,options});
    if(url==='https://api.lolz.team/oauth/token') return tokenResponse();
    return new Response(JSON.stringify({invoice:{invoice_id:77,status:'paid',amount:500,payment_id:'topup-1',currency:'RUB'}}),{status:200,headers:{'content-type':'application/json'}});
  };
  try{
    const invoice=await getLztInvoice(config,77);
    assert.equal(calls[1].url,'https://prod-api.lzt.market/invoice?invoice_id=77');
    assert.equal(calls[1].options.headers.Authorization,'Bearer invoice-token');
    assert.equal(invoice.status,'paid');
  }finally{global.fetch=previous;}
});
