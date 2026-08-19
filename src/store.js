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
  audit:[],
  sellerAssignments:[],
  sellerProfiles:{},
  sellerLedger:[],
  withdrawals:[],
  reviews:[]
};

let db = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,'utf8')) : structuredClone(seed);
db.categories ||= structuredClone(seed.categories); 
db.tickets ||= []; 
db.uiMessages ||= {}; 
db.settings ||= {}; 
db.casheraWebhookEvents ||= [];
db.sellerAssignments ||= [];
db.sellerProfiles ||= {};
db.sellerLedger ||= [];
db.withdrawals ||= [];
db.reviews ||= [];
for(const p of db.products){
  p.categoryId ||= 'mail';
  p.moderationStatus ||= p.sellerId ? 'pending' : 'approved';
}
for(const c of db.codes){
  c.status ||= c.orderId ? 'sold' : 'available';
  c.sellerId ??= db.products.find(p=>p.id===c.productId)?.sellerId || null;
}
for(const u of Object.values(db.users)){
  u.sellerAvailableBalance=Number(u.sellerAvailableBalance)||0;
  u.sellerHoldBalance=Number(u.sellerHoldBalance)||0;
}
for(const o of db.orders){
  o.quantity ||= 1;
  o.unitPrice ??= o.price;
  o.totalPrice ??= o.price;
  o.itemIds ||= db.codes.filter(c=>c.orderId===o.id).map(c=>c.id);
}

