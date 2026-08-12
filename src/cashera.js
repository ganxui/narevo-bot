import crypto from 'node:crypto';

const RETRYABLE_STATUSES=new Set([429,500,502,503,504]);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

const constantTimeEqual=(a,b)=>{
  const leftValue=String(a||'');
  const rightValue=String(b||'');
  const left=crypto.createHash('sha256').update(leftValue).digest();
  const right=crypto.createHash('sha256').update(rightValue).digest();
  return Boolean(leftValue&&rightValue)&&crypto.timingSafeEqual(left,right);
};

const getHeader=(headers,name)=>{
  if(!headers)return '';
  if(typeof headers.get==='function')return headers.get(name)||'';
  const lower=name.toLowerCase();
  return headers[lower]??headers[name]??headers[name.toUpperCase()]??'';
};

const formatValidationErrors=errors=>{
  if(Array.isArray(errors))return errors.map(item=>typeof item==='string'?item:JSON.stringify(item)).join('; ');
  if(errors&&typeof errors==='object')return Object.entries(errors).map(([key,value])=>`${key}: ${Array.isArray(value)?value.join(', '):String(value)}`).join('; ');
  return errors?String(errors):'';
};

const responseMessage=(status,data,raw)=>{
  const details=formatValidationErrors(data?.errors)||data?.message||data?.error||raw||'';
  if(status===401)return 'Cashera: неверный CASHERA_API_KEY (401)';
  if(status===403)return `Cashera: доступ запрещён — проверьте мерчанта и публичный HTTPS callback_url (403)${details?`: ${details}`:''}`;
  if(status===422)return `Cashera: ошибка валидации (422)${details?`: ${details}`:''}`;
  if(status===429)return `Cashera: лимит запросов (429)${details?`: ${details}`:' — повторите позже'}`;
  if(status===502)return `Cashera: платёжный провайдер временно недоступен (502)${details?`: ${details}`:''}`;
  return `Cashera API: HTTP ${status}${details?` — ${details}`:''}`;
};

const isPublicHttpsUrl=value=>{
  try{
    const url=new URL(String(value||''));
    if(url.protocol!=='https:')return false;
    const host=url.hostname.toLowerCase();
    return Boolean(host)&&!['localhost','127.0.0.1','::1'].includes(host)&&!host.endsWith('.local');
  }catch{return false;}
};

export function casheraReady(config){
  const c=config?.cashera;
  return Boolean(c?.apiKey&&c?.apiSecret&&isPublicHttpsUrl(c?.callbackUrl)&&isPublicHttpsUrl(c?.successUrl)&&isPublicHttpsUrl(c?.failUrl));
}

function assertCasheraConfigured(config){
  if(!config?.cashera?.apiKey)throw Error('Cashera не настроен: добавьте CASHERA_API_KEY');
  if(!config?.cashera?.apiSecret)throw Error('Cashera не настроен: добавьте CASHERA_API_SECRET');
  if(!isPublicHttpsUrl(config?.cashera?.callbackUrl))throw Error('Cashera не настроен: PUBLIC_URL должен быть публичным HTTPS-адресом для /webhooks/cashera');
  if(!isPublicHttpsUrl(config?.cashera?.successUrl)||!isPublicHttpsUrl(config?.cashera?.failUrl))throw Error('Cashera не настроен: success_url/fail_url должны быть публичными HTTPS URL');
}

async function parseResponse(response){
  const raw=await response.text();
  let data={};
  try{data=raw?JSON.parse(raw):{};}catch{data={message:raw};}
  return {raw,data};
}

async function casheraRequest(config,method,endpoint,payload,{maxAttempts=4}={}){
  assertCasheraConfigured(config);
  const body=payload===undefined?undefined:JSON.stringify(payload);
  const baseDelay=Math.max(0,Number(config?.cashera?.retryBaseMs??250));
  let lastError;

  for(let attempt=0;attempt<maxAttempts;attempt+=1){
    let response;
    try{
      response=await fetch(`${config.cashera.baseUrl}${endpoint}`,{
        method,
        headers:{
          'X-Api-Key':config.cashera.apiKey,
          'Accept':'application/json',
          ...(body!==undefined?{'Content-Type':'application/json'}:{})
        },
        ...(body!==undefined?{body}:{}),
        signal:AbortSignal.timeout(15_000)
      });
    }catch(error){
      lastError=error;
      if(attempt<maxAttempts-1){
        await sleep(baseDelay*(2**attempt));
        continue;
      }
      throw Error(`Cashera: сетевая ошибка после ${maxAttempts} попыток — ${error?.message||'request failed'}`);
    }

    const {raw,data}=await parseResponse(response);
    if(response.ok)return data;

    const retryable=RETRYABLE_STATUSES.has(response.status)||response.status>=500;
    if(retryable&&attempt<maxAttempts-1){
      let delay=baseDelay*(2**attempt);
      if(response.status===429){
        const retryAfter=Number(response.headers.get('retry-after'));
        if(Number.isFinite(retryAfter)&&retryAfter>=0)delay=Math.max(delay,retryAfter*1000);
      }
      await sleep(delay);
      continue;
    }

    const error=new Error(responseMessage(response.status,data,raw));
    error.statusCode=response.status;
    error.cashera=data;
    throw error;
  }

  throw lastError||Error('Cashera: запрос не выполнен');
}

export async function createCasheraSbpPayment(config,{paymentAmount,topupId}){
  assertCasheraConfigured(config);
  const amountMinor=Math.round(Number(paymentAmount)*100);
  if(!Number.isInteger(amountMinor)||amountMinor<=0)throw Error('Cashera: некорректная сумма платежа');
  const externalId=String(topupId||'').trim();
  if(!externalId)throw Error('Cashera: external_id обязателен');

  const payload={
    amount:amountMinor,
    currency:'RUB',
    payment_method:'sbp',
    external_id:externalId,
    description:`Пополнение баланса NAREVO · ${externalId}`.slice(0,255),
    callback_url:config.cashera.callbackUrl,
    success_url:config.cashera.successUrl,
    fail_url:config.cashera.failUrl
  };

  const transaction=await casheraRequest(config,'POST','/integration/transactions',payload);
  if(!transaction?.uuid||!transaction?.payment_url)throw Error('Cashera вернула неполные данные платежа');
  return {
    uuid:String(transaction.uuid),
    externalId:String(transaction.external_id||externalId),
    paymentUrl:String(transaction.payment_url),
    status:String(transaction.status||'pending'),
    amount:Number(transaction.amount??amountMinor),
    currency:String(transaction.currency||'RUB').toUpperCase(),
    transaction
  };
}

export function getCasheraTransaction(config,uuid){
  return casheraRequest(config,'GET',`/integration/transactions/${encodeURIComponent(uuid)}`,undefined);
}

export function getCasheraTransactionByExternalId(config,externalId){
  return casheraRequest(config,'GET',`/integration/transactions/by-external-id/${encodeURIComponent(externalId)}`,undefined);
}

export function verifyCasheraWebhook(config,headers){
  return constantTimeEqual(getHeader(headers,'X-Api-Key'),config?.cashera?.apiKey)
    &&constantTimeEqual(getHeader(headers,'X-Secret'),config?.cashera?.apiSecret);
}
