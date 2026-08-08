import crypto from 'node:crypto';

const normalizeInvoice = data => data?.invoice || data?.data?.invoice || data?.data || data;

let tokenCache={token:'',expiresAt:0,key:''};

export function lztReady(config){
  return Boolean(config?.lzt?.clientId && config?.lzt?.clientSecret && config?.lzt?.merchantId);
}

function extractApiMessage(data, fallback){
  const raw=data?.message ?? data?.error_description ?? data?.error ?? data?.errors?.[0]?.message;
  if(raw==null || raw==='') return fallback;
  if(typeof raw==='string') return raw;
  try{return JSON.stringify(raw);}catch{return String(raw);}
}

async function readResponse(response){
  const text=await response.text();
  if(!text) return {data:{},text:''};
  try{return {data:JSON.parse(text),text};}catch{return {data:{},text};}
}

async function getLztAccessToken(config){
  if(!lztReady(config)) throw Error('LZT Market пока не настроен');
  const key=`${config.lzt.clientId}:${config.lzt.clientSecret}`;
  if(tokenCache.token && tokenCache.key===key && Date.now()<tokenCache.expiresAt-60_000) return tokenCache.token;

  // Official LZT OpenAPI specifies multipart/form-data for /oauth/token.
  const form=new FormData();
  form.append('grant_type','client_credentials');
  form.append('client_id',String(config.lzt.clientId).trim());
  form.append('client_secret',String(config.lzt.clientSecret).trim());
  // "scope" is an array with spaceDelimited encoding; for one scope its wire value is simply "invoice".
  form.append('scope','invoice');

  const response=await fetch(config.lzt.oauthUrl||'https://api.lolz.team/oauth/token',{
    method:'POST',
    headers:{'Accept':'application/json'},
    body:form
  });
  const {data,text}=await readResponse(response);
  if(!response.ok){
    const fallback=text?.trim()?.slice(0,500) || `LZT OAuth: HTTP ${response.status}`;
    throw Error(extractApiMessage(data,fallback));
  }
  const token=data?.access_token ?? data?.data?.access_token;
  if(!token){
    const safe=text?.trim()?.slice(0,500);
    throw Error(`LZT OAuth не вернул access_token${safe?`: ${safe}`:''}`);
  }
  const expiresIn=Number(data?.expires_in ?? data?.data?.expires_in ?? 3600);
  tokenCache={token:String(token),expiresAt:Date.now()+Math.max(300,Number.isFinite(expiresIn)?expiresIn:3600)*1000,key};
  return tokenCache.token;
}

async function lztRequest(config,method,endpoint,payload){
  let token=await getLztAccessToken(config);
  const request=async bearer=>fetch(`${config.lzt.baseUrl}${endpoint}`,{
    method,
    headers:{
      'Authorization':`Bearer ${bearer}`,
      'Accept':'application/json',
      ...(payload?{'Content-Type':'application/json'}:{})
    },
    ...(payload?{body:JSON.stringify(payload)}:{})
  });

  let response=await request(token);
  if(response.status===401){
    tokenCache={token:'',expiresAt:0,key:''};
    token=await getLztAccessToken(config);
    response=await request(token);
  }

  const {data,text}=await readResponse(response);
  if(!response.ok){
    const fallback=text?.trim()?.slice(0,500) || `LZT Market API: HTTP ${response.status}`;
    throw Error(extractApiMessage(data,fallback));
  }
  return data;
}

export async function createLztInvoice(config,{amount,topupId,user}){
  const payload={
    currency:config.lzt.currency||'RUB',
    amount:Number(amount),
    payment_id:String(topupId),
    comment:`Пополнение баланса NAREVO · ${topupId}`,
    url_success:config.lzt.successUrl||'https://t.me/narevo_bot',
    merchant_id:Number(config.lzt.merchantId),
    required_telegram_id:Number(user?.id||0)||undefined,
    required_telegram_username:user?.username?`@${String(user.username).replace(/^@/,'')}`:undefined,
    lifetime:3600,
    additional_data:JSON.stringify({topupId:String(topupId),telegramId:Number(user?.id||0)}),
  };
  if(config.lzt.callbackUrl) payload.url_callback=config.lzt.callbackUrl;
  Object.keys(payload).forEach(k=>payload[k]===undefined&&delete payload[k]);

  const invoice=normalizeInvoice(await lztRequest(config,'POST','/invoice',payload));
  if(!invoice?.invoice_id||!invoice?.url) throw Error('LZT Market вернул неполные данные счёта');
  return {invoiceId:String(invoice.invoice_id),paymentUrl:invoice.url,status:invoice.status,raw:invoice};
}

export async function getLztInvoice(config,invoiceId){
  const data=await lztRequest(config,'GET',`/invoice?invoice_id=${encodeURIComponent(invoiceId)}`);
  return normalizeInvoice(data);
}

export function verifyLztWebhook(config,secret){
  const expected=String(config?.lzt?.merchantKey||'');
  const actual=String(secret||'');
  if(!expected||!actual)return false;
  const a=Buffer.from(expected);
  const b=Buffer.from(actual);
  return a.length===b.length&&crypto.timingSafeEqual(a,b);
}

export function __resetLztTokenCacheForTests(){
  tokenCache={token:'',expiresAt:0,key:''};
}
