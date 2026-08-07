import fs from 'node:fs';
import crypto from 'node:crypto';
import { encrypt, decrypt } from './security.js';

const file = 'data/store.json';
const seed = { 
  categories:[
    {id:'mail', title:'Почтовые подписки', active:true}
  ], 
  products: [
    { id:'gmail-one', categoryId:'mail', title:'NAREVO Mail — One', term:'1 месяц', description:'Официальный цифровой код подписки. Регион и условия указаны перед оплатой.', price:490, active:true },
    { id:'gmail-plus', categoryId:'mail', title:'NAREVO Mail — Plus', term:'3 месяца', description:'Код активации расширенного тарифа для совместимого аккаунта.', price:1290, active:true }
  ], 
  codes:[], 
  users:{}, 
  orders:[], 
  topups:[], 
  tickets:[], 
  audit:[] 
};

let db = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,'utf8')) : structuredClone(seed);
db.categories ||= structuredClone(seed.categories); 
db.tickets ||= []; 
db.uiMessages ||= {}; 
db.settings ||= {}; 
for(const p of db.products) p.categoryId ||= 'mail';

const save = () => { 
  fs.mkdirSync('data',{recursive:true}); 
  fs.writeFileSync(file, JSON.stringify(db,null,2)); 
};

if (!fs.existsSync(file)) save();

const id = () => crypto.randomUUID();
const stock = productId => db.codes.filter(c => c.productId===productId && !c.orderId).length;

// === USER VIEW ===
export function userView(user) {
  const key=String(user.id); 
  if (!db.users[key]) {
    db.users[key] = { 
      id:user.id, 
      name:user.first_name||user.username||'Пользователь', 
      balance:0, 
      joinedAt:new Date().toISOString(),
      agreed: false
    }; 
    save();
  }
  return { 
    user:db.users[key], 
    categories:db.categories.filter(c=>c.active), 
    products:db.products.filter(p=>p.active).map(p=>({...p,stock:stock(p.id)})), 
    orders:db.orders.filter(o=>o.userId===user.id).map(o=>({...o,code:o.encryptedCode?decrypt(o.encryptedCode):null})), 
    topups:db.topups.filter(t=>t.userId===user.id), 
    tickets:db.tickets.filter(t=>t.userId===user.id).map(ticketView) 
  };
}

// === ADMIN VIEW ===
export function adminView(){ 
  return { 
    categories:db.categories.slice().sort((a,b)=>Number(b.active)-Number(a.active)), 
    products:db.products.map(p=>({...p,stock:stock(p.id)})).sort((a,b)=>Number(b.active)-Number(a.active)), 
    orders:db.orders.slice(-50).reverse(), 
    topups:db.topups.slice(-50).reverse(), 
    tickets:db.tickets.slice(-50).reverse().map(ticketView), 
    users:Object.values(db.users), 
    audit:db.audit.slice(-50).reverse() 
  }; 
}

// === BUY ===
export function buy(user, productId){ 
  const p=db.products.find(x=>x.id===productId&&x.active); 
  const u=db.users[String(user.id)]; 
  const code=db.codes.find(x=>x.productId===productId&&!x.orderId); 
  if(!p) throw Error('Товар недоступен'); 
  if(!code) throw Error('Коды закончились'); 
  if(u.balance<p.price) throw Error('Недостаточно средств'); 
  const order={
    id:id(),
    userId:user.id,
    productId,
    title:p.title,
    price:p.price,
    status:'delivered',
    createdAt:new Date().toISOString(),
    encryptedCode:code.value
  }; 
  u.balance-=p.price; 
  code.orderId=order.id; 
  db.orders.push(order); 
  audit(user.id,'purchase',order.id); 
  save(); 
  return {...order,code:decrypt(code.value),balance:u.balance}; 
}

// === TOPUP ===
export function requestTopup(user, amount, method='sbp'){ 
  if(!Number.isFinite(amount)||amount<50||amount>100000) throw Error('Сумма от 50 до 100 000 ₽'); 
  const validMethods = ['sbp','sbp14','cryptobot','heleket']; 
  if(!validMethods.includes(method)) throw Error('Способ оплаты недоступен'); 
  const feeRates = { 'sbp': 0.14, 'sbp14': 0.14, 'cryptobot': 0, 'heleket': 0 }; 
  const feeRate = feeRates[method] || 0; 
  const feeAmount = Math.round(amount * feeRate * 100) / 100; 
  const paymentAmount = Math.round((amount + feeAmount) * 100) / 100; 
  const t={
    id:id(),
    userId:user.id,
    amount,
    paymentAmount,
    feeRate,
    feeAmount,
    method,
    status:'pending',
    createdAt:new Date().toISOString()
  }; 
  db.topups.push(t); 
  audit(user.id,'topup_requested',t.id); 
  save(); 
  return t; 
}