const save = () => { 
  fs.mkdirSync('data',{recursive:true}); 
  const temp=`${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(db,null,2));
  fs.renameSync(temp,file);
};

if (!fs.existsSync(file)) save();

const id = () => crypto.randomUUID();
const HOLD_MS=72*60*60*1000;
const MAX_ITEMS_PER_ORDER=Math.max(1,Math.min(100,Number(process.env.MAX_ITEMS_PER_ORDER)||20));
const commissionPercent=()=>Math.max(0,Math.min(100,Number(process.env.SELLER_COMMISSION_PERCENT)||10));
const stock = productId => db.codes.filter(c => c.productId===productId && !c.orderId && (c.status||'available')==='available').length;
const roundMoney=value=>Math.round(Number(value)*100)/100;

function ensureUser(user){
  const key=String(user.id??user);
  if(!db.users[key])db.users[key]={id:Number(user.id??user),name:user.first_name||user.username||'Пользователь',username:user.username||'',balance:0,sellerAvailableBalance:0,sellerHoldBalance:0,joinedAt:new Date().toISOString(),agreed:false};
  db.users[key].sellerAvailableBalance=Number(db.users[key].sellerAvailableBalance)||0;
  db.users[key].sellerHoldBalance=Number(db.users[key].sellerHoldBalance)||0;
  return db.users[key];
}

function ledger(userId,type,amount,details={}){
  const row={id:id(),userId:Number(userId),type,amount:roundMoney(amount),at:new Date().toISOString(),...details};
  db.sellerLedger.push(row);
  return row;
}

export function releaseMatureHolds(now=Date.now()){
  let released=0;
  for(const order of db.orders){
    if(!order.sellerId||order.holdReleasedAt||!['approved','partially_refunded'].includes(order.status)||order.checkStatus!=='approved')continue;
    if(Date.parse(order.holdReleaseAt||0)>now)continue;
    const seller=ensureUser(order.sellerId);
    const amount=roundMoney((order.sellerNetAmount||0)-(order.sellerNetRefunded||0));
    if(amount<=0)continue;
    seller.sellerHoldBalance=roundMoney(Math.max(0,seller.sellerHoldBalance-amount));
    seller.sellerAvailableBalance=roundMoney(seller.sellerAvailableBalance+amount);
    order.status='completed';
    order.holdReleasedAt=new Date(now).toISOString();
    order.history||=[];
    order.history.push({status:'completed',actor:'system',at:order.holdReleasedAt});
    ledger(order.sellerId,'hold_released',amount,{orderId:order.id});
    released++;
  }
  if(released)save();
  return released;
}

export function userView(user) {
  releaseMatureHolds();
  const key=String(user.id); 
  if (!db.users[key]) {
    db.users[key] = { 
      id:user.id, 
      name:user.first_name||user.username||'Пользователь',
      username:user.username||'',
      balance:0,
      sellerAvailableBalance:0,
      sellerHoldBalance:0,
      joinedAt:new Date().toISOString(),
      agreed: false
    }; 
    save();
  } else {
    let changed=false;
    const nextName=user.first_name||user.username||db.users[key].name||'Пользователь';
    const nextUsername=user.username||'';
    if(db.users[key].name!==nextName){db.users[key].name=nextName;changed=true}
    if((db.users[key].username||'')!==nextUsername){db.users[key].username=nextUsername;changed=true}
    if(changed)save();
  }
  return { 
    user:db.users[key], 
    categories:db.categories.filter(c=>c.active), 
    products:db.products.filter(p=>p.active&&p.moderationStatus!=='pending'&&p.moderationStatus!=='rejected').map(p=>({...p,stock:stock(p.id),rating:productRating(p.id)})), 
    orders:db.orders.filter(o=>o.userId===user.id).map(orderView), 
    topups:db.topups.filter(t=>t.userId===user.id), 
    tickets:db.tickets.filter(t=>t.userId===user.id).map(ticketView) 
  };
}

export function adminView(){ 
  releaseMatureHolds();
  return { 
    categories:db.categories.slice().sort((a,b)=>Number(b.active)-Number(a.active)), 
    products:db.products.map(p=>({...p,stock:stock(p.id),rating:productRating(p.id)})).sort((a,b)=>Number(b.active)-Number(a.active)), 
    orders:db.orders.slice(-100).reverse().map(adminOrderView), 
    topups:db.topups.slice(-50).reverse(), 
    tickets:db.tickets.slice(-50).reverse().map(ticketView), 
    users:Object.values(db.users), 
    audit:db.audit.slice(-50).reverse(),
    sellerAssignments:db.sellerAssignments.slice(),
    sellerProfiles:{...db.sellerProfiles},
    sellerLedger:db.sellerLedger.slice(-100).reverse(),
    withdrawals:db.withdrawals.slice(-100).reverse(),
    reviews:db.reviews.slice(-100).reverse(),
    botEnabled: isBotEnabled()
  }; 
}

function productRating(productId){
  const rows=db.reviews.filter(r=>r.productId===productId&&!r.hidden);
  return {average:rows.length?Math.round(rows.reduce((s,r)=>s+r.rating,0)/rows.length*10)/10:0,count:rows.length};
}

function orderCodes(order){
  if(order.itemIds?.length)return order.itemIds.map(itemId=>db.codes.find(c=>c.id===itemId)).filter(Boolean).map(c=>decrypt(c.value));
  return order.encryptedCode?[decrypt(order.encryptedCode)]:[];
}

function orderView(order){
  const codes=orderCodes(order);
  return {...order,codes,code:codes[0]||null};
}

function adminOrderView(order){return {...order,itemCount:order.itemIds?.length||order.quantity||1}}

export function sellerView(sellerId){
  releaseMatureHolds();
  const seller=ensureUser(sellerId);
  const products=db.products.filter(p=>Number(p.sellerId)===Number(sellerId)).map(p=>({...p,stock:stock(p.id),rating:productRating(p.id)}));
  const orders=db.orders.filter(o=>Number(o.sellerId)===Number(sellerId)).slice(-100).reverse().map(adminOrderView);
  const reviews=db.reviews.filter(r=>Number(r.sellerId)===Number(sellerId)).slice(-100).reverse();
  const ratings=reviews.filter(r=>!r.hidden);
  return {
    user:{...seller},
    profile:{...(db.sellerProfiles[String(sellerId)]||{})},
    assignments:db.sellerAssignments.filter(a=>Number(a.sellerId)===Number(sellerId)),
    categories:db.categories.filter(c=>db.sellerAssignments.some(a=>Number(a.sellerId)===Number(sellerId)&&a.categoryId===c.id)),
    products,
    orders,
    reviews,
    withdrawals:db.withdrawals.filter(w=>Number(w.sellerId)===Number(sellerId)).slice(-50).reverse(),
    ledger:db.sellerLedger.filter(l=>Number(l.userId)===Number(sellerId)).slice(-50).reverse(),
    stats:{
      activeProducts:products.filter(p=>p.active&&p.moderationStatus==='approved').length,
      stock:products.reduce((s,p)=>s+p.stock,0),
      pendingOrders:orders.filter(o=>['pending_check','disputed'].includes(o.status)).length,
      sales:roundMoney(orders.filter(o=>!['refunded','cancelled'].includes(o.status)).reduce((s,o)=>s+Number(o.totalPrice||o.price||0),0)),
      rating:ratings.length?Math.round(ratings.reduce((s,r)=>s+r.rating,0)/ratings.length*10)/10:0,
      reviewCount:ratings.length
    }
  };
}

export function assignSellerCategory(adminId,sellerId,categoryId){
  sellerId=Number(sellerId);
  const category=db.categories.find(c=>c.id===categoryId);
  if(!Number.isInteger(sellerId)||!category)throw Error('Продавец или категория не найдены');
  ensureUser(sellerId);
  if(!db.sellerAssignments.some(a=>a.sellerId===sellerId&&a.categoryId===categoryId))db.sellerAssignments.push({sellerId,categoryId,assignedBy:adminId,assignedAt:new Date().toISOString()});
  audit(adminId,'seller_category_assigned',`${sellerId}:${categoryId}`);save();
  return sellerView(sellerId);
}

export function unassignSellerCategory(adminId,sellerId,categoryId){
  const before=db.sellerAssignments.length;
  db.sellerAssignments=db.sellerAssignments.filter(a=>!(Number(a.sellerId)===Number(sellerId)&&a.categoryId===categoryId));
  if(before===db.sellerAssignments.length)throw Error('Назначение не найдено');
  audit(adminId,'seller_category_unassigned',`${sellerId}:${categoryId}`);save();
  return sellerView(sellerId);
}

export function setSellerSuspended(adminId,sellerId,suspended,reason=''){
  sellerId=Number(sellerId);ensureUser(sellerId);
  db.sellerProfiles[String(sellerId)]={...(db.sellerProfiles[String(sellerId)]||{}),suspended:Boolean(suspended),reason:String(reason).trim().slice(0,300),updatedAt:new Date().toISOString(),updatedBy:adminId};
  audit(adminId,suspended?'seller_suspended':'seller_restored',sellerId);save();
  return sellerView(sellerId);
}

function assertSellerActive(sellerId){if(db.sellerProfiles[String(sellerId)]?.suspended)throw Error('Доступ продавца приостановлен')}

export function addSellerProduct(sellerId,p){
  sellerId=Number(sellerId);assertSellerActive(sellerId);
  if(!db.sellerAssignments.some(a=>a.sellerId===sellerId&&a.categoryId===p.categoryId))throw Error('Категория не закреплена за продавцом');
  const product={id:id(),categoryId:p.categoryId,sellerId,title:String(p.title||'').trim().slice(0,80),term:String(p.term||'').trim().slice(0,40),description:String(p.description||'').trim().slice(0,500),price:roundMoney(p.price),active:false,moderationStatus:'pending',createdAt:new Date().toISOString()};
  if(!product.title||!product.term||!product.description||!Number.isFinite(product.price)||product.price<1||product.price>1000000)throw Error('Проверьте данные товара');
  db.products.push(product);audit(sellerId,'seller_product_submitted',product.id);save();return product;
}

export function moderateSellerProduct(adminId,productId,approved,reason=''){
  const p=db.products.find(x=>x.id===productId&&x.sellerId);
  if(!p)throw Error('Товар продавца не найден');
  p.moderationStatus=approved?'approved':'rejected';p.active=Boolean(approved);p.moderatedAt=new Date().toISOString();p.moderatedBy=adminId;p.moderationReason=String(reason).trim().slice(0,300);
  audit(adminId,approved?'seller_product_approved':'seller_product_rejected',p.id);save();return {...p,stock:stock(p.id)};
}

export function addSellerCodes(sellerId,productId,values){
  sellerId=Number(sellerId);assertSellerActive(sellerId);
  const p=db.products.find(x=>x.id===productId&&Number(x.sellerId)===sellerId&&x.active&&x.moderationStatus==='approved');
  if(!p)throw Error('Товар недоступен продавцу');
  const clean=[...new Set(values.map(x=>String(x).trim()).filter(Boolean))];
  const existing=new Set(db.codes.filter(c=>c.productId===productId).map(c=>{try{return decrypt(c.value)}catch{return null}}));
  const fresh=clean.filter(value=>!existing.has(value));
  for(const value of fresh)db.codes.push({id:id(),productId,sellerId,value:encrypt(value),status:'available',createdAt:new Date().toISOString()});
  audit(sellerId,'seller_stock_added',`${productId}:${fresh.length}`);save();
  return {added:fresh.length,duplicates:clean.length-fresh.length,rejected:values.length-clean.length};
}

export function getRecentTopups(days=3){
  const safeDays=Math.max(1,Math.min(30,Number(days)||3));
  const cutoff=Date.now()-safeDays*24*60*60*1000;
  return db.topups
    .filter(t=>{
      const when=Date.parse(t.createdAt||t.approvedAt||0);
      return Number.isFinite(when)&&when>=cutoff;
    })
    .map(t=>{
      const u=db.users[String(t.userId)]||{};
      return {
        ...t,
        userName:t.userName||u.name||'Пользователь',
        username:t.username||u.username||''
      };
    })
    .sort((a,b)=>Date.parse(b.createdAt||0)-Date.parse(a.createdAt||0));
}

export function buy(user, productId,quantity=1){ 
  const p=db.products.find(x=>x.id===productId&&x.active&&x.moderationStatus!=='pending'&&x.moderationStatus!=='rejected'); 
  const u=ensureUser(user);
  quantity=Number(quantity);
  if(!p) throw Error('Товар недоступен'); 
  if(!Number.isInteger(quantity)||quantity<1||quantity>MAX_ITEMS_PER_ORDER)throw Error(`Количество от 1 до ${MAX_ITEMS_PER_ORDER}`);
  if(p.sellerId&&Number(p.sellerId)===Number(user.id))throw Error('Нельзя купить собственный товар');
  const items=db.codes.filter(x=>x.productId===productId&&!x.orderId&&(x.status||'available')==='available').slice(0,quantity);
  if(items.length<quantity) throw Error('Недостаточно товара в наличии'); 
  const unitPrice=roundMoney(p.price);
  const totalPrice=roundMoney(unitPrice*quantity);
  if(u.balance<totalPrice) throw Error('Недостаточно средств');
  const createdAt=new Date().toISOString();
  const commission=p.sellerId?roundMoney(totalPrice*commissionPercent()/100):0;
  const sellerNetAmount=p.sellerId?roundMoney(totalPrice-commission):0;
  const order={
    id:id(),
    userId:user.id,
    buyerId:user.id,
    sellerId:p.sellerId||null,
    productId,
    title:p.title,
    price:totalPrice,
    unitPrice,
    totalPrice,
    quantity,
    commission,
    sellerNetAmount,
    status:p.sellerId?'pending_check':'delivered',
    checkStatus:p.sellerId?'pending':'not_required',
    createdAt,
    holdReleaseAt:p.sellerId?new Date(Date.parse(createdAt)+HOLD_MS).toISOString():null,
    itemIds:items.map(x=>x.id),
    history:[{status:p.sellerId?'pending_check':'delivered',actor:user.id,at:createdAt}]
  }; 
  u.balance=roundMoney(u.balance-totalPrice);
  for(const item of items){item.orderId=order.id;item.status='sold';item.soldAt=createdAt}
  if(p.sellerId){
    const seller=ensureUser(p.sellerId);
    seller.sellerHoldBalance=roundMoney(seller.sellerHoldBalance+sellerNetAmount);
    ledger(p.sellerId,'sale_hold',sellerNetAmount,{orderId:order.id,buyerId:user.id,quantity});
  }
  db.orders.push(order); 
  audit(user.id,'purchase',order.id); 
  save(); 
  const codes=items.map(x=>decrypt(x.value));
  return {...order,codes,code:codes[0]||null,balance:u.balance}; 
}

export function approveSellerOrder(adminId,orderId){
  const order=db.orders.find(o=>o.id===orderId&&o.sellerId);
  if(!order)throw Error('Заказ продавца не найден');
  if(order.status==='approved'||order.status==='completed')return adminOrderView(order);
  if(!['pending_check','disputed','partially_refunded'].includes(order.status))throw Error('Заказ уже обработан');
  order.status=order.refundedQuantity?'partially_refunded':'approved';order.checkStatus='approved';order.approvedAt=new Date().toISOString();order.approvedBy=adminId;order.history||=[];order.history.push({status:order.status,actor:adminId,at:order.approvedAt});
  audit(adminId,'seller_order_approved',order.id);save();releaseMatureHolds();return adminOrderView(order);
}

export function openOrderDispute(actorId,orderId){
  const order=db.orders.find(o=>o.id===orderId&&Number(o.userId)===Number(actorId)&&o.sellerId);
  if(!order)throw Error('Заказ недоступен');
  if(!['pending_check','approved'].includes(order.status))throw Error('Спор для этого заказа недоступен');
  if(db.tickets.some(t=>t.type==='order_dispute'&&t.orderId===orderId&&t.status==='open'))throw Error('По заказу уже открыт спор');
  order.status='disputed';order.checkStatus='disputed';order.history||=[];order.history.push({status:'disputed',actor:actorId,at:new Date().toISOString()});
  const user=db.users[String(actorId)]||{};
  const ticket={id:id().slice(0,8),type:'order_dispute',orderId,userId:Number(actorId),userName:user.name||'Пользователь',status:'open',createdAt:new Date().toISOString(),messages:[{author:'system',text:`Спор по заказу #${order.id.slice(0,8)} создан. Опишите проблему.`,at:new Date().toISOString()}]};
  db.tickets.push(ticket);audit(actorId,'order_dispute_opened',order.id);save();return ticketView(ticket);
}

