import test from 'node:test';
import assert from 'node:assert/strict';
import {createTelegaPayInvoice,getTelegaPayInvoice} from '../src/telegapay.js';

const config={telegaPay:{apiKey:'secret',baseUrl:'https://secure.telegapay.link/api/v1'}};

test('TelegaPay creates an SBP RUB payment link with API key',async()=>{const original=global.fetch;global.fetch=async(url,options)=>{assert.equal(url,'https://secure.telegapay.link/api/v1/create_paylink');assert.equal(options.headers['X-API-Key'],'secret');const body=JSON.parse(options.body);assert.equal(body.amount,500);assert.equal(body.currency,'RUB');assert.equal(body.payment_method,'SBP');assert.equal(body.order_id,'topup-id');return new Response(JSON.stringify({success:true,transaction_id:'tx-1',payment_url:'https://pay.example/tx-1',amount:500,status:'awaiting'}),{status:200,headers:{'content-type':'application/json'}})};try{assert.deepEqual(await createTelegaPayInvoice(config,{amount:500,userId:42,topupId:'topup-id'}),{transactionId:'tx-1',paymentUrl:'https://pay.example/tx-1',displayAmount:500,status:'awaiting'})}finally{global.fetch=original}});

test('TelegaPay checks transaction status',async()=>{const original=global.fetch;global.fetch=async(url,options)=>{assert.equal(url,'https://secure.telegapay.link/api/v1/check_status');assert.deepEqual(JSON.parse(options.body),{transaction_id:'tx-1'});return new Response(JSON.stringify({success:true,transaction_id:'tx-1',status:'completed',amount:500,currency:'RUB',type:'payin'}),{status:200,headers:{'content-type':'application/json'}})};try{assert.equal((await getTelegaPayInvoice(config,'tx-1')).status,'completed')}finally{global.fetch=original}});
