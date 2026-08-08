import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { verifyTelegram } from './security.js';
import { createCryptoPayInvoice,cryptoPayReady,getCryptoPayInvoice,getCryptoPayInvoices,verifyCryptoPayWebhook } from './cryptobot.js';
import { createHeleketInvoice,getHeleketInvoice,heleketReady,verifyHeleketWebhook } from './heleket.js';
import { userView,adminView,buy,requestTopup,attachCryptoPayInvoice,attachHeleketInvoice,failTopup,settleCryptoPayInvoice,settleHeleketInvoice,addCodes,approveTopup,addProduct,archiveProduct,addCategory,toggleCategory,updateProductPrice,setProductCategory,createTicket,addTicketMessage,closeTicket,getUiMessage,setUiMessage,getButtonEmojis,setButtonEmojis,setUserAgreed,hasUserAgreed,getAllUserIds,isBotEnabled,setBotEnabled,getPendingHeleketTopups,getRecentTopups } from './store.js';

const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'};
const json=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data));};
const rawBody=req=>new Promise((resolve,reject)=>{let s='';req.setEncoding('utf8');req.on('data',c=>{s+=c;if(s.length>1e6){reject(Error('Request body too large'));req.destroy()}});req.on('end',()=>resolve(s));req.on('error',reject)});
const body=async req=>{const raw=await rawBody(req);return raw?JSON.parse(raw):{}};
const auth=req=>verifyTelegram(req.headers['x-telegram-init-data']||'');
const notify=async(chatId,text)=>{if(config.token) await fetch(`https://api.telegram.org/bot${config.token}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:chatId,text,parse_mode:'HTML'})});};
async function settleCryptoInvoiceData(invoice){
  if(!invoice||invoice.status!=='paid')return {invoice,settled:null};
  if(invoice.currency_type!=='fiat'||String(invoice.fiat).toUpperCase()!=='RUB'||String(invoice.paid_asset).toUpperCase()!=='USDT')throw Error('Данные оплаты CryptoBot не совпадают');
  if(!invoice.payload||!invoice.invoice_id)throw Error('CryptoBot вернул неполные данные оплаченного счёта');
  const settled=settleCryptoPayInvoice(invoice.payload,invoice.invoice_id,invoice.amount);
  if(settled.newlyApproved)await notify(settled.userId,`✅ CryptoBot подтвердил оплату в USDT. Баланс пополнен на <b>${settled.amount} ₽</b>.`);
  return {invoice,settled};
}
async function verifyAndSettleCryptoInvoice(invoiceId){return settleCryptoInvoiceData(await getCryptoPayInvoice(config,invoiceId))}

let cryptoReconcileRunning=false;
async function reconcilePendingCryptoTopups(){
  if(!cryptoPayReady(config)||cryptoReconcileRunning)return;
  const pending=adminView().topups.filter(t=>t.method==='cryptobot'&&t.status==='pending'&&t.cryptoPayInvoiceId).slice(0,100);
  if(!pending.length)return;
  cryptoReconcileRunning=true;
  try{
    const invoices=await getCryptoPayInvoices(config,pending.map(t=>t.cryptoPayInvoiceId));
    for(const invoice of invoices){
      if(invoice.status!=='paid')continue;
      try{await settleCryptoInvoiceData(invoice)}catch(e){console.error(`[CryptoBot reconcile] invoice ${invoice.invoice_id}: ${e.message}`)}
    }
  }catch(e){
    console.error(`[CryptoBot reconcile] ${e.message}`);
  }finally{
    cryptoReconcileRunning=false;
  }
}
async function verifyAndSettleHeleketInvoice(invoiceId){const invoice=await getHeleketInvoice(config,invoiceId);const status=invoice.payment_status||invoice.status;if(!['paid','paid_over'].includes(status))return {invoice,status,settled:null};if(String(invoice.currency).toUpperCase()!=='RUB')throw Error('Валюта счёта Heleket не совпадает');const topupId=invoice.order_id||invoice.additional_data;const settled=settleHeleketInvoice(topupId,invoice.uuid||invoiceId,invoice.amount);if(settled.newlyApproved)await notify(settled.userId,`✅ Heleket подтвердил криптооплату. Баланс пополнен на <b>${settled.amount} ₽</b>.`);return {invoice,status,settled}}
let heleketReconcileRunning=false;
async function reconcilePendingHeleketTopups(){
  if(heleketReconcileRunning||!heleketReady(config))return;
  heleketReconcileRunning=true;
  try{
    for(const topup of getPendingHeleketTopups()){
      try{await verifyAndSettleHeleketInvoice(topup.heleketInvoiceId)}catch(e){console.error(`[Heleket reconcile] ${topup.id}: ${e.message}`)}
    }
  }finally{heleketReconcileRunning=false}
}

const server=http.createServer(async(req,res)=>{try{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/api/payments/cryptobot/webhook'&&req.method==='POST'){const raw=await rawBody(req);if(!verifyCryptoPayWebhook(config.cryptoPay.token,raw,req.headers['crypto-pay-api-signature']))return json(res,401,{error:'Invalid CryptoBot signature'});const update=JSON.parse(raw||'{}');if(update.update_type!=='invoice_paid')return json(res,200,{ok:true});await settleCryptoInvoiceData(update.payload);return json(res,200,{ok:true})}
  if(pathname==='/api/payments/heleket/webhook'&&req.method==='POST'){const raw=await rawBody(req);if(!verifyHeleketWebhook(raw,config.heleket.apiKey))return json(res,401,{error:'Invalid Heleket signature'});const update=JSON.parse(raw||'{}');if(update.type!=='payment'||!['paid','paid_over'].includes(update.status))return json(res,200,{ok:true});if(String(update.currency).toUpperCase()!=='RUB')return json(res,400,{error:'Heleket currency mismatch'});const settled=settleHeleketInvoice(update.order_id||update.additional_data,update.uuid,update.amount);if(settled.newlyApproved)await notify(settled.userId,`✅ Heleket подтвердил криптооплату. Баланс пополнен на <b>${settled.amount} ₽</b>.`);return json(res,200,{ok:true})}
  if(req.url.startsWith('/api/')){const user=auth(req); const admin=config.admins.has(user.id)||(config.demo&&user.id===10001); const b=req.method==='POST'?await body(req):{};
    if(req.url==='/api/me'&&req.method==='GET') return json(res,200,{...userView(user),isAdmin:admin});
    if(req.url==='/api/buy'&&req.method==='POST'){const out=buy(user,b.productId);await notify(user.id,`✅ Заказ <b>${out.title}</b> выполнен. Код доступен в разделе «Покупки».`);return json(res,200,out)}
    if(req.url==='/api/topups'&&req.method==='POST'){const out=requestTopup(user,Number(b.amount));for(const a of config.admins)await notify(a,`💳 Новая заявка на пополнение: ${out.amount} ₽, пользователь ${user.id}`);return json(res,200,out)}
    if(!admin) return json(res,403,{error:'Нет доступа'});
    if(req.url==='/api/admin'&&req.method==='GET')return json(res,200,adminView());
    if(req.url==='/api/admin/codes'&&req.method==='POST')return json(res,200,{added:addCodes(user.id,b.productId,b.codes||[])});
    if(req.url==='/api/admin/topups/approve'&&req.method==='POST'){const t=approveTopup(user.id,b.id);await notify(t.userId,`✅ Баланс пополнен на <b>${t.amount} ₽</b>.`);return json(res,200,t)}
    if(req.url==='/api/admin/products'&&req.method==='POST')return json(res,200,addProduct(user.id,b));
    return json(res,404,{error:'Не найдено'});
  }
  let target=pathname==='/'?'public/index.html':`public${pathname}`; target=path.normalize(target); if(!target.startsWith('public')){res.writeHead(403);return res.end()};
  if(!fs.existsSync(target)||fs.statSync(target).isDirectory()){res.writeHead(404);return res.end('Not found')}; res.writeHead(200,{'content-type':types[path.extname(target)]||'application/octet-stream'});fs.createReadStream(target).pipe(res);
}catch(e){json(res,e.message.includes('Telegram')?401:400,{error:e.message})}});

const transientMessages=new Map();

async function logTelegramError(method,response){
  if(response.ok)return;
  try{
    const data=await response.clone().json();
    console.error(`[Telegram API] ${method}: ${data.description||`HTTP ${response.status}`}`);
  }catch{
    console.error(`[Telegram API] ${method}: HTTP ${response.status}`);
  }
}

const tgApi=async(method,payload)=>{
  const request=(name,data)=>fetch(`https://api.telegram.org/bot${config.token}/${name}`,{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify(data)
  });

  let response=await request(method,payload);

  if(method==='editMessageText'&&!response.ok){
    response=await request('editMessageCaption',{
      chat_id:payload.chat_id,
      message_id:payload.message_id,
      caption:payload.text,
      parse_mode:payload.parse_mode,
      reply_markup:payload.reply_markup
    });
  }

  if(method==='editMessageMedia'&&!response.ok){
    response=await request('editMessageCaption',{
      chat_id:payload.chat_id,
      message_id:payload.message_id,
      caption:payload.media.caption,
      parse_mode:payload.media.parse_mode,
      reply_markup:payload.reply_markup
    });
  }

  await logTelegramError(method,response);

  if(method==='sendMessage'&&response.ok&&/^(Введите|Отправьте|✍️)/.test(payload.text||'')){
    const data=await response.clone().json();
    transientMessages.set(payload.chat_id,data.result.message_id);
  }

  if(method==='sendMessage'&&response.ok&&/^✅ (Сохранено|Заявка)/.test(payload.text||'')){
    const data=await response.clone().json();
    const uiId=getUiMessage(payload.chat_id);
    if(uiId){
      await request('deleteMessage',{chat_id:payload.chat_id,message_id:uiId});
      setUiMessage(payload.chat_id,null);
    }
    setTimeout(()=>request('deleteMessage',{chat_id:payload.chat_id,message_id:data.result.message_id}),4000);
  }

  return response;
};
const money=n=>`${Number(n).toLocaleString('ru-RU')} ₽`;