// === CRYPTOBOT ===
export function attachCryptoPayInvoice(topupId,invoiceId,paymentUrl){
  const t=db.topups.find(x=>x.id===topupId&&x.method==='cryptobot'&&x.status==='pending');
  if(!t) throw Error('Заявка CryptoBot не найдена');
  const normalized=String(invoiceId);
  if(db.topups.some(x=>String(x.cryptoPayInvoiceId)===normalized&&x.id!==topupId)) throw Error('Счёт CryptoBot уже зарегистрирован');
  t.cryptoPayInvoiceId=normalized;
  t.paymentUrl=paymentUrl;
  t.gatewayStatus='active';
  save();
  return t;
}

export function settleCryptoPayInvoice(topupId,invoiceId,amount){
  const t=db.topups.find(x=>x.id===topupId&&x.method==='cryptobot');
  if(!t||String(t.cryptoPayInvoiceId)!==String(invoiceId)) throw Error('Счёт CryptoBot не найден');
  if(Number(t.amount)!==Number(amount)) throw Error('Сумма счёта CryptoBot не совпадает');
  const newlyApproved=t.status==='pending';
  if(newlyApproved){
    const u=db.users[String(t.userId)];
    if(!u) throw Error('Пользователь не найден');
    t.status='approved';
    t.gatewayStatus='paid';
    t.approvedAt=new Date().toISOString();
    u.balance+=t.amount;
    audit('cryptobot','topup_confirmed',t.id);
    save();
  }
  return {...t,newlyApproved};
}

// === HELEKET ===
export function attachHeleketInvoice(topupId,invoiceId,paymentUrl){
  const t=db.topups.find(x=>x.id===topupId&&x.method==='heleket'&&x.status==='pending');
  if(!t) throw Error('Заявка Heleket не найдена');
  const normalized=String(invoiceId);
  if(db.topups.some(x=>String(x.heleketInvoiceId)===normalized&&x.id!==topupId)) throw Error('Счёт Heleket уже зарегистрирован');
  t.heleketInvoiceId=normalized;
  t.paymentUrl=paymentUrl;
  t.gatewayStatus='pending';
  save();
  return t;
}

export function settleHeleketInvoice(topupId,invoiceId,amount){
  const t=db.topups.find(x=>x.method==='heleket'&&(x.id===topupId||String(x.heleketInvoiceId)===String(invoiceId)));
  if(!t||String(t.heleketInvoiceId)!==String(invoiceId)) throw Error('Счёт Heleket не найден');
  if(Number(t.amount)!==Number(amount)) throw Error('Сумма счёта Heleket не совпадает');
  const newlyApproved=t.status==='pending';
  if(newlyApproved){
    const u=db.users[String(t.userId)];
    if(!u) throw Error('Пользователь не найден');
    t.status='approved';
    t.gatewayStatus='paid';
    t.approvedAt=new Date().toISOString();
    u.balance+=t.amount;
    audit('heleket','topup_confirmed',t.id);
    save();
  }
  return {...t,newlyApproved};
}

// === FAIL TOPUP ===
export function failTopup(topupId,reason){
  const t=db.topups.find(x=>x.id===topupId&&x.status==='pending');
  if(t){
    t.status='failed';
    t.failureReason=String(reason||'gateway_error').slice(0,200);
    save();
  }
  return t;
}

// === CODES ===
export function addCodes(adminId,productId,values){ 
  const p=db.products.find(x=>x.id===productId); 
  if(!p) throw Error('Товар не найден'); 
  const clean=[...new Set(values.map(x=>x.trim()).filter(Boolean))]; 
  if(clean.some(x=>/^\S+?:\S+$/.test(x))) throw Error('Формат login:pass запрещён. Загружайте только коды активации'); 
  for(const value of clean) {
    db.codes.push({
      id:id(),
      productId,
      value:encrypt(value),
      createdAt:new Date().toISOString()
    }); 
  }
  audit(adminId,'codes_added',`${productId}:${clean.length}`); 
  save(); 
  return clean.length; 
}

// === APPROVE TOPUP ===
export function approveTopup(adminId,topupId){ 
  const t=db.topups.find(x=>x.id===topupId); 
  if(!t||t.status!=='pending') throw Error('Заявка уже обработана'); 
  if(t.cryptoPayInvoiceId||t.heleketInvoiceId) throw Error('Автоматический счёт подтверждается только через платёжную систему');
  t.status='approved'; 
  db.users[String(t.userId)].balance+=t.amount; 
  audit(adminId,'topup_approved',t.id); 
  save(); 
  return t; 
}

// === PRODUCTS ===
export function addProduct(adminId,p){ 
  const category=db.categories.find(c=>c.id===p.categoryId&&c.active)||db.categories.find(c=>c.active);
  const product={
    id:id(),
    categoryId:category?.id||'mail',
    title:String(p.title).trim().slice(0,80),
    term:String(p.term).trim().slice(0,40),
    description:String(p.description).trim().slice(0,240),
    price:Number(p.price),
    active:true
  }; 
  if(!product.title||!product.term||!product.description||product.price<1) throw Error('Проверьте данные товара'); 
  db.products.push(product); 
  audit(adminId,'product_added',product.id); 
  save(); 
  return product; 
}

