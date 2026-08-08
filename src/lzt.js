import crypto from 'node:crypto';

const normalizeInvoice = data => data?.invoice || data?.data?.invoice || data?.data || data;

export function lztReady(config){
  return Boolean(config?.lzt?.apiToken && config?.lzt?.merchantId);
}

async function lztRequest(config, method, endpoint, payload){
  if(!lztReady(config)) throw Error('LZT Market пока не настроен');
  const response = await fetch(`${config.lzt.baseUrl}${endpoint}`, {
    method,
    headers: {
      'Authorization': `Bearer ${config.lzt.apiToken}`,
      'Accept': 'application/json',
      ...(payload ? {'Content-Type':'application/json'} : {})
    },
    ...(payload ? {body: JSON.stringify(payload)} : {})
  });
  let data={};
  try{ data=await response.json(); }catch{}
  if(!response.ok){
    const message=data?.message||data?.error||data?.errors?.[0]?.message||`LZT Market API: HTTP ${response.status}`;
    throw Error(typeof message==='string'?message:JSON.stringify(message));
  }
  return data;
}

export async function createLztInvoice(config,{amount,topupId,user}){
  const payload={
    currency: config.lzt.currency || 'RUB',
    amount: Number(amount),
    payment_id: String(topupId),
    comment: `Пополнение баланса NAREVO · ${topupId}`,
    url_success: `${config.publicUrl}/?payment=lzt-success`,
    url_callback: `${config.publicUrl}/api/payments/lzt/webhook`,
    merchant_id: Number(config.lzt.merchantId),
    lifetime: 3600,
    additional_data: JSON.stringify({topupId:String(topupId),telegramId:Number(user?.id||0)}),
    ...(user?.id ? {required_telegram_id:Number(user.id)} : {}),
    ...(user?.username ? {required_telegram_username:`@${String(user.username).replace(/^@/,'')}`} : {})
  };
  const invoice=normalizeInvoice(await lztRequest(config,'POST','/invoice',payload));
  if(!invoice?.invoice_id || !invoice?.url) throw Error('LZT Market вернул неполные данные счёта');
  return {invoiceId:String(invoice.invoice_id),paymentUrl:invoice.url,status:invoice.status,raw:invoice};
}

export async function getLztInvoice(config,invoiceId){
  const data=await lztRequest(config,'GET',`/invoice?invoice_id=${encodeURIComponent(invoiceId)}`);
  return normalizeInvoice(data);
}

export function verifyLztWebhook(config,secret){
  const expected=String(config?.lzt?.merchantToken||'');
  const actual=String(secret||'');
  if(!expected||!actual)return false;
  const a=Buffer.from(expected);
  const b=Buffer.from(actual);
  return a.length===b.length && crypto.timingSafeEqual(a,b);
}