export function refundSellerOrder(adminId,orderId,refundQuantity,reason=''){
  const order=db.orders.find(o=>o.id===orderId&&o.sellerId);
  if(!order)throw Error('Заказ продавца не найден');
  if(['refunded','completed','cancelled'].includes(order.status))throw Error('Заказ уже завершён');
  const remaining=(order.quantity||1)-(order.refundedQuantity||0);
  refundQuantity=refundQuantity==null?remaining:Number(refundQuantity);
  if(!Number.isInteger(refundQuantity)||refundQuantity<1||refundQuantity>remaining)throw Error('Некорректное количество возврата');
  const buyer=ensureUser(order.userId);const seller=ensureUser(order.sellerId);
  const refundAmount=roundMoney(order.unitPrice*refundQuantity);
  const netRefund=refundQuantity===remaining?roundMoney(order.sellerNetAmount-(order.sellerNetRefunded||0)):roundMoney((order.sellerNetAmount/(order.quantity||1))*refundQuantity);
  if(!order.holdReleasedAt)seller.sellerHoldBalance=roundMoney(Math.max(0,seller.sellerHoldBalance-netRefund));
  else seller.sellerAvailableBalance=roundMoney(Math.max(0,seller.sellerAvailableBalance-netRefund));
  buyer.balance=roundMoney(buyer.balance+refundAmount);
  order.refundedQuantity=(order.refundedQuantity||0)+refundQuantity;order.refundedAmount=roundMoney((order.refundedAmount||0)+refundAmount);order.sellerNetRefunded=roundMoney((order.sellerNetRefunded||0)+netRefund);order.refundReason=String(reason).trim().slice(0,500);order.refundedAt=new Date().toISOString();order.refundedBy=adminId;
  order.status=order.refundedQuantity===(order.quantity||1)?'refunded':'partially_refunded';order.checkStatus=order.status;
  order.history||=[];order.history.push({status:order.status,actor:adminId,quantity:refundQuantity,amount:refundAmount,at:order.refundedAt});
  const itemIds=(order.itemIds||[]).slice((order.refundedQuantity-refundQuantity),order.refundedQuantity);
  for(const itemId of itemIds){const item=db.codes.find(c=>c.id===itemId);if(item)item.status='blocked'}
  ledger(order.sellerId,'refund',-netRefund,{orderId:order.id,quantity:refundQuantity});audit(adminId,'seller_order_refunded',`${order.id}:${refundQuantity}`);save();return {...adminOrderView(order),refundAmount};
}