const topupStatusLabel=status=>({approved:'✅ Зачислено',pending:'🕓 Ожидает',failed:'❌ Ошибка',rejected:'❌ Отклонено'}[status]||`• ${status||'неизвестно'}`);
const topupMethodLogLabel=method=>({cryptobot:'CryptoBot',heleket:'Heleket',sbp:'СБП',sbp14:'СБП'}[method]||String(method||'Другое'));
const formatLogTime=value=>{
  const d=new Date(value);
  if(Number.isNaN(d.getTime()))return '—';
  return new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(d).replace(',', '');
};
const html=value=>String(value??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const button=(text,callback_data,style,icon_custom_emoji_id)=>({text,callback_data,...(style?{style}:{}),...(icon_custom_emoji_id?{icon_custom_emoji_id}:{})});
const linkButton=(text,url,style)=>({text,url,...(style?{style}:{})});
const pendingInput=new Map();
const broadcastDrafts=new Map();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

const menu=(user,admin)=>({inline_keyboard:[[button('🛍 Каталог','catalog','primary'),button('👤 Кабинет','profile')],[button('📦 Покупки','orders'),button('💳 Пополнить','topup')],[button('📜 Правила','rules'),button('💬 Поддержка','support')],[button('🔒 Политика конфиденциальности','privacy')],[button('📄 Пользовательское соглашение','terms')],...(admin?[[button('⚙️ Админ-панель','admin')]]:[])]});

const welcomeMenu = () => ({
  inline_keyboard: [
    [button('🔒 Политика конфиденциальности', 'privacy', 'primary')],
    [button('📄 Пользовательское соглашение', 'terms', 'primary')],
    [button('✅ Подтверждаю', 'agree', 'success')]
  ]
});

const quickSections=new Map([['🛍 Каталог','catalog'],['👤 Кабинет','profile'],['📦 Покупки','orders'],['💳 Пополнить','topup'],['💬 Поддержка','support']]);
const quickMenu=()=>({keyboard:[[{text:'🛍 Каталог'},{text:'👤 Кабинет'}],[{text:'📦 Покупки'},{text:'💳 Пополнить'}],[{text:'💬 Поддержка'}]],resize_keyboard:true,is_persistent:true,input_field_placeholder:'Выберите раздел NAREVO'});
const paymentButton=(label,fallbackIcon,callback,style,customIcon)=>button(`${customIcon?'':`${fallbackIcon} `}${label}`,callback,style,customIcon);
const paymentEmojis=()=>({...config.buttonEmoji,...getButtonEmojis()});
const paymentLabel=method=>{
  const labels = {
    'sbp': 'СБП НСПК · 14%',
    'sbp14': 'СБП НСПК · 14%',
    'heleket': 'Crypto · Heleket',
    'cryptobot': 'CryptoBot · USDT'
  };
  return labels[method] || method;
};
const topupSummary=t=>{const payable=Number(t.displayAmount??t.paymentAmount??t.amount);const fee=Math.round((payable-Number(t.amount))*100)/100;return `На баланс: <b>${money(t.amount)}</b>\nКомиссия: <b>${money(fee)}</b>\nК оплате: <b>${money(payable)}</b>`};
async function installQuickMenu(chatId){const response=await tgApi('sendMessage',{chat_id:chatId,text:'Быстрое меню включено.',reply_markup:quickMenu()});if(response.ok){const sent=await response.clone().json();await tgApi('deleteMessage',{chat_id:chatId,message_id:sent.result.message_id})}}
const imageForSection=section=>{let name='catalog';if(section==='home')return config.productImageUrl;if(section==='profile')name='profile';else if(section==='orders')name='orders';else if(section==='topup'||section.startsWith('paymethod:')||section.startsWith('topup_custom:'))name='pay';else if(section==='rules'||section.startsWith('rule:'))name='rules';else if(section==='support'||section.startsWith('ticket:'))name='support';else if(section.startsWith('admin')||section.startsWith('category_')||section.startsWith('product_')||section.startsWith('price_')||section.startsWith('codes_'))name='admin';else if(section==='privacy'||section==='terms'||section==='agree'||section==='welcome')name='rules';return `${config.sectionImageBaseUrl}/section-${name}.png?v=1`};
async function startCryptoBotTopup(user,amount){if(!cryptoPayReady(config))throw Error('CryptoBot пока не настроен');const topup=requestTopup(user,amount,'cryptobot');try{const invoice=await createCryptoPayInvoice(config,{amount:topup.amount,userId:user.id,topupId:topup.id});return attachCryptoPayInvoice(topup.id,invoice.invoiceId,invoice.paymentUrl)}catch(e){failTopup(topup.id,e.message);throw e}}
async function startHeleketTopup(user,amount){if(!heleketReady(config))throw Error('Heleket пока не настроен');const topup=requestTopup(user,amount,'heleket');try{const invoice=await createHeleketInvoice(config,{amount:topup.amount,topupId:topup.id});return attachHeleketInvoice(topup.id,invoice.invoiceId,invoice.paymentUrl)}catch(e){failTopup(topup.id,e.message);throw e}}
const heleketKeyboard=(invoiceId,paymentUrl,repeat=false)=>({inline_keyboard:[...(paymentUrl?[[linkButton('Оплатить через Heleket',paymentUrl,'primary')]]:[]),[button(repeat?'✅ Проверить ещё раз':'✅ Проверить оплату',`heleketcheck:${invoiceId}`,'success')],[button('← Главное меню','home')]]});

async function requireTelegramOk(response,fallbackMessage='Telegram API вернул ошибку'){
  if(response.ok)return response;
  let message=fallbackMessage;
  try{
    const data=await response.clone().json();
    if(data.description)message=data.description;
  }catch{}
  throw Error(message);
}

async function replaceUiWithText(chatId,messageId,text,reply_markup){
  const currentId=messageId||getUiMessage(chatId);

  if(currentId){
    await tgApi('deleteMessage',{
      chat_id:chatId,
      message_id:currentId
    });
  }

  setUiMessage(chatId,null);

  const response=await tgApi('sendMessage',{
    chat_id:chatId,
    text,
    parse_mode:'HTML',
    reply_markup
  });

  await requireTelegramOk(response,'Не удалось показать текстовый экран');

  const sent=await response.clone().json();
  setUiMessage(chatId,sent.result.message_id);
  return sent.result.message_id;
}

async function replaceUiWithHome(chatId,user,messageId){
  const currentId=messageId||getUiMessage(chatId);

  if(currentId){
    await tgApi('deleteMessage',{
      chat_id:chatId,
      message_id:currentId
    });
  }

  setUiMessage(chatId,null);

  const admin=await hasAdminAccess(user.id);
  const response=await tgApi('sendPhoto',{
    chat_id:chatId,
    photo:config.productImageUrl,
    caption:'<b>NAREVO MAIL</b>\nЦифровые коды подписок.\n\nВыберите раздел:',
    parse_mode:'HTML',
    reply_markup:menu(user,admin)
  });

  await requireTelegramOk(response,'Не удалось открыть главное меню');

  const sent=await response.clone().json();
  setUiMessage(chatId,sent.result.message_id);
  return sent.result.message_id;
}
async function hasAdminAccess(userId){if(config.admins.has(userId))return true;if(!config.adminChatId)return false;try{const r=await tgApi('getChatMember',{chat_id:config.adminChatId,user_id:userId});const d=await r.json();return d.ok&&['creator','administrator'].includes(d.result.status)}catch{return false}}

async function sendBroadcast(text){
  const userIds=[...new Set(getAllUserIds().map(Number).filter(Number.isFinite))];
  let sent=0, failed=0;
  for(const userId of userIds){
    try{
      const response=await tgApi('sendMessage',{chat_id:userId,text});
      if(response.ok)sent++; else failed++;
    }catch{
      failed++;
    }
    await sleep(55);
  }
  return {total:userIds.length,sent,failed};
}

async function showMaintenance(chatId){
  const currentId=getUiMessage(chatId);
  if(currentId){
    await tgApi('deleteMessage',{chat_id:chatId,message_id:currentId});
    setUiMessage(chatId,null);
  }
  const response=await tgApi('sendMessage',{
    chat_id:chatId,
    text:'🛠 <b>NAREVO MAIL временно остановлен</b>\n\nСейчас проводятся технические работы. Попробуйте позже.',
    parse_mode:'HTML'
  });
  if(response.ok){const data=await response.clone().json();setUiMessage(chatId,data.result.message_id)}
}

function getPrivacyPolicy() {
  return `🔒 <b>Политика конфиденциальности NAREVO MAIL</b>

📅 Актуальная версия: 07.08.2026

<b>1. Общие положения</b>

1.1. Настоящая Политика конфиденциальности регулирует порядок обработки и защиты информации, которую Пользователь передаёт при использовании сервиса NAREVO MAIL (Telegram-бот @narevojournal).

1.2. Используя Сервис, Пользователь подтверждает своё согласие с условиями Политики. Если Пользователь не согласен с условиями — он обязан прекратить использование Сервиса.

<b>2. Сбор информации</b>

2.1. Сервис может собирать следующие типы данных:
• идентификаторы аккаунта (Telegram ID, имя пользователя);
• техническую информацию (данные о браузере, устройстве);
• историю взаимодействий с Сервисом.

2.2. Сервис не требует от Пользователя предоставления паспортных данных, документов, фотографий или другой личной информации, кроме минимально необходимой для работы.

<b>3. Использование информации</b>

3.1. Сервис использует полученную информацию исключительно для:
• обеспечения работы функционала;
• связи с Пользователем (уведомления и поддержка);
• анализа и улучшения работы Сервиса.

<b>4. Передача информации третьим лицам</b>

4.1. Администрация не передаёт полученные данные третьим лицам, за исключением случаев:
• если это требуется по закону;
• если это необходимо для исполнения обязательств перед Пользователем (например, при работе с платёжными системами);
• если Пользователь сам дал на это согласие.

<b>5. Хранение и защита данных</b>

5.1. Данные хранятся в течение срока, необходимого для достижения целей обработки.

5.2. Администрация принимает разумные меры для защиты данных, но не гарантирует абсолютную безопасность информации при передаче через интернет.

<b>6. Отказ от ответственности</b>

6.1. Пользователь понимает и соглашается, что передача информации через интернет всегда сопряжена с рисками.

6.2. Администрация не несёт ответственности за утрату, кражу или раскрытие данных, если это произошло по вине третьих лиц или самого Пользователя.

<b>7. Изменения в Политике</b>

7.1. Администрация вправе изменять условия Политики без предварительного уведомления.

7.2. Продолжение использования Сервиса после внесения изменений означает согласие Пользователя с новой редакцией Политики.

<b>8. Контактная информация</b>

8.1. По всем вопросам, связанным с Политикой конфиденциальности, Пользователь может обратиться:
• Email: narevojournal@proton.me
• Telegram: @narevojournal`;
}

function getTermsOfService() {
  return `📋 <b>Пользовательское соглашение NAREVO MAIL</b>

📅 Актуальная версия: 07.08.2026

<b>1. Общие положения</b>

1.1. Настоящее Пользовательское соглашение регулирует порядок использования онлайн-сервиса NAREVO MAIL (Telegram-бот @narevojournal), предоставляемого Администрацией.

1.2. Используя Сервис, включая запуск бота, регистрацию, оплату услуг или получение доступа к материалам, Пользователь подтверждает, что полностью ознакомился с условиями настоящего Соглашения и принимает их в полном объёме.

1.3. В случае несогласия с условиями Соглашения Пользователь обязан прекратить использование Сервиса.

<b>2. Характер услуг и цифровых товаров</b>

2.1. Сервис предоставляет цифровые товары и услуги нематериального характера — официальные цифровые коды подписок.

2.2. Пользователь осознаёт и соглашается, что ценность цифровых товаров Сервиса заключается в систематизации, анализе, форме подачи, сопровождении и поддержке.

2.3. Сервис не заявляет и не гарантирует уникальность, исключительность или недоступность отдельных элементов материалов вне Сервиса.

<b>3. Отказ от гарантий и ответственности</b>

3.1. Сервис предоставляется на условиях «AS IS» («как есть»).

3.2. Администрация не гарантирует:
• соответствие Сервиса ожиданиям Пользователя;
• достижение каких-либо финансовых, коммерческих, профессиональных или иных результатов;
• бесперебойную и безошибочную работу Сервиса.

3.3. Администрация не несёт ответственности за:
• любые прямые или косвенные убытки, включая упущенную выгоду;
• последствия применения Пользователем полученных материалов;
• действия или бездействие третьих лиц;
• временные технические сбои и ограничения доступа.

<b>4. Законность использования</b>

4.1. Сервис не предназначен для поощрения, организации или содействия противоправной деятельности.

4.2. Пользователь обязуется использовать Сервис исключительно в рамках применимого законодательства.

<b>5. Интеллектуальная собственность</b>

5.1. Все материалы, размещённые в Сервисе, охраняются законодательством об интеллектуальной собственности.

5.2. Пользователю запрещается копировать, распространять, перепродавать, передавать третьим лицам или иным образом использовать материалы Сервиса без разрешения правообладателя.

<b>6. Ограничение доступа</b>

6.1. Администрация вправе приостановить или ограничить доступ Пользователя к Сервису в случае:
• нарушения условий настоящего Соглашения;
• выявления злоупотреблений;
• требований законодательства или платёжных провайдеров.

<b>7. Платежи и возвраты</b>

7.1. Оплата услуг и цифровых товаров производится на условиях, указанных в Сервисе до момента оплаты.

7.2. В связи с нематериальным характером цифровых товаров и услуг, возврат денежных средств после предоставления доступа не осуществляется, за исключением случаев, указанных ниже.

7.3. Возврат средств возможен только если:
• услуга не была оказана по технической вине Сервиса;
• доступ к цифровому товару фактически не был предоставлен.

7.4. Для рассмотрения вопроса о возврате Пользователь обязан обратиться в службу поддержки в течение 24 часов с момента оплаты.

7.5. Решение о возврате принимается Администрацией индивидуально.

<b>8. Конфиденциальность</b>

8.1. Администрация собирает минимально необходимые технические данные для обеспечения работы Сервиса согласно Политике конфиденциальности.

8.2. Администрация принимает разумные меры для защиты данных, однако не гарантирует абсолютную безопасность передаваемой информации.

<b>9. Изменение условий</b>

9.1. Администрация вправе вносить изменения в настоящее Соглашение.

9.2. Актуальная версия Соглашения публикуется в Сервисе.

9.3. Продолжение использования Сервиса означает согласие Пользователя с обновлёнными условиями.

<b>10. Контактная информация</b>

10.1. По всем вопросам Пользователь может обратиться:
• Email: narevojournal@proton.me
• Telegram: @narevojournal

Используя Сервис (в том числе запуская бота и/или вводя команду /start), Пользователь подтверждает, что ознакомлен с настоящим Соглашением и принимает его условия в полном объёме.`;
}

async function showWelcome(chatId,user,messageId){
  const text=`👋 <b>Добро пожаловать в NAREVO MAIL!</b>

Перед началом использования бота, пожалуйста, ознакомьтесь с документами:

• <b>Политика конфиденциальности</b> — как мы обрабатываем ваши данные
• <b>Пользовательское соглашение</b> — условия использования сервиса

Нажимайте на кнопки, чтобы прочитать документы.
После ознакомления нажмите <b>«Подтверждаю»</b> для доступа в магазин.`;

  await replaceUiWithText(chatId,messageId,text,welcomeMenu());
}

async function show(chatId,user,section,messageId){
  if(section==='home'){
    await replaceUiWithHome(chatId,user,messageId);
    return;
  }

  if(section==='privacy'){
    await replaceUiWithText(
      chatId,
      messageId,
      getPrivacyPolicy(),
      {inline_keyboard:[[button('← Назад',hasUserAgreed(user.id)?'home':'welcome')]]}
    );
    return;
  }

  if(section==='terms'){
    await replaceUiWithText(
      chatId,
      messageId,
      getTermsOfService(),
      {inline_keyboard:[[button('← Назад',hasUserAgreed(user.id)?'home':'welcome')]]}
    );
    return;
  }

  if(section==='welcome'){
    await showWelcome(chatId,user,messageId);
    return;
  }

  const data=userView(user);
  const admin=await hasAdminAccess(user.id);
  let text='';
  let keyboard=[];
  if(section==='catalog'){text='<b>🛍 Каталог</b>\n\nВыберите раздел, чтобы посмотреть товары:';keyboard=data.categories.map((c,i)=>[button(`📁 ${c.title}  ›`,`category:${i}`)]);keyboard.push([button('← Главное меню','home')]);}
  else if(section.startsWith('category:')){const category=data.categories[Number(section.slice(9))];if(!category)return;const items=data.products.filter(p=>p.categoryId===category.id);text=`<b>📁 ${html(category.title)}</b>\n\n${items.length?'Выберите товар:':'В этом разделе пока нет товаров.'}`;keyboard=items.map(p=>[button(`📦 ${p.title} · ${money(p.price)} · ${p.stock} шт.`,`product:${p.id}`)]);keyboard.push([button('← Все разделы','catalog')]);}
  else if(section.startsWith('product:')){const p=data.products.find(x=>x.id===section.slice(8));if(!p)return;const categoryIndex=data.categories.findIndex(c=>c.id===p.categoryId);text=`<b>📦 ${html(p.title)}</b>\n${html(p.term)}\n\n${html(p.description)}\n\nЦена: <b>${money(p.price)}</b>\nДоступно: <b>${p.stock}</b>`;keyboard=[[button(p.stock?'🛒 Купить':'Нет в наличии',p.stock?`buy:${p.id}`:'noop',p.stock?'primary':undefined)],[button('← К товарам',`category:${Math.max(0,categoryIndex)}`)]];}
  else if(section==='profile'){text=`<b>Личный кабинет</b>\n\n${data.user.name}\nTelegram ID: <code>${data.user.id}</code>\nБаланс: <b>${money(data.user.balance)}</b>\nПокупок: ${data.orders.length}`;keyboard=[[{text:'💳 Пополнить баланс',callback_data:'topup'}],[{text:'‹ В меню',callback_data:'home'}]];}
  else if(section==='orders'){text='<b>Мои покупки</b>\n\n'+(data.orders.length?data.orders.slice(-8).reverse().map(o=>`• ${o.title}\n<code>${o.code}</code>\n${money(o.price)}`).join('\n\n'):'Покупок пока нет.');keyboard=[[{text:'‹ В меню',callback_data:'home'}]];}
  else if(section==='topup'){const icons=paymentEmojis();text='<b>💳 Пополнение баланса</b>\n\nВыберите способ оплаты:';
    keyboard = [
      [{text:'💳 Банковские карты и СБП', callback_data:'fiat_payments'}],
      [{text:'🪙 Криптовалюта', callback_data:'crypto_payments'}],
      [button('← Главное меню','home')]
    ];
  }
  else if(section==='fiat_payments'){const icons=paymentEmojis();text='<b>💳 Банковские карты и СБП</b>\n\nКомиссия: <b>14%</b> (СБП НСПК)\n💰 Карты РФ и СберПэй — по запросу администратора.\nМинимальная сумма: 50 ₽';keyboard=[[paymentButton('СБП НСПК · 14%','₽','paymethod:sbp',undefined,icons.sbp)],[button('← Назад','topup')]];}
  else if(section==='crypto_payments'){const icons=paymentEmojis();text='<b>🪙 Криптовалюта</b>\n\nКомиссия: <b>0%</b>\nДоступные способы: USDT (CryptoBot) и другие криптовалюты через Heleket.\nМинимальная сумма: 50 ₽';keyboard=[[paymentButton('CryptoBot · USDT','💎','paymethod:cryptobot','primary',icons.cryptoBot)],[paymentButton('Crypto · Heleket','🔥','paymethod:heleket','danger',icons.heleket)],[button('← Назад','topup')]];}
  else if(section.startsWith('paymethod:')){const method=section.slice(10);const label=paymentLabel(method);text=`<b>${label}</b>\n\nВыберите сумму пополнения:`;keyboard=[[500,1000,2000].map(x=>button(money(x),`topup:${method}:${x}`,'primary')),[button('✏️ Ввести свою сумму',`topup_custom:${method}`)],[button('← Назад',section==='fiat_payments'?'fiat_payments':'crypto_payments')]];}
  else if(section.startsWith('topup_custom:')){const method=section.slice(13);pendingInput.set(user.id,{type:'topup_custom',method});text=`<b>✏️ Своя сумма · ${paymentLabel(method)}</b>\n\nВведите сумму от 50 до 100 000 ₽ одним сообщением.`;keyboard=[[button('Отмена','topup')]];}
  else if(section==='rules'){text='<b>📜 Правила NAREVO MAIL</b>\n\nЗдесь собраны основные условия работы магазина. Выберите нужный раздел:';keyboard=[[button('🔐 Конфиденциальность','rule:privacy')],[button('🛍 Покупка и выдача','rule:purchase')],[button('↩️ Возвраты','rule:refund')],[button('💬 Поддержка','rule:support')],[button('← Главное меню','home')]];}
  else if(section==='rule:privacy'){text='<b>🔐 Конфиденциальность</b>\n\nБот хранит только данные, необходимые для работы: Telegram ID, имя, историю покупок, пополнений и обращений в поддержку.\n\nПлатёжные данные и пароли от сторонних сервисов бот не запрашивает и не хранит. Коды товаров хранятся в зашифрованном виде. Данные не передаются посторонним, кроме случаев, необходимых для оплаты, работы сервиса или предусмотренных законом.';keyboard=[[button('← Ко всем правилам','rules')]];}
  else if(section==='rule:purchase'){text='<b>🛍 Правила покупки</b>\n\nПеред оплатой внимательно проверьте название товара, срок подписки, регион активации, цену и описание.\n\nПосле подтверждения покупки с баланса списывается указанная сумма, а цифровой код появляется в разделе «Покупки». Код предназначен только для выбранного товара. Передавать его другим людям после получения небезопасно.';keyboard=[[button('← Ко всем правилам','rules')]];}
  else if(section==='rule:refund'){text='<b>↩️ Правила возврата</b>\n\nЕсли код не работает, не соответствует описанию или не был выдан, создайте тикет в поддержке и укажите номер покупки.\n\nПосле проверки мы заменим неисправный код или вернём средства на баланс. Использованный или успешно активированный код вернуть нельзя. Возврат также не выполняется при ошибочном выборе товара или региона, если правильная информация была указана до покупки.';keyboard=[[button('💬 Обратиться в поддержку','support','primary')],[button('← Ко всем правилам','rules')]];}
  else if(section==='rule:support'){text='<b>💬 Правила поддержки</b>\n\nОдин пользователь может иметь один открытый тикет. Опишите проблему одним сообщением и приложите номер покупки.\n\nНе отправляйте пароли, данные банковской карты и коды подтверждения. Общайтесь спокойно и не создавайте повторные тикеты по одному вопросу. Ответ администратора появится внутри тикета.';keyboard=[[button('Создать или открыть тикет','support','primary')],[button('← Ко всем правилам','rules')]];}
  else if(section==='support'){const open=data.tickets.find(t=>t.status==='open');text='<b>💬 Поддержка NAREVO MAIL</b>\n\n'+(open?`У вас есть открытый тикет <code>#${open.id}</code>.`:'Создайте тикет — администратор ответит прямо здесь.')+'\n\n📧 Email: narevojournal@proton.me\n📱 Telegram: @narevojournal';keyboard=[[button(open?'Открыть тикет':'Создать тикет',open?`ticket:${open.id}`:'ticket_new','primary')],[button('Назад в меню','home')]];}
  else if(section.startsWith('ticket:')){const id=section.slice(7);const t=(admin?adminView().tickets:data.tickets).find(x=>x.id===id);if(!t)return;const messages=t.messages.slice(-5).map(m=>`${m.author==='admin'?'Администратор':m.author==='user'?'Клиент':'Система'}: ${html(m.text).slice(0,180)}`).join('\n\n');text=`<b>Тикет #${t.id}</b> · ${t.status==='open'?'Открыт':'Закрыт'}\n\n${messages}`;keyboard=t.status==='open'?[[button('Написать',`ticket_reply:${t.id}`,'primary')],...(admin?[[button('Закрыть тикет',`ticket_close:${t.id}`,'danger')]]:[]),[button('Назад',admin?'admin_tickets':'support')]]:[[button('Назад',admin?'admin_tickets':'support')]];}
  else if(section==='admin'&&admin){const a=adminView();text=`<b>NAREVO MAIL · Админ-панель</b>\n\nПользователей: ${a.users.length}\nЗаказов: ${a.orders.length}\nЗаявок: ${a.topups.filter(x=>x.status==='pending').length}\nТикетов: ${a.tickets.filter(x=>x.status==='open').length}\nСтатус бота: <b>${a.botEnabled?'🟢 работает':'🔴 остановлен'}</b>`;keyboard=[[{text:'🎫 Тикеты',callback_data:'admin_tickets'},{text:'💳 Пополнения',callback_data:'admin_topups'}],[{text:'📁 Категории',callback_data:'admin_categories'},{text:'📦 Товары и цены',callback_data:'admin_products'}],[{text:'📊 Остатки',callback_data:'admin_stock'}],[{text:'🧾 Лог пополнений · 3 дня',callback_data:'admin_topup_log:0'}],[{text:'📣 Рассылка',callback_data:'admin_broadcast'}],[{text:a.botEnabled?'⏸ Остановить бота':'▶️ Включить бота',callback_data:'admin_toggle_bot',style:a.botEnabled?'danger':'success'}],[{text:'‹ В меню',callback_data:'home'}]];}
  else if(section==='admin_broadcast'&&admin){text='<b>📣 Рассылка</b>\n\nОтправьте следующим сообщением текст, который нужно разослать всем пользователям бота. После этого появится предпросмотр и кнопка подтверждения.';keyboard=[[button('Отмена','admin')]];pendingInput.set(user.id,{type:'broadcast'});}
  else if(section==='admin_tickets'&&admin){const tickets=adminView().tickets;text='<b>Тикеты поддержки</b>\n\nВыберите обращение:';keyboard=tickets.map(t=>[{text:`${t.status==='open'?'🟢':'⚫'} #${t.id} · ${t.userName}`,callback_data:`ticket:${t.id}`}]);keyboard.push([{text:'‹ В админ-панель',callback_data:'admin'}]);}
  else if(section==='admin_categories'&&admin){const cats=adminView().categories;text='<b>Категории</b>\n\nНажмите категорию, чтобы включить/скрыть:';keyboard=cats.map(c=>[{text:`${c.active?'🟢':'⚫'} ${c.title}`,callback_data:`category_toggle:${c.id}`}]);keyboard.push([{text:'➕ Новая категория',callback_data:'category_add'}],[{text:'‹ В админ-панель',callback_data:'admin'}]);}
  else if(section==='admin_products'&&admin){const products=adminView().products.filter(p=>p.active);text='<b>Товары и цены</b>\n\nВыберите товар:';keyboard=products.map((p,i)=>[{text:`${p.title} · ${money(p.price)}`,callback_data:`admin_product:${i}`}]);keyboard.push([{text:'➕ Добавить товар',callback_data:'product_add'}],[{text:'‹ В админ-панель',callback_data:'admin'}]);}
  else if(section.startsWith('product_addcat:')&&admin){const category=adminView().categories.filter(c=>c.active)[Number(section.slice(15))];if(!category)return;pendingInput.set(user.id,{type:'product_add',step:'title',draft:{categoryId:category.id}});text=`<b>Новый товар · ${html(category.title)}</b>\n\nОтправьте следующим сообщением название товара.`;keyboard=[[{text:'Отмена',callback_data:'admin_products'}]];}
  else if(section.startsWith('product_delete_confirm:')&&admin){const index=Number(section.slice(23));const product=adminView().products.filter(p=>p.active)[index];if(!product)return;text=`<b>Удалить товар?</b>\n\n${html(product.title)} будет скрыт из каталога. История заказов сохранится.`;keyboard=[[button('Да, удалить',`product_delete:${index}`,'danger')],[button('Отмена',`admin_product:${index}`,'primary')]];}
  else if(section.startsWith('product_delete:')&&admin){const product=adminView().products.filter(p=>p.active)[Number(section.slice(15))];if(product)archiveProduct(user.id,product.id);return show(chatId,user,'admin_products',messageId);}
  else if(section.startsWith('admin_product:')&&admin){const index=Number(section.slice(14));const a=adminView();const products=a.products.filter(x=>x.active);const p=products[index];if(!p)return;const category=a.categories.find(c=>c.id===p.categoryId);text=`<b>${html(p.title)}</b>\nКатегория: ${html(category?.title||'Без категории')}\nЦена: ${money(p.price)}\nОстаток: ${p.stock}`;keyboard=[[button('Изменить цену',`price_edit:${index}`,'primary')],[button('Сменить категорию',`product_categories:${index}`,'primary')],[button('Загрузить коды',`codes_add:${index}`,'success')],[button('Удалить товар',`product_delete_confirm:${index}`,'danger')],[button('Назад к товарам','admin_products')]];}
  else if(section.startsWith('product_categories:')&&admin){const index=Number(section.slice(19));const a=adminView();const p=a.products.filter(x=>x.active)[index];if(!p)return;text=`<b>${p.title}</b>\n\nВыберите категорию:`;keyboard=a.categories.filter(c=>c.active).map((c,i)=>[{text:`${c.id===p.categoryId?'✓ ':''}${c.title}`,callback_data:`product_setcat:${index}:${i}`}]);keyboard.push([{text:'‹ К товару',callback_data:`admin_product:${index}`}]);}
  else if(section==='product_add'&&admin){const cats=adminView().categories.filter(c=>c.active);text='<b>Новый товар</b>\n\nСначала выберите категорию:';keyboard=cats.map((c,i)=>[{text:c.title,callback_data:`product_addcat:${i}`}]);keyboard.push([{text:'‹ К товарам',callback_data:'admin_products'}]);}
  else if(section.startsWith('admin_topup_log:')&&admin){
    const page=Math.max(0,Number(section.split(':')[1])||0);
    const perPage=12;
    const rows=getRecentTopups(3);
    const pages=Math.max(1,Math.ceil(rows.length/perPage));
    const safePage=Math.min(page,pages-1);
    const slice=rows.slice(safePage*perPage,(safePage+1)*perPage);
    const lines=slice.map((t,i)=>{
      const tag=t.username?`@${html(String(t.username).replace(/^@/,''))}`:'нет username';
      const paymentAmount=Number(t.paymentAmount??t.amount);
      const paidPart=paymentAmount!==Number(t.amount)?` · к оплате ${money(paymentAmount)}`:'';
      return `<b>${safePage*perPage+i+1}. ${topupMethodLogLabel(t.method)}</b> · ${topupStatusLabel(t.status)}
`+
        `${formatLogTime(t.createdAt)} МСК · ${tag} · ID <code>${t.userId}</code>
`+
        `На баланс: <b>${money(t.amount)}</b>${paidPart}`;
    });
    text=`<b>🧾 Лог пополнений за 3 дня</b>

${lines.length?lines.join('\n\n'):'За последние 3 дня пополнений и заявок нет.'}

Страница ${safePage+1}/${pages} · записей: ${rows.length}`;
    keyboard=[];
    const nav=[];
    if(safePage>0)nav.push(button('← Новее',`admin_topup_log:${safePage-1}`));
    if(safePage<pages-1)nav.push(button('Старее →',`admin_topup_log:${safePage+1}`));
    if(nav.length)keyboard.push(nav);
    keyboard.push([button('↻ Обновить',`admin_topup_log:${safePage}`)],[button('‹ В админ-панель','admin_from_text')]);
  }
  else if(section==='admin_topups'&&admin){const pending=adminView().topups.filter(x=>x.status==='pending'&&!x.cryptoPayInvoiceId&&!x.heleketInvoiceId);text='<b>Заявки на пополнение</b>\n\n'+(pending.length?pending.map(t=>`${paymentLabel(t.method)} · ID ${t.userId}\n${topupSummary(t)}`).join('\n\n'):'Новых заявок для ручного подтверждения нет.');keyboard=pending.map(t=>[{text:`${paymentLabel(t.method)} · оплатить ${money(t.paymentAmount??t.amount)}`,callback_data:`approve:${t.id}`}]);keyboard.push([{text:'‹ В админ-панель',callback_data:'admin'}]);}
  else if(section==='admin_stock'&&admin){const a=adminView();text='<b>Остатки товаров</b>\n\n'+a.products.map(p=>`${p.title}: <b>${p.stock}</b>`).join('\n')+'\n\nДля безопасной загрузки кодов используйте Mini App или API админ-панели.';keyboard=[[{text:'‹ В админ-панель',callback_data:'admin'}]];}
  else{text='<b>NAREVO MAIL</b>\nОфициальные цифровые коды подписок.\n\nВыберите раздел:';keyboard=menu(user,admin).inline_keyboard;}
  
  const reply_markup={inline_keyboard:keyboard};

  // Длинный лог пополнений нельзя помещать в caption фотографии (лимит Telegram — 1024 символа).
  // Поэтому экран лога всегда рендерим как обычное текстовое сообщение.
  if(section.startsWith('admin_topup_log:')){
    await replaceUiWithText(chatId,messageId,text,reply_markup);
    return;
  }

  if(messageId){
    const response=await tgApi('editMessageMedia',{
      chat_id:chatId,
      message_id:messageId,
      media:{type:'photo',media:imageForSection(section),caption:text,parse_mode:'HTML'},
      reply_markup
    });
    await requireTelegramOk(response,'Не удалось обновить раздел');
  } else {
    const response=await tgApi('sendPhoto',{
      chat_id:chatId,
      photo:imageForSection(section),
      caption:text,
      parse_mode:'HTML',
      reply_markup
    });
    await requireTelegramOk(response,'Не удалось открыть раздел');
    const sent=await response.clone().json();
    setUiMessage(chatId,sent.result.message_id);
  }
}

async function botLoop(offset=0){if(!config.token)return;try{const r=await fetch(`https://api.telegram.org/bot${config.token}/getUpdates?timeout=25&offset=${offset}`);const d=await r.json();for(const update of d.result||[]){offset=update.update_id+1;const m=update.message;const q=update.callback_query;
    if(m?.text?.startsWith('/'))await tgApi('deleteMessage',{chat_id:m.chat.id,message_id:m.message_id});
    if(m?.text&&!m.text.startsWith('/')&&pendingInput.has(m.from.id)){await tgApi('deleteMessage',{chat_id:m.chat.id,message_id:m.message_id});const promptId=transientMessages.get(m.chat.id);if(promptId){await tgApi('deleteMessage',{chat_id:m.chat.id,message_id:promptId});transientMessages.delete(m.chat.id)}}
    if(q){const activeId=getUiMessage(q.message.chat.id);if(!activeId)setUiMessage(q.message.chat.id,q.message.message_id);else if(activeId!==q.message.message_id){await tgApi('answerCallbackQuery',{callback_query_id:q.id,text:'Это меню устарело',show_alert:false});await tgApi('deleteMessage',{chat_id:q.message.chat.id,message_id:q.message.message_id});continue}}
    const actor=m?.from||q?.from;
    if(actor&&!isBotEnabled()&&!await hasAdminAccess(actor.id)){
      if(q)await tgApi('answerCallbackQuery',{callback_query_id:q.id,text:'Бот временно остановлен',show_alert:true});
      await showMaintenance(m?.chat?.id||q?.message?.chat?.id);
      continue;
    }
    if(m?.text&&!m.text.startsWith('/')&&pendingInput.get(m.from.id)?.type==='topup_custom'&&pendingInput.get(m.from.id)?.method==='heleket'){
      try{const amount=Number(m.text.replace(/\s/g,''));const t=await startHeleketTopup(m.from,amount);pendingInput.delete(m.from.id);await tgApi('sendMessage',{chat_id:m.chat.id,text:`<b>Счёт Heleket создан</b>\n\nСумма: ${money(t.amount)}\nКриптовалюту и сеть выберите на странице оплаты.\nПосле оплаты вернитесь сюда и нажмите «Проверить оплату».`,parse_mode:'HTML',reply_markup:heleketKeyboard(t.heleketInvoiceId,t.paymentUrl)});}catch(e){await tgApi('sendMessage',{chat_id:m.chat.id,text:`Введите сумму ещё раз. ${html(e.message)}`});}continue;
    }
    if(m?.text&&!m.text.startsWith('/')&&pendingInput.get(m.from.id)?.type==='topup_custom'&&pendingInput.get(m.from.id)?.method==='sbp'){
      try{const amount=Number(m.text.replace(/\s/g,''));const t=requestTopup(m.from,amount,'sbp');pendingInput.delete(m.from.id);await tgApi('sendMessage',{chat_id:m.chat.id,text:`<b>Заявка ${paymentLabel(t.method)} создана</b>\n\n${topupSummary(t)}\n\nАдминистратор пришлёт реквизиты и подтвердит оплату.`,parse_mode:'HTML'});for(const a of config.admins)await notify(a,`💳 ${paymentLabel(t.method)} · к оплате ${money(t.paymentAmount)} · на баланс ${money(t.amount)} · пользователь ${m.from.id}`);if(config.adminChatId)await notify(config.adminChatId,`💳 ${paymentLabel(t.method)} · к оплате ${money(t.paymentAmount)} · на баланс ${money(t.amount)} · пользователь ${m.from.id}`);}catch(e){await tgApi('sendMessage',{chat_id:m.chat.id,text:`Введите сумму ещё раз. ${html(e.message)}`});}continue;
    }
    if(m?.text==='/start'||m?.text==='/menu'){
      const oldId=getUiMessage(m.chat.id);
      if(oldId)await tgApi('deleteMessage',{chat_id:m.chat.id,message_id:oldId});
      
      if(!hasUserAgreed(m.from.id)) {
        await installQuickMenu(m.chat.id);
        await showWelcome(m.chat.id, m.from, null);
        continue;
      }
      
      await installQuickMenu(m.chat.id);
      const admin=await hasAdminAccess(m.from.id);
      const response=await tgApi('sendPhoto',{
        chat_id:m.chat.id,
        photo:config.productImageUrl,
        caption:'<b>NAREVO MAIL</b>\nЦифровые коды подписок.\n\nВыберите раздел:',
        parse_mode:'HTML',
        reply_markup:menu(m.from, admin)
      });
      if(response.ok){const sent=await response.clone().json();setUiMessage(m.chat.id,sent.result.message_id)}
    }
    else if(m?.text==='/id')await tgApi('sendMessage',{chat_id:m.chat.id,text:`Ваш Telegram ID: <code>${m.from.id}</code>`,parse_mode:'HTML'});
    else if(m?.text==='/chatid'&&['group','supergroup'].includes(m.chat.type))await tgApi('sendMessage',{chat_id:m.chat.id,text:`ID служебного чата: <code>${m.chat.id}</code>`,parse_mode:'HTML'});
    else if(m?.text==='/emoji'&&await hasAdminAccess(m.from.id)){pendingInput.set(m.from.id,{type:'button_emojis'});await tgApi('sendMessage',{chat_id:m.chat.id,text:'Отправьте <b>одним сообщением три премиум-эмодзи</b> в таком порядке:\n\n1. CryptoBot\n2. Heleket\n3. СБП\n\nМожно просто поставить их подряд через пробел.',parse_mode:'HTML'});}
    else if(m?.text&&quickSections.has(m.text)){
      if(!hasUserAgreed(m.from.id)) {
        await showWelcome(m.chat.id, m.from, getUiMessage(m.chat.id));
        continue;
      }
      await tgApi('deleteMessage',{chat_id:m.chat.id,message_id:m.message_id});
      pendingInput.delete(m.from.id);
      const section=quickSections.get(m.text);
      await show(m.chat.id,m.from,section,getUiMessage(m.chat.id));
    }
    else if(m?.text&&!m.text.startsWith('/')&&pendingInput.has(m.from.id)){
      const task=pendingInput.get(m.from.id);const admin=await hasAdminAccess(m.from.id);
      try{let done=true;let success='✅ Сохранено. Отправьте /menu, чтобы продолжить.';
        if(admin&&task.type==='broadcast'){const text=String(m.text||'').trim();if(!text)throw Error('Текст рассылки пуст');if(text.length>4096)throw Error('Текст рассылки длиннее 4096 символов');broadcastDrafts.set(m.from.id,text);pendingInput.delete(m.from.id);done=false;await replaceUiWithText(m.chat.id,getUiMessage(m.chat.id),`<b>Предпросмотр рассылки</b>\n\n${html(text)}`,{inline_keyboard:[[button('📣 Отправить всем','admin_broadcast_send','success')],[button('Отмена','admin','danger')]]})}
        else if(admin&&task.type==='button_emojis'){const ids=(m.entities||[]).filter(x=>x.type==='custom_emoji'&&x.custom_emoji_id).map(x=>x.custom_emoji_id);setButtonEmojis(m.from.id,ids);success='✅ Премиум-эмодзи сохранены. Откройте раздел «Пополнить», чтобы проверить кнопки.'}
        else if(task.type==='ticket'){const t=addTicketMessage(m.from.id,task.id,m.text,admin);if(admin)await notify(t.userId,`🟠 Новый ответ поддержки в тикете <b>#${t.id}</b>. Откройте раздел «Поддержка».`);else if(config.adminChatId)await notify(config.adminChatId,`🎫 Новое сообщение в тикете <b>#${t.id}</b> от ${html(t.userName)}.`)}
        else if(task.type==='topup_custom'){const amount=Number(m.text.replace(/\s/g,''));if(task.method==='cryptobot'){const t=await startCryptoBotTopup(m.from,amount);pendingInput.delete(m.from.id);done=false;await tgApi('sendMessage',{chat_id:m.chat.id,text:`<b>Счёт CryptoBot создан</b>\n\nСумма: ${money(t.amount)}\nОплата: USDT\nПосле оплаты вернитесь сюда и нажмите «Проверить оплату».`,parse_mode:'HTML',reply_markup:{inline_keyboard:[[linkButton('Оплатить в CryptoBot',t.paymentUrl,'primary')],[button('✅ Проверить оплату',`cryptocheck:${t.cryptoPayInvoiceId}`,'success')],[button('← Главное меню','home')]]}})}else{const t=requestTopup(m.from,amount,task.method);success=`✅ Заявка на ${money(t.amount)} создана. Администратор подтвердит пополнение.`;for(const a of config.admins)await notify(a,`💳 Заявка ${task.method} на ${money(t.amount)} · пользователь ${m.from.id}`);if(config.adminChatId)await notify(config.adminChatId,`💳 Заявка ${task.method} на ${money(t.amount)} · пользователь ${m.from.id}`)}}
        else if(admin&&task.type==='category')addCategory(m.from.id,m.text);
        else if(admin&&task.type==='price')updateProductPrice(m.from.id,task.id,m.text);
        else if(admin&&task.type==='codes')addCodes(m.from.id,task.id,m.text.split(/\r?\n/));
        else if(admin&&task.type==='product_add'){task.draft[task.step]=m.text.trim();const next={title:['term','Введите срок, например «1 месяц»:'],term:['description','Введите краткое описание товара:'],description:['price','Введите цену числом в рублях:']}[task.step];if(next){task.step=next[0];pendingInput.set(m.from.id,task);done=false;await tgApi('sendMessage',{chat_id:m.chat.id,text:next[1]})}else addProduct(m.from.id,task.draft)}
        if(done){pendingInput.delete(m.from.id);await tgApi('sendMessage',{chat_id:m.chat.id,text:success})}
      }catch(e){if(task.type==='topup_custom'){pendingInput.set(m.from.id,task);await tgApi('sendMessage',{chat_id:m.chat.id,text:`Введите сумму ещё раз. ${e.message}`})}else{pendingInput.delete(m.from.id);await tgApi('sendMessage',{chat_id:m.chat.id,text:`Ошибка: ${e.message}`})}}}
    
    if(q){await tgApi('answerCallbackQuery',{callback_query_id:q.id});const action=q.data;try{
      if(action === 'agree'){
        setUserAgreed(q.from.id);
        await installQuickMenu(q.message.chat.id);
        const admin=await hasAdminAccess(q.from.id);
        await tgApi('editMessageText',{
          chat_id:q.message.chat.id,
          message_id:q.message.message_id,
          text:'✅ <b>Спасибо!</b>\n\nВы подтвердили ознакомление с документами. Добро пожаловать в NAREVO MAIL! 🎉',
          parse_mode:'HTML',
          reply_markup:{inline_keyboard:[[button('🛍 Перейти в магазин','home','primary')]]}
        });
        continue;
      }
      
      if(action === 'privacy' || action === 'terms'){
        await show(q.message.chat.id, q.from, action, q.message.message_id);
        continue;
      }
      
      if(action === 'welcome'){
        await showWelcome(q.message.chat.id, q.from, q.message.message_id);
        continue;
      }
      
      if(!hasUserAgreed(q.from.id) && action !== 'home'){
        await showWelcome(q.message.chat.id, q.from, q.message.message_id);
        continue;
      }
      
      if(action.startsWith('buy:')){const out=buy(q.from,action.slice(4));await tgApi('sendMessage',{chat_id:q.message.chat.id,text:`✅ <b>Покупка выполнена</b>\n${out.title}\n\nВаш код:\n<code>${out.code}</code>`,parse_mode:'HTML'});await show(q.message.chat.id,q.from,'profile',q.message.message_id)}
      else if(action.startsWith('cryptocheck:')){const invoiceId=action.slice(12);const {invoice,settled}=await verifyAndSettleCryptoInvoice(invoiceId);if(settled)await show(q.message.chat.id,q.from,'profile',q.message.message_id);else if(invoice.status==='expired')await tgApi('editMessageText',{chat_id:q.message.chat.id,message_id:q.message.message_id,text:'<b>⌛ Счёт CryptoBot истёк</b>\n\nСоздайте новый счёт в разделе пополнения.',parse_mode:'HTML',reply_markup:{inline_keyboard:[[button('Создать новый счёт','paymethod:cryptobot','primary')],[button('← Главное меню','home')]]}});else{const paymentUrl=invoice.bot_invoice_url||invoice.mini_app_invoice_url||invoice.web_app_invoice_url;await tgApi('editMessageText',{chat_id:q.message.chat.id,message_id:q.message.message_id,text:`<b>⏳ Оплата пока не найдена</b>\n\nСумма: ${money(invoice.amount)}\nОплата: USDT\nОплатите счёт и повторите проверку.`,parse_mode:'HTML',reply_markup:{inline_keyboard:[[linkButton('Оплатить в CryptoBot',paymentUrl,'primary')],[button('✅ Проверить ещё раз',`cryptocheck:${invoice.invoice_id}`,'success')],[button('← Главное меню','home')]]}})}}
      else if(action.startsWith('heleketcheck:')){const invoiceId=action.slice(13);const {invoice,status,settled}=await verifyAndSettleHeleketInvoice(invoiceId);if(settled)await show(q.message.chat.id,q.from,'profile',q.message.message_id);else if(['cancel','fail','system_fail'].includes(status))await tgApi('editMessageText',{chat_id:q.message.chat.id,message_id:q.message.message_id,text:'<b>⌛ Счёт Heleket недоступен</b>\n\nСоздайте новый счёт в разделе пополнения.',parse_mode:'HTML',reply_markup:{inline_keyboard:[[button('Создать новый счёт','paymethod:heleket','primary')],[button('← Главное меню','home')]]}});else{await tgApi('editMessageText',{chat_id:q.message.chat.id,message_id:q.message.message_id,text:`<b>⏳ Оплата Heleket пока не подтверждена</b>\n\nСумма: ${money(invoice.amount)}\nСтатус: ${html(status||'pending')}\n\nОплатите счёт и повторите проверку.`,parse_mode:'HTML',reply_markup:heleketKeyboard(invoice.uuid||invoiceId,invoice.url,true)})}}
      else if(action.startsWith('topup:')){const [,method,amount]=action.split(':');if(method==='cryptobot'){const t=await startCryptoBotTopup(q.from,Number(amount));await tgApi('editMessageText',{chat_id:q.message.chat.id,message_id:q.message.message_id,text:`<b>Счёт CryptoBot создан</b>\n\nСумма: ${money(t.amount)}\nОплата: USDT\nПосле оплаты вернитесь сюда и нажмите «Проверить оплату».`,parse_mode:'HTML',reply_markup:{inline_keyboard:[[linkButton('Оплатить в CryptoBot',t.paymentUrl,'primary')],[button('✅ Проверить оплату',`cryptocheck:${t.cryptoPayInvoiceId}`,'success')],[button('← Главное меню','home')]]}})}else if(method==='heleket'){const t=await startHeleketTopup(q.from,Number(amount));await tgApi('editMessageText',{chat_id:q.message.chat.id,message_id:q.message.message_id,text:`<b>Счёт Heleket создан</b>\n\nСумма: ${money(t.amount)}\nКриптовалюту и сеть выберите на странице оплаты.\nПосле оплаты вернитесь сюда и нажмите «Проверить оплату».`,parse_mode:'HTML',reply_markup:heleketKeyboard(t.heleketInvoiceId,t.paymentUrl)})}else{const t=requestTopup(q.from,Number(amount),method);await tgApi('editMessageText',{chat_id:q.message.chat.id,message_id:q.message.message_id,text:`✅ Заявка на ${money(t.amount)} через ${paymentLabel(method)} создана.\nАдминистратор пришлёт реквизиты и подтвердит оплату.`,reply_markup:{inline_keyboard:[[{text:'🛟 Написать в поддержку',callback_data:'support'}],[{text:'‹ В меню',callback_data:'home'}]]}});for(const a of config.admins)await notify(a,`💳 Заявка ${method} на ${money(t.amount)} · пользователь ${q.from.id}`);if(config.adminChatId)await notify(config.adminChatId,`💳 Заявка ${method} на ${money(t.amount)} · пользователь ${q.from.id}`)}}
      else if(action==='ticket_new'){const t=createTicket(q.from);if(config.adminChatId)await notify(config.adminChatId,`🎫 Создан тикет <b>#${t.id}</b> от ${html(t.userName)}.`);await show(q.message.chat.id,q.from,`ticket:${t.id}`,q.message.message_id)}
      else if(action.startsWith('ticket_reply:')){pendingInput.set(q.from.id,{type:'ticket',id:action.slice(13)});await tgApi('sendMessage',{chat_id:q.message.chat.id,text:'✍️ Отправьте следующее сообщение — оно попадёт в тикет.'})}
      else if(action.startsWith('ticket_close:')&&await hasAdminAccess(q.from.id)){closeTicket(q.from.id,action.slice(13));await show(q.message.chat.id,q.from,'admin_tickets',q.message.message_id)}
      else if(action==='category_add'&&await hasAdminAccess(q.from.id)){pendingInput.set(q.from.id,{type:'category'});await tgApi('sendMessage',{chat_id:q.message.chat.id,text:'Введите название новой категории:'})}
      else if(action.startsWith('category_toggle:')&&await hasAdminAccess(q.from.id)){toggleCategory(q.from.id,action.slice(16));await show(q.message.chat.id,q.from,'admin_categories',q.message.message_id)}
      else if(action.startsWith('product_setcat:')&&await hasAdminAccess(q.from.id)){const [,pi,ci]=action.split(':');const a=adminView();setProductCategory(q.from.id,a.products[Number(pi)]?.id,a.categories[Number(ci)]?.id);await show(q.message.chat.id,q.from,`admin_product:${pi}`,q.message.message_id)}
      else if(action.startsWith('price_edit:')&&await hasAdminAccess(q.from.id)){const p=adminView().products[Number(action.slice(11))];pendingInput.set(q.from.id,{type:'price',id:p?.id});await tgApi('sendMessage',{chat_id:q.message.chat.id,text:'Введите новую цену числом в рублях:'})}
      else if(action.startsWith('codes_add:')&&await hasAdminAccess(q.from.id)){const p=adminView().products[Number(action.slice(10))];pendingInput.set(q.from.id,{type:'codes',id:p?.id});await tgApi('sendMessage',{chat_id:q.message.chat.id,text:'Отправьте коды активации: один код на строку. Логины и пароли не принимаются.'})}
      else if(action==='admin_from_text'&&await hasAdminAccess(q.from.id)){
        await tgApi('deleteMessage',{chat_id:q.message.chat.id,message_id:q.message.message_id});
        setUiMessage(q.message.chat.id,null);
        await show(q.message.chat.id,q.from,'admin',null);
      }
      else if(action==='admin_toggle_bot'&&await hasAdminAccess(q.from.id)){setBotEnabled(q.from.id,!isBotEnabled());await show(q.message.chat.id,q.from,'admin',q.message.message_id)}
      else if(action==='admin_broadcast_send'&&await hasAdminAccess(q.from.id)){const text=broadcastDrafts.get(q.from.id);if(!text)throw Error('Черновик рассылки не найден. Создайте рассылку заново.');broadcastDrafts.delete(q.from.id);await tgApi('editMessageText',{chat_id:q.message.chat.id,message_id:q.message.message_id,text:'📣 Рассылка запущена…'});const result=await sendBroadcast(text);await tgApi('editMessageText',{chat_id:q.message.chat.id,message_id:q.message.message_id,text:`✅ <b>Рассылка завершена</b>\n\nВсего пользователей: ${result.total}\nДоставлено: ${result.sent}\nНе доставлено: ${result.failed}`,parse_mode:'HTML',reply_markup:{inline_keyboard:[[button('← В админ-панель','admin')]]}})}
      else if(action.startsWith('approve:')&&await hasAdminAccess(q.from.id)){const t=approveTopup(q.from.id,action.slice(8));await notify(t.userId,`✅ Баланс пополнен на <b>${money(t.amount)}</b>.`);await show(q.message.chat.id,q.from,'admin_topups',q.message.message_id)}
      else if(action!=='noop' && action !== 'home') await show(q.message.chat.id,q.from,action,q.message.message_id)
      else if(action === 'home') await show(q.message.chat.id,q.from,'home',q.message.message_id)
    }catch(e){await tgApi('sendMessage',{chat_id:q.message.chat.id,text:`Ошибка: ${html(e.message)}`})}}
  }}catch(e){console.error('Telegram polling error:',e.message)}setTimeout(()=>botLoop(offset),1000)}
server.listen(config.port,()=>{
  console.log(`NAREVO MAIL: http://localhost:${config.port}`);
  reconcilePendingCryptoTopups();
  reconcilePendingHeleketTopups();
});
const cryptoReconcileTimer=setInterval(reconcilePendingCryptoTopups,30_000);
cryptoReconcileTimer.unref?.();
const heleketReconcileTimer=setInterval(reconcilePendingHeleketTopups,30_000);
heleketReconcileTimer.unref?.();
botLoop();