export const telegaPayReady=config=>Boolean(config.telegaPay?.apiKey);

async function callTelegaPay(config,path,payload){
  if(!telegaPayReady(config))throw Error('TelegaPay пока не настроен');
  const response=await fetch(`${config.telegaPay.baseUrl}${path}`,{method:'POST',headers:{'content-type':'application/json','X-API-Key':config.telegaPay.apiKey},body:JSON.stringify(payload)});
  let data;try{data=await response.json()}catch{throw Error(`TelegaPay: неверный ответ (${response.status})`)}
  if(!response.ok||data.success===false){throw Error(`TelegaPay: ${data.error||`HTTP ${response.status}`}`)}
  return data;
}

export async function createTelegaPayInvoice(config,{amount,userId,topupId}){
  const result=await callTelegaPay(config,'/create_paylink',{amount:Number(amount),currency:'RUB',description:'Пополнение баланса NAREVO',order_id:topupId,payment_method:'SBP',user_id:String(userId)});
  const paymentUrl=result.proxy_payment_url||result.payment_url;
  if(!result.transaction_id||!paymentUrl)throw Error('TelegaPay не вернул ссылку на оплату');
  return {transactionId:String(result.transaction_id),paymentUrl,displayAmount:Number(result.display_amount||result.amount),status:result.status};
}

export function getTelegaPayInvoice(config,transactionId){return callTelegaPay(config,'/check_status',{transaction_id:String(transactionId)})}