export function createWithdrawal(sellerId,amount){
  sellerId=Number(sellerId);releaseMatureHolds();assertSellerActive(sellerId);const seller=ensureUser(sellerId);amount=roundMoney(amount);
  if(!Number.isFinite(amount)||amount<100)throw Error('Минимальная сумма вывода — 100 ₽');
  if(amount>seller.sellerAvailableBalance)throw Error('Недостаточно доступных средств');
  if(db.withdrawals.some(w=>w.sellerId===sellerId&&['pending','approved'].includes(w.status)))throw Error('У вас уже есть активная заявка на вывод');
  const w={id:id(),sellerId,amount,status:'pending',createdAt:new Date().toISOString()};db.withdrawals.push(w);
  const ticket={id:id().slice(0,8),type:'withdrawal',withdrawalId:w.id,userId:sellerId,userName:seller.name||'Продавец',status:'open',createdAt:w.createdAt,messages:[{author:'system',text:`Заявка на вывод ${amount} ₽ создана. Дождитесь ответа поддержки.`,at:w.createdAt}]};db.tickets.push(ticket);w.ticketId=ticket.id;
  ledger(sellerId,'withdrawal_requested',0,{withdrawalId:w.id,amount});audit(sellerId,'withdrawal_requested',w.id);save();return {...w};
}

