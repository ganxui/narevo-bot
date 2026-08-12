import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  createCasheraSbpPayment,
  getCasheraTransaction,
  getCasheraTransactionByExternalId,
  casheraReady,
  verifyCasheraWebhook
} from '../src/cashera.js';

const config={
  publicUrl:'https://bot.example',
  cashera:{
    apiKey:'pk_test',
    apiSecret:'sk_test',
    baseUrl:'https://api.cashera.cash/api/v1',
    callbackUrl:'https://bot.example/webhooks/cashera',
    successUrl:'https://bot.example/pay/ok',
    failUrl:'https://bot.example/pay/fail',
    retryBaseMs:0
  }
};

test('Cashera creates SBP payment with required URLs and kopecks',async()=>{
  const previous=global.fetch;
  global.fetch=async(url,options)=>{
    assert.equal(url,'https://api.cashera.cash/api/v1/integration/transactions');
    assert.equal(options.method,'POST');
    assert.equal(options.headers['X-Api-Key'],'pk_test');
    assert.equal(options.headers['Content-Type'],'application/json');
    const payload=JSON.parse(options.body);
    assert.deepEqual(payload,{
      amount:57000,
      currency:'RUB',
      payment_method:'sbp',
      external_id:'topup-1',
      description:'Пополнение баланса NAREVO · topup-1',
      callback_url:'https://bot.example/webhooks/cashera',
      success_url:'https://bot.example/pay/ok',
      fail_url:'https://bot.example/pay/fail'
    });
    return new Response(JSON.stringify({
      uuid:'tx-1',
      external_id:'topup-1',
      status:'pending',
      amount:57000,
      currency:'RUB',
      payment_url:'https://pay.cashera.cash/tx-1'
    }),{status:201,headers:{'content-type':'application/json'}});
  };
  try{
    const out=await createCasheraSbpPayment(config,{paymentAmount:570,topupId:'topup-1'});
    assert.equal(out.uuid,'tx-1');
    assert.equal(out.amount,57000);
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

test('Cashera gets transaction status by external_id',async()=>{
  const previous=global.fetch;
  global.fetch=async(url,options)=>{
    assert.equal(url,'https://api.cashera.cash/api/v1/integration/transactions/by-external-id/topup-1');
    assert.equal(options.headers['X-Api-Key'],'pk_test');
    return new Response(JSON.stringify({uuid:'tx-1',external_id:'topup-1',status:'pending',amount:57000,currency:'RUB',payment_method:'sbp'}),{status:200});
  };
  try{assert.equal((await getCasheraTransactionByExternalId(config,'topup-1')).uuid,'tx-1');}
  finally{global.fetch=previous;}
});

test('Cashera webhook requires both API key and secret',()=>{
  assert.equal(verifyCasheraWebhook(config,{'x-api-key':'pk_test','x-secret':'sk_test'}),true);
  assert.equal(verifyCasheraWebhook(config,{'x-api-key':'pk_test','x-secret':'wrong'}),false);
  assert.equal(verifyCasheraWebhook(config,{'x-api-key':'wrong','x-secret':'sk_test'}),false);
  assert.equal(verifyCasheraWebhook(config,new Headers({'X-Api-Key':'pk_test','X-Secret':'sk_test'})),true);
});

test('Cashera retries retryable HTTP errors with the same external_id',async()=>{
  const previous=global.fetch;
  let calls=0;
  global.fetch=async(url,options)=>{
    calls+=1;
    const payload=JSON.parse(options.body);
    assert.equal(payload.external_id,'same-order');
    if(calls===1)return new Response(JSON.stringify({message:'provider unavailable'}),{status:502});
    return new Response(JSON.stringify({uuid:'tx-retry',external_id:'same-order',status:'pending',amount:10000,currency:'RUB',payment_url:'https://pay.cashera.cash/retry'}),{status:201});
  };
  try{
    const out=await createCasheraSbpPayment(config,{paymentAmount:100,topupId:'same-order'});
    assert.equal(calls,2);
    assert.equal(out.uuid,'tx-retry');
  }finally{global.fetch=previous;}
});

test('Cashera surfaces 422 validation details',async()=>{
  const previous=global.fetch;
  global.fetch=async()=>new Response(JSON.stringify({errors:{callback_url:['must be https']}}),{status:422});
  try{
    await assert.rejects(()=>createCasheraSbpPayment(config,{paymentAmount:100,topupId:'bad-order'}),/422.*callback_url.*must be https/);
  }finally{global.fetch=previous;}
});

test('Cashera refuses non-HTTPS public callback configuration',async()=>{
  const bad={...config,cashera:{...config.cashera,callbackUrl:'http://localhost:3000/webhooks/cashera'}};
  assert.equal(casheraReady(bad),false);
  await assert.rejects(()=>createCasheraSbpPayment(bad,{paymentAmount:100,topupId:'x'}),/PUBLIC_URL.*HTTPS/);
});

test('Cashera store persists transaction fields and webhook is idempotent by uuid + status',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'narevo-cashera-'));
  fs.mkdirSync(path.join(temp,'data'),{recursive:true});
  fs.writeFileSync(path.join(temp,'data','store.json'),JSON.stringify({
    categories:[],products:[],codes:[],users:{},orders:[],topups:[],tickets:[],audit:[],uiMessages:{},settings:{}
  }));
  const storeUrl=pathToFileURL(path.resolve('src/store.js')).href+`?test=${Date.now()}`;
  const code=`
    import assert from 'node:assert/strict';
    const store=await import(${JSON.stringify(storeUrl)});
    const user={id:123,first_name:'Tester',username:'tester'};
    store.userView(user);
    const topup=store.requestTopup(user,500,'sbp');
    store.attachCasheraSbpTransaction(topup.id,{uuid:'tx-idem',external_id:topup.id,status:'pending',amount:57000,currency:'RUB',payment_method:'sbp',payment_url:'https://pay.example/tx-idem',created_at:'2026-08-12T10:00:00Z'});
    const tx={uuid:'tx-idem',external_id:topup.id,status:'paid',amount:57000,currency:'RUB',payment_method:'sbp',paid_at:'2026-08-12T10:01:00Z'};
    const first=store.processCasheraWebhookTransaction(tx);
    const second=store.processCasheraWebhookTransaction(tx);
    assert.equal(first.newlyApproved,true);
    assert.equal(second.duplicate,true);
    const view=store.userView(user);
    assert.equal(view.user.balance,500);
    const saved=JSON.parse((await import('node:fs')).readFileSync('data/store.json','utf8'));
    const savedTopup=saved.topups.find(x=>x.id===topup.id);
    assert.equal(savedTopup.casheraExternalId,topup.id);
    assert.equal(savedTopup.casheraTransactionUuid,'tx-idem');
    assert.equal(savedTopup.casheraStatus,'paid');
    assert.equal(savedTopup.casheraAmountMinor,57000);
    assert.equal(savedTopup.casheraCurrency,'RUB');
    assert.ok(savedTopup.casheraCreatedAt);
    assert.ok(savedTopup.casheraUpdatedAt);
    assert.equal(saved.casheraWebhookEvents.length,1);
  `;
  try{
    execFileSync(process.execPath,['--input-type=module','-e',code],{cwd:temp,stdio:'pipe'});
  }finally{
    fs.rmSync(temp,{recursive:true,force:true});
  }
});
