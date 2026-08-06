import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { verifyTelegram } from './security.js';
import { userView,adminView,buy,requestTopup,addCodes,approveTopup,addProduct } from './store.js';

const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'};
const json=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data));};
const body=req=>new Promise((resolve,reject)=>{let s='';req.on('data',c=>{s+=c;if(s.length>1e6)req.destroy()});req.on('end',()=>{try{resolve(s?JSON.parse(s):{})}catch(e){reject(e)}})});
const auth=req=>verifyTelegram(req.headers['x-telegram-init-data']||'');
const notify=async(chatId,text)=>{if(config.token) await fetch(`https://api.telegram.org/bot${config.token}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:chatId,text,parse_mode:'HTML'})});};

const server=http.createServer(async(req,res)=>{try{
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
  const pathname=new URL(req.url,'http://localhost').pathname; let target=pathname==='/'?'public/index.html':`public${pathname}`; target=path.normalize(target); if(!target.startsWith('public')){res.writeHead(403);return res.end()};
  if(!fs.existsSync(target)||fs.statSync(target).isDirectory()){res.writeHead(404);return res.end('Not found')}; res.writeHead(200,{'content-type':types[path.extname(target)]||'application/octet-stream'});fs.createReadStream(target).pipe(res);
}catch(e){json(res,e.message.includes('Telegram')?401:400,{error:e.message})}});

const tgApi=(method,payload)=>fetch(`https://api.telegram.org/bot${config.token}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
const money=n=>`${Number(n).toLocaleString('ru-RU')} ₽`;
const menu=(user,admin)=>({inline_keyboard:[[{text:'🛍 Каталог',callback_data:'catalog'},{text:'👤 Кабинет',callback_data:'profile'}],[{text:'📦 Мои покупки',callback_data:'orders'},{text:'💳 Пополнить',callback_data:'topup'}],...(admin?[[{text:'⚙️ Админ-панель',callback_data:'admin'}]]:[])]});
async function hasAdminAccess(userId){if(config.admins.has(userId))return true;if(!config.adminChatId)return false;try{const r=await tgApi('getChatMember',{chat_id:config.adminChatId,user_id:userId});const d=await r.json();return d.ok&&['creator','administrator'].includes(d.result.status)}catch{return false}}
async function show(chatId,user,section,messageId){const data=userView(user);const admin=await hasAdminAccess(user.id);let text='';let keyboard=[];
  if(section==='catalog'){text='<b>NAREVO · Каталог подписок</b>\n\nВыберите официальный цифровой код:';keyboard=data.products.map(p=>[{text:`${p.title} · ${money(p.price)} (${p.stock})`,callback_data:`product:${p.id}`}]);keyboard.push([{text:'‹ В меню',callback_data:'home'}]);}
  else if(section.startsWith('product:')){const p=data.products.find(x=>x.id===section.slice(8));if(!p)return; text=`<b>${p.title}</b>\n${p.term}\n\n${p.description}\n\nЦена: <b>${money(p.price)}</b>\nДоступно: <b>${p.stock}</b>`;keyboard=[[{text:p.stock?'Купить':'Нет в наличии',callback_data:p.stock?`buy:${p.id}`:'noop'}],[{text:'‹ К каталогу',callback_data:'catalog'}]];}
  else if(section==='profile'){text=`<b>Личный кабинет</b>\n\n${data.user.name}\nTelegram ID: <code>${data.user.id}</code>\nБаланс: <b>${money(data.user.balance)}</b>\nПокупок: ${data.orders.length}`;keyboard=[[{text:'💳 Пополнить баланс',callback_data:'topup'}],[{text:'‹ В меню',callback_data:'home'}]];}
  else if(section==='orders'){text='<b>Мои покупки</b>\n\n'+(data.orders.length?data.orders.slice(-8).reverse().map(o=>`• ${o.title}\n<code>${o.code}</code>\n${money(o.price)}`).join('\n\n'):'Покупок пока нет.');keyboard=[[{text:'‹ В меню',callback_data:'home'}]];}
  else if(section==='topup'){text='<b>Пополнение баланса</b>\n\nВыберите сумму. Администратор подтвердит заявку после проверки оплаты.';keyboard=[[500,1000,2000].map(x=>({text:money(x),callback_data:`topup:${x}`})),[{text:'‹ В меню',callback_data:'home'}]];}
  else if(section==='admin'&&admin){const a=adminView();text=`<b>NAREVO · Админ-панель</b>\n\nПользователей: ${a.users.length}\nЗаказов: ${a.orders.length}\nЗаявок: ${a.topups.filter(x=>x.status==='pending').length}`;keyboard=[[{text:'Заявки на пополнение',callback_data:'admin_topups'}],[{text:'Остатки товаров',callback_data:'admin_stock'}],[{text:'‹ В меню',callback_data:'home'}]];}
  else if(section==='admin_topups'&&admin){const pending=adminView().topups.filter(x=>x.status==='pending');text='<b>Заявки на пополнение</b>\n\n'+(pending.length?pending.map(t=>`ID ${t.userId} · ${money(t.amount)}`).join('\n'):'Новых заявок нет.');keyboard=pending.map(t=>[{text:`Подтвердить ${money(t.amount)} · ${t.userId}`,callback_data:`approve:${t.id}`}]);keyboard.push([{text:'‹ В админ-панель',callback_data:'admin'}]);}
  else if(section==='admin_stock'&&admin){const a=adminView();text='<b>Остатки товаров</b>\n\n'+a.products.map(p=>`${p.title}: <b>${p.stock}</b>`).join('\n')+'\n\nДля безопасной загрузки кодов используйте Mini App или API админ-панели.';keyboard=[[{text:'‹ В админ-панель',callback_data:'admin'}]];}
  else{text='<b>NAREVO</b>\nОфициальные цифровые коды подписок.\n\nВыберите раздел:';keyboard=menu(user,admin).inline_keyboard;}
  const payload={chat_id:chatId,text,parse_mode:'HTML',reply_markup:{inline_keyboard:keyboard}};if(messageId){payload.message_id=messageId;await tgApi('editMessageText',payload)}else await tgApi('sendMessage',payload);
}
async function botLoop(offset=0){if(!config.token)return;try{const r=await fetch(`https://api.telegram.org/bot${config.token}/getUpdates?timeout=25&offset=${offset}`);const d=await r.json();for(const update of d.result||[]){offset=update.update_id+1;const m=update.message;const q=update.callback_query;
    if(m?.text==='/start'||m?.text==='/menu')await show(m.chat.id,m.from,'home');
    else if(m?.text==='/id')await tgApi('sendMessage',{chat_id:m.chat.id,text:`Ваш Telegram ID: <code>${m.from.id}</code>`,parse_mode:'HTML'});
    else if(m?.text==='/chatid'&&['group','supergroup'].includes(m.chat.type))await tgApi('sendMessage',{chat_id:m.chat.id,text:`ID служебного чата: <code>${m.chat.id}</code>`,parse_mode:'HTML'});
    if(q){await tgApi('answerCallbackQuery',{callback_query_id:q.id});const action=q.data;try{if(action.startsWith('buy:')){const out=buy(q.from,action.slice(4));await tgApi('sendMessage',{chat_id:q.message.chat.id,text:`✅ <b>Покупка выполнена</b>\n${out.title}\n\nВаш код:\n<code>${out.code}</code>`,parse_mode:'HTML'});await show(q.message.chat.id,q.from,'profile',q.message.message_id)}else if(action.startsWith('topup:')){const t=requestTopup(q.from,Number(action.slice(6)));await tgApi('editMessageText',{chat_id:q.message.chat.id,message_id:q.message.message_id,text:`✅ Заявка на ${money(t.amount)} создана.\nАдминистратор проверит оплату и пополнит баланс.`,reply_markup:{inline_keyboard:[[{text:'‹ В меню',callback_data:'home'}]]}});for(const a of config.admins)await notify(a,`💳 Заявка на ${money(t.amount)} · пользователь ${q.from.id}`)}else if(action.startsWith('approve:')&&await hasAdminAccess(q.from.id)){const t=approveTopup(q.from.id,action.slice(8));await notify(t.userId,`✅ Баланс пополнен на <b>${money(t.amount)}</b>.`);await show(q.message.chat.id,q.from,'admin_topups',q.message.message_id)}else if(action!=='noop')await show(q.message.chat.id,q.from,action,q.message.message_id)}catch(e){await tgApi('answerCallbackQuery',{callback_query_id:q.id,text:e.message,show_alert:true})}}
  }}catch(e){console.error('Telegram polling error:',e.message)}setTimeout(()=>botLoop(offset),1000)}
server.listen(config.port,()=>console.log(`NAREVO: http://localhost:${config.port}`));botLoop();