export function resolveWithdrawal(adminId,withdrawalId,status,reason=''){
  const w=db.withdrawals.find(x=>x.id===withdrawalId);
  if(!w||w.status!=='pending')throw Error('Заявка уже обработана');
  if(!['paid','rejected'].includes(status))throw Error('Некорректный статус выплаты');
  const seller=ensureUser(w.sellerId);
  if(status==='paid'){
    if(seller.sellerAvailableBalance<w.amount)throw Error('Недостаточно доступных средств');
    seller.sellerAvailableBalance=roundMoney(seller.sellerAvailableBalance-w.amount);ledger(w.sellerId,'withdrawal_paid',-w.amount,{withdrawalId:w.id});
  }
  w.status=status;w.reason=String(reason).trim().slice(0,500);w.processedAt=new Date().toISOString();w.processedBy=adminId;
  const ticket=db.tickets.find(t=>t.id===w.ticketId);if(ticket){ticket.status='closed';ticket.closedAt=w.processedAt}
  audit(adminId,`withdrawal_${status}`,w.id);save();return {...w};
}

export function adjustUserBalance(adminId,userId,balanceType,mode,amount,reason){
  userId=Number(userId);amount=roundMoney(amount);reason=String(reason||'').trim().slice(0,500);
  if(!Number.isInteger(userId)||!['balance','sellerAvailableBalance'].includes(balanceType)||!['add','subtract','set'].includes(mode)||!Number.isFinite(amount)||amount<0||!reason)throw Error('Проверьте параметры изменения баланса');
  const user=ensureUser(userId);const before=roundMoney(user[balanceType]||0);const after=mode==='set'?amount:roundMoney(before+(mode==='add'?amount:-amount));
  if(after<0)throw Error('Баланс не может быть отрицательным');
  user[balanceType]=after;ledger(userId,'admin_adjustment',roundMoney(after-before),{balanceType,adminId,reason,before,after});audit(adminId,'balance_adjusted',`${userId}:${balanceType}`);save();return {userId,balanceType,before,after};
}

