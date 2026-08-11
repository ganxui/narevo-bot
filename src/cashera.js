import crypto from 'node:crypto';

const constantTimeEqual=(a,b)=>{
  const left=Buffer.from(String(a||''));
  const right=Buffer.from(String(b||''));
  return left.length===right.length&&left.length>0&&crypto.timingSafeEqual(left,right);
};

export function casheraReady(config){
  return Boolean(config?.cashera?.apiKey);
}

async function casheraRequest(config,method,endpoint,payload){
  if(!casheraReady(config))throw Error('Cashera СБП пока не настроен');
  const response=await fetch(`${config.cashera.baseUrl}${endpoint}`,{
    method,
    headers:{
      'X-Api-Key':config.cashera.apiKey,
      'Accept':'application/json',
      ...(payload?{'Content-Type':'application/json'}:{})
    },
    ...(payload?{body:JSON.stringify(payload)}:{})
  });
  const raw=await response.text();
  let data={};
  try{data=raw?JSON.parse(raw):{}}catch{data={message:raw}}
  if(!response.ok){
    const details=Array.isArray(data?.errors)?data.errors.join('; '):data?.message||data?.error||raw||`HTTP ${response.status}`;
    throw Error(`Cashera API: ${details}`);
  }
  return data;
}

export async function createCasheraSbpPayment(config,{paymentAmount,topupId,user}){
  const payload={
    amount:Math.round(Number(paymentAmount)*100),
    currency:'RUB',
    payment_method:'sbp',
    external_id:String(topupId),
    description:`Пополнение баланса NAREVO · ${topupId}`,
    metadata:{telegram_id:Number(user?.id||0),balance_topup_id:String(topupId)}
  };
  if(config.cashera.callbackUrl)payload.callback_url=config.cashera.callbackUrl;
  const tx=await casheraRequest(config,'POST','/integration/transactions',payload);
  if(!tx?.uuid||!tx?.payment_url)throw Error('Cashera вернула неполные данные платежа');
  return {uuid:String(tx.uuid),paymentUrl:String(tx.payment_url),status:tx.status,raw:tx};
}

export function getCasheraTransaction(config,uuid){
  return casheraRequest(config,'GET',`/integration/transactions/${encodeURIComponent(uuid)}`);
}

export function verifyCasheraWebhook(config,headers){
  return constantTimeEqual(headers?.['x-api-key'],config?.cashera?.apiKey)
    &&constantTimeEqual(headers?.['x-secret'],config?.cashera?.apiSecret);
}
