import crypto from 'node:crypto';

const normalizeInvoice = data => data?.invoice || data?.data?.invoice || data?.data || data;

let tokenCache={token:'',expiresAt:0,key:''};

export function lztReady(config){
  return Boolean(config?.lzt?.clientId && config?.lzt?.clientSecret && config?.lzt?.merchantId);
}

async function getLztAccessToken(config){
  if(!lztReady(config)) throw Error('LZT Market пока не настроен');
  const key=`${config.lzt.clientId}:${config.lzt.clientSecret}`;
  if(tokenCache.token && tokenCache.key===key && Date.now()<tokenCache.expiresAt-60_000) return tokenCache.token;

  const response=await fetch(config.lzt.oauthUrl||'https://api.lolz.team/oauth/token',{
    method:'POST',
    headers:{'Accept':'application/json','Content-Type':'application/json'},
    body:JSON.stringify({
      grant_type:'client_credentials',
      client_id:String(config.lzt.clientId),
      client_secret:String(config.lzt.clientSecret),
      scope:['invoice']
    })
  });
  let data={};
  try{data=await response.json();}catch{}
  if(!response.ok){
    const message=data?.message||data?.error_description||data?.error||`LZT OAuth: HTTP ${response.status}`;
    throw Error(typeof message==='string'?message:JSON.stringify(message));
  }
  const token=data?.access_token||data?.data?.access_token;
  if(!token) throw Error('LZT OAuth не вернул access_token');
  const expiresIn=Number(data?.expires_in||data?.data?.expires_in||3600);
  tokenCache={token:String(token),expiresAt:Date.now()+Math.max(300,expiresIn)*1000,key};
  return tokenCache.token;
}

async function lztRequest(config,method,endpoint,payload){
  const token=await getLztAccessToken(config);
  const doRequest=()=>fetch(`${config.lzt.baseUrl}${endpoint}`,{
    method,
    headers:{
      'Authorization':`Bearer ${tokenCache.token || token}`,
      'Accept':'application/json',
      ...(payload?{'Content-Type':'application/json'}:{})
    },
    ...(payload?{body:JSON.stringify(payload)}:{})
  });

  let response=await doRequest();
  if(response.status===401){
    tokenCache={token:'',expiresAt:0,key:''};
    await getLztAccessToken(config);
    response=await fetch(`${config.lzt.baseUrl}${endpoint}`,{
      method,
      headers:{
        'Authorization':`Bearer ${tokenCache.token}`,
        'Accept':'application/json',
        ...(payload?{'Content-Type':'application/json'}:{})
      },
      ...(payload?{body:JSON.stringify(payload)}:{})
    });
  }

  let data={};
  try{data=await response.json();}catch{}
  if(!response.ok){
    const rawMessage=data?.message??data?.error_description??data?.error??data?.errors?.[0]?.message;
    let message=rawMessage;
    if(message&&typeof message!=='string'){
      try{message=JSON.stringify(message);}catch{message=String(message);}
    }
    if(!message) message=`LZT Market API: HTTP ${response.status}`;
    throw Error(String(message));
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