export function createReview(userId,orderId,rating,text=''){
  userId=Number(userId);rating=Number(rating);text=String(text).trim().slice(0,500);
  const order=db.orders.find(o=>o.id===orderId&&Number(o.userId)===userId&&o.sellerId);
  if(!order||!['approved','completed','partially_refunded'].includes(order.status))throw Error('Отзыв для заказа пока недоступен');
  if(Number(order.sellerId)===userId)throw Error('Нельзя оставить отзыв самому себе');
  if(!Number.isInteger(rating)||rating<1||rating>5)throw Error('Оценка должна быть от 1 до 5');
  if(db.reviews.some(r=>r.orderId===orderId))throw Error('Отзыв уже оставлен');
  const review={id:id(),orderId,productId:order.productId,sellerId:Number(order.sellerId),userId,rating,text,hidden:false,createdAt:new Date().toISOString()};db.reviews.push(review);audit(userId,'review_created',review.id);save();return {...review};
}

export function setReviewHidden(adminId,reviewId,hidden,reason=''){
  const review=db.reviews.find(r=>r.id===reviewId);if(!review)throw Error('Отзыв не найден');review.hidden=Boolean(hidden);review.moderationReason=String(reason).trim().slice(0,300);review.moderatedAt=new Date().toISOString();review.moderatedBy=adminId;audit(adminId,hidden?'review_hidden':'review_restored',review.id);save();return {...review};
}

export function requestTopup(user, amount, method='sbp'){ 
  if(!Number.isFinite(amount)||amount<50||amount>100000) throw Error('Сумма от 50 до 100 000 ₽');
  const userKey=String(user.id);
  if(db.users[userKey]){
    db.users[userKey].name=user.first_name||user.username||db.users[userKey].name||'Пользователь';
    db.users[userKey].username=user.username||'';
  }
  const validMethods = ['sbp','sbp14','cryptobot','heleket','lzt']; 
  if(!validMethods.includes(method)) throw Error('Способ оплаты недоступен'); 
  const feeRates = { 'sbp': 0.14, 'sbp14': 0.14, 'cryptobot': 0, 'heleket': 0, 'lzt': 0 }; 
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
    userName:user.first_name||user.username||db.users[userKey]?.name||'Пользователь',
    username:user.username||db.users[userKey]?.username||'',
    createdAt:new Date().toISOString()
  }; 
  db.topups.push(t); 
  audit(user.id,'topup_requested',t.id); 
  save(); 
  return t; 
}

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


export function getPendingHeleketTopups(){
  return db.topups
    .filter(t=>t.method==='heleket'&&t.status==='pending'&&t.heleketInvoiceId)
    .map(t=>({...t}));
}

export function attachLztInvoice(topupId,invoiceId,paymentUrl){
  const t=db.topups.find(x=>x.id===topupId&&x.method==='lzt'&&x.status==='pending');
  if(!t) throw Error('Заявка LZT Market не найдена');
  const normalized=String(invoiceId);
  if(db.topups.some(x=>String(x.lztInvoiceId)===normalized&&x.id!==topupId)) throw Error('Счёт LZT Market уже зарегистрирован');
  t.lztInvoiceId=normalized;
  t.paymentUrl=paymentUrl;
  t.gatewayStatus='not_paid';
  save();
  return t;
}

export function settleLztInvoice(topupId,invoiceId,amount){
  const t=db.topups.find(x=>x.method==='lzt'&&(x.id===String(topupId)||String(x.lztInvoiceId)===String(invoiceId)));
  if(!t||String(t.lztInvoiceId)!==String(invoiceId)) throw Error('Счёт LZT Market не найден');
  if(Number(t.amount)!==Number(amount)) throw Error('Сумма счёта LZT Market не совпадает');
  const newlyApproved=t.status==='pending';
  if(newlyApproved){
    const u=db.users[String(t.userId)];
    if(!u) throw Error('Пользователь не найден');
    t.status='approved';
    t.gatewayStatus='paid';
    t.approvedAt=new Date().toISOString();
    u.balance+=t.amount;
    audit('lzt','topup_confirmed',t.id);
    save();
  }
  return {...t,newlyApproved};
}

export function getPendingLztTopups(){
  return db.topups.filter(t=>t.method==='lzt'&&t.status==='pending'&&t.lztInvoiceId).map(t=>({...t}));
}