export function archiveProduct(adminId,productId){
  const p=db.products.find(x=>x.id===productId&&x.active);
  if(!p) throw Error('Товар не найден');
  p.active=false;
  p.archivedAt=new Date().toISOString();
  audit(adminId,'product_archived',p.id);
  save();
  return p;
}

// === CATEGORIES ===
export function addCategory(adminId,title){
  title=String(title).trim().slice(0,60);
  if(!title) throw Error('Название пустое');
  const c={id:id(), title, active:true};
  db.categories.push(c);
  audit(adminId,'category_added',c.id);
  save();
  return c;
}

export function toggleCategory(adminId,categoryId){
  const c=db.categories.find(x=>x.id===categoryId);
  if(!c) throw Error('Категория не найдена');
  c.active=!c.active;
  audit(adminId,'category_toggled',c.id);
  save();
  return c;
}

// === PRICE ===
export function updateProductPrice(adminId,productId,price){
  const p=db.products.find(x=>x.id===productId);
  price=Number(price);
  if(!p||!Number.isFinite(price)||price<1||price>1000000) throw Error('Некорректная цена');
  p.price=price;
  audit(adminId,'price_updated',p.id);
  save();
  return p;
}

// === PRODUCT CATEGORY ===
export function setProductCategory(adminId,productId,categoryId){
  const p=db.products.find(x=>x.id===productId);
  const c=db.categories.find(x=>x.id===categoryId);
  if(!p||!c) throw Error('Товар или категория не найдены');
  p.categoryId=c.id;
  audit(adminId,'product_category_updated',p.id);
  save();
  return p;
}

// === TICKETS ===
export function createTicket(user){
  const existing=db.tickets.find(t=>t.userId===user.id&&t.status==='open');
  if(existing) return ticketView(existing);
  const t={
    id:id().slice(0,8),
    userId:user.id,
    userName:user.first_name||user.username||'Пользователь',
    status:'open',
    createdAt:new Date().toISOString(),
    messages:[{
      author:'system',
      text:'Тикет создан. Опишите вопрос одним сообщением.',
      at:new Date().toISOString()
    }]
  };
  db.tickets.push(t);
  audit(user.id,'ticket_created',t.id);
  save();
  return ticketView(t);
}

export function addTicketMessage(actor,ticketId,text,isAdmin=false){
  const t=db.tickets.find(x=>x.id===ticketId);
  text=String(text).trim().slice(0,2000);
  if(!t||!text||(!isAdmin&&t.userId!==actor)) throw Error('Тикет недоступен');
  if(t.status!=='open') throw Error('Тикет закрыт');
  t.messages.push({
    author:isAdmin?'admin':'user',
    authorId:actor,
    text,
    at:new Date().toISOString()
  });
  t.updatedAt=new Date().toISOString();
  save();
  return ticketView(t);
}

export function closeTicket(adminId,ticketId){
  const t=db.tickets.find(x=>x.id===ticketId);
  if(!t) throw Error('Тикет не найден');
  t.status='closed';
  t.closedAt=new Date().toISOString();
  audit(adminId,'ticket_closed',t.id);
  save();
  return ticketView(t);
}

// === UI MESSAGES ===
export function getUiMessage(chatId){
  return db.uiMessages[String(chatId)] || null;
}

export function setUiMessage(chatId,messageId){
  if(messageId) db.uiMessages[String(chatId)] = messageId;
  else delete db.uiMessages[String(chatId)];
  save();
}

// === BUTTON EMOJIS ===
export function getButtonEmojis(){
  return {...(db.settings.buttonEmojis || {})};
}

export function setButtonEmojis(adminId,values){
  const ids=values.slice(0,3).map(String);
  if(ids.length!==3||ids.some(x=>!/^\d+$/.test(x))) throw Error('Нужно отправить три премиум-эмодзи одним сообщением');
  db.settings.buttonEmojis = {
    cryptoBot: ids[0],
    heleket: ids[1],
    sbp: ids[2]
  };
  audit(adminId,'button_emojis_updated','payments');
  save();
  return getButtonEmojis();
}

// === USER AGREEMENT ===
export function setUserAgreed(userId) {
  const key = String(userId);
  if (!db.users[key]) {
    db.users[key] = { 
      id: userId, 
      name: 'Пользователь', 
      balance: 0, 
      joinedAt: new Date().toISOString(),
      agreed: false
    };
  }
  db.users[key].agreed = true;
  db.users[key].agreedAt = new Date().toISOString();
  save();
  return true;
}

export function hasUserAgreed(userId) {
  const key = String(userId);
  return db.users[key] && db.users[key].agreed === true;
}

// === HELPERS ===
function ticketView(t){
  return {...t, messages: t.messages.slice(-20)};
}

function audit(actor,action,target){
  db.audit.push({
    id:id(),
    actor,
    action,
    target,
    at:new Date().toISOString()
  });
}