export function attachCasheraSbpTransaction(topupId,transaction,paymentUrl){
  const t=db.topups.find(x=>x.id===String(topupId)&&x.method==='sbp'&&['pending','approved'].includes(x.status));
  if(!t) throw Error('Заявка СБП не найдена');
  const tx=transaction&&typeof transaction==='object'?transaction:{uuid:transaction,payment_url:paymentUrl,status:'pending'};
  const normalized=String(tx.uuid||'');
  if(!normalized) throw Error('Cashera не вернула uuid транзакции');
  if(db.topups.some(x=>String(x.casheraTransactionUuid)===normalized&&x.id!==t.id)) throw Error('Платёж Cashera уже зарегистрирован');
  const now=new Date().toISOString();
  const expectedMinor=Math.round(Number(t.paymentAmount)*100);
  t.casheraExternalId=String(tx.external_id||t.id);
  t.casheraTransactionUuid=normalized;
  t.paymentUrl=String(tx.payment_url||paymentUrl||t.paymentUrl||'');
  t.gatewayStatus=String(tx.status||'pending');
  t.casheraStatus=t.gatewayStatus;
  t.casheraAmountMinor=Number.isFinite(Number(tx.amount))?Number(tx.amount):expectedMinor;
  t.casheraCurrency=String(tx.currency||'RUB').toUpperCase();
  t.casheraCreatedAt=tx.created_at||t.casheraCreatedAt||now;
  t.casheraUpdatedAt=tx.updated_at||now;
  save();
  return t;
}

const finalCasheraFailures=new Set(['failed','expired','refunded','chargeback']);

export function syncCasheraSbpTransaction(transaction){
  const tx=transaction||{};
  const uuid=String(tx.uuid||'');
  const externalId=String(tx.external_id||'');
  const status=String(tx.status||'').toLowerCase();
  if(!uuid||!externalId||!status) throw Error('Cashera вернула неполные данные транзакции');
  const t=db.topups.find(x=>x.method==='sbp'&&(x.id===externalId||String(x.casheraExternalId)===externalId||String(x.casheraTransactionUuid)===uuid));
  if(!t) throw Error('Платёж Cashera СБП не найден');
  if(t.id!==externalId&&String(t.casheraExternalId||'')!==externalId) throw Error('external_id Cashera не совпадает с заявкой');
  if(t.casheraTransactionUuid&&String(t.casheraTransactionUuid)!==uuid) throw Error('uuid Cashera не совпадает с заявкой');

  const now=new Date().toISOString();
  const currency=String(tx.currency||t.casheraCurrency||'').toUpperCase();
  const amountMinor=Number(tx.amount);
  const expectedMinor=Math.round(Number(t.paymentAmount)*100);
  const method=String(tx.payment_method||'').toLowerCase();

  if(status==='paid'){
    if(!Number.isInteger(amountMinor)||amountMinor!==expectedMinor) throw Error('Сумма платежа Cashera не совпадает');
    if(currency!=='RUB') throw Error('Валюта платежа Cashera не совпадает');
    if(method!=='sbp') throw Error('Метод платежа Cashera не совпадает');
  }

  t.casheraExternalId=externalId;
  t.casheraTransactionUuid=uuid;
  t.gatewayStatus=status;
  t.casheraStatus=status;
  if(Number.isFinite(amountMinor))t.casheraAmountMinor=amountMinor;
  if(currency)t.casheraCurrency=currency;
  t.casheraCreatedAt=tx.created_at||t.casheraCreatedAt||t.createdAt||now;
  t.casheraUpdatedAt=tx.updated_at||now;
  if(tx.paid_at)t.casheraPaidAt=tx.paid_at;

  let newlyApproved=false;
  if(status==='paid'&&t.status==='pending'){
    const u=db.users[String(t.userId)];
    if(!u) throw Error('Пользователь не найден');
    t.status='approved';
    t.approvedAt=tx.paid_at||now;
    u.balance+=t.amount;
    newlyApproved=true;
    audit('cashera','topup_confirmed',t.id);
  }else if(finalCasheraFailures.has(status)&&t.status==='pending'){
    t.status='failed';
    t.failureReason=`cashera_${status}`;
    t.failedAt=now;
  }

  save();
  return {...t,newlyApproved};
}

export function processCasheraWebhookTransaction(transaction){
  const uuid=String(transaction?.uuid||'');
  const status=String(transaction?.status||'').toLowerCase();
  if(!uuid||!status) throw Error('Некорректное событие Cashera');
  const eventKey=`${uuid}:${status}`;
  if(db.casheraWebhookEvents.some(event=>event.key===eventKey))return {duplicate:true,newlyApproved:false};
  const result=syncCasheraSbpTransaction(transaction);
  db.casheraWebhookEvents.push({key:eventKey,uuid,status,processedAt:new Date().toISOString()});
  if(db.casheraWebhookEvents.length>5000)db.casheraWebhookEvents.splice(0,db.casheraWebhookEvents.length-5000);
  save();
  return {...result,duplicate:false};
}

export function settleCasheraSbpTransaction(topupId,transactionUuid,amountMinor){
  return syncCasheraSbpTransaction({
    external_id:String(topupId),
    uuid:String(transactionUuid),
    status:'paid',
    amount:Number(amountMinor),
    currency:'RUB',
    payment_method:'sbp'
  });
}

export function getPendingCasheraSbpTopups(){
  return db.topups.filter(t=>t.method==='sbp'&&t.status==='pending'&&t.casheraTransactionUuid).map(t=>({...t}));
}

export function failTopup(topupId,reason){
  const t=db.topups.find(x=>x.id===topupId&&x.status==='pending');
  if(t){
    t.status='failed';
    t.failureReason=String(reason||'gateway_error').slice(0,200);
    save();
  }
  return t;
}

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
      sellerId:p.sellerId||null,
      status:'available',
      createdAt:new Date().toISOString()
    }); 
  }
  audit(adminId,'codes_added',`${productId}:${clean.length}`); 
  save(); 
  return clean.length; 
}

export function approveTopup(adminId,topupId){ 
  const t=db.topups.find(x=>x.id===topupId); 
  if(!t||t.status!=='pending') throw Error('Заявка уже обработана'); 
  if(t.cryptoPayInvoiceId||t.heleketInvoiceId||t.lztInvoiceId||t.casheraTransactionUuid) throw Error('Автоматический счёт подтверждается только через платёжную систему');
  t.status='approved';
  t.approvedAt=new Date().toISOString();
  db.users[String(t.userId)].balance+=t.amount; 
  audit(adminId,'topup_approved',t.id); 
  save(); 
  return t; 
}

export function addProduct(adminId,p){ 
  const category=db.categories.find(c=>c.id===p.categoryId&&c.active)||db.categories.find(c=>c.active);
  const product={
    id:id(),
    categoryId:category?.id||'mail',
    title:String(p.title).trim().slice(0,80),
    term:String(p.term).trim().slice(0,40),
    description:String(p.description).trim().slice(0,240),
    price:Number(p.price),
    active:true,
    moderationStatus:'approved'
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

export function updateProductPrice(adminId,productId,price){
  const p=db.products.find(x=>x.id===productId);
  price=Number(price);
  if(!p||!Number.isFinite(price)||price<1||price>1000000) throw Error('Некорректная цена');
  p.price=price;
  audit(adminId,'price_updated',p.id);
  save();
  return p;
}

export function setProductCategory(adminId,productId,categoryId){
  const p=db.products.find(x=>x.id===productId);
  const c=db.categories.find(x=>x.id===categoryId);
  if(!p||!c) throw Error('Товар или категория не найдены');
  p.categoryId=c.id;
  audit(adminId,'product_category_updated',p.id);
  save();
  return p;
}

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

export function getUiMessage(chatId){
  return db.uiMessages[String(chatId)] || null;
}

export function setUiMessage(chatId,messageId){
  if(messageId) db.uiMessages[String(chatId)] = messageId;
  else delete db.uiMessages[String(chatId)];
  save();
}


export function getAllUserIds(){
  return Object.values(db.users).map(u=>u.id).filter(id=>Number.isInteger(Number(id)));
}

export function isBotEnabled(){
  return db.settings.botEnabled !== false;
}

export function setBotEnabled(adminId,enabled){
  db.settings.botEnabled = Boolean(enabled);
  audit(adminId, db.settings.botEnabled ? 'bot_enabled' : 'bot_disabled', 'service');
  save();
  return db.settings.botEnabled;
}

export function getButtonEmojis(){
  return {...(db.settings.buttonEmojis || {})};
}

export function setButtonEmojis(adminId,values){
  const ids=values.slice(0,4).map(String);
  if(ids.length!==4||ids.some(x=>!/^\d+$/.test(x))) throw Error('Нужно отправить четыре премиум-эмодзи одним сообщением');
  db.settings.buttonEmojis = {
    cryptoBot: ids[0],
    heleket: ids[1],
    sbp: ids[2],
    lzt: ids[3]
  };
  audit(adminId,'button_emojis_updated','payments');
  save();
  return getButtonEmojis();
}

export function setLztButtonEmoji(adminId,value){
  const id=String(value||'');
  if(!/^\d+$/.test(id)) throw Error('Нужно отправить один премиум-эмодзи LZT');
  db.settings.buttonEmojis = {
    ...(db.settings.buttonEmojis || {}),
    lzt: id
  };
  audit(adminId,'lzt_button_emoji_updated','payments');
  save();
  return getButtonEmojis();
}

export function setUserAgreed(userId) {
  const key = String(userId);
  if (!db.users[key]) {
    db.users[key] = { 
      id: userId, 
      name: 'Пользователь', 
      balance: 0,
      sellerAvailableBalance:0,
      sellerHoldBalance:0,
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

export function getUserLanguage(userId){
  const value=db.users[String(userId)]?.language;
  return value==='en'?'en':value==='ru'?'ru':null;
}

export function setUserLanguage(userId,language){
  if(!['ru','en'].includes(language))throw Error('Unsupported language');
  const key=String(userId);
  if(!db.users[key])db.users[key]={id:userId,name:'Пользователь',username:'',balance:0,sellerAvailableBalance:0,sellerHoldBalance:0,joinedAt:new Date().toISOString(),agreed:false};
  db.users[key].language=language;
  save();
  return language;
}

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
