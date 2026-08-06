import fs from 'node:fs';
import crypto from 'node:crypto';
import { encrypt, decrypt } from './security.js';

const file = 'data/store.json';
const seed = { products: [
  { id:'gmail-one', title:'Gmail — подписка One', term:'1 месяц', description:'Официальный цифровой код подписки. Регион и условия указаны перед оплатой.', price:490, active:true },
  { id:'gmail-plus', title:'Gmail — подписка Plus', term:'3 месяца', description:'Код активации расширенного тарифа для совместимого аккаунта.', price:1290, active:true }
], codes:[], users:{}, orders:[], topups:[], audit:[] };
let db = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,'utf8')) : structuredClone(seed);
const save = () => { fs.mkdirSync('data',{recursive:true}); fs.writeFileSync(file, JSON.stringify(db,null,2)); };
if (!fs.existsSync(file)) save();
const id = () => crypto.randomUUID();
const stock = productId => db.codes.filter(c => c.productId===productId && !c.orderId).length;

export function userView(user) {
  const key=String(user.id); db.users[key] ||= { id:user.id, name:user.first_name||user.username||'Пользователь', balance:0, joinedAt:new Date().toISOString() }; save();
  return { user:db.users[key], products:db.products.filter(p=>p.active).map(p=>({...p,stock:stock(p.id)})), orders:db.orders.filter(o=>o.userId===user.id).map(o=>({...o,code:o.encryptedCode?decrypt(o.encryptedCode):null})), topups:db.topups.filter(t=>t.userId===user.id) };
}
export function adminView(){ return { products:db.products.map(p=>({...p,stock:stock(p.id)})), orders:db.orders.slice(-50).reverse(), topups:db.topups.slice(-50).reverse(), users:Object.values(db.users), audit:db.audit.slice(-50).reverse() }; }
export function buy(user, productId){ const p=db.products.find(x=>x.id===productId&&x.active); const u=db.users[String(user.id)]; const code=db.codes.find(x=>x.productId===productId&&!x.orderId); if(!p) throw Error('Товар недоступен'); if(!code) throw Error('Коды закончились'); if(u.balance<p.price) throw Error('Недостаточно средств'); const order={id:id(),userId:user.id,productId,title:p.title,price:p.price,status:'delivered',createdAt:new Date().toISOString(),encryptedCode:code.value}; u.balance-=p.price; code.orderId=order.id; db.orders.push(order); audit(user.id,'purchase',order.id); save(); return {...order,code:decrypt(code.value),balance:u.balance}; }
export function requestTopup(user, amount){ if(!Number.isFinite(amount)||amount<100||amount>100000) throw Error('Сумма от 100 до 100 000 ₽'); const t={id:id(),userId:user.id,amount,status:'pending',createdAt:new Date().toISOString()}; db.topups.push(t); audit(user.id,'topup_requested',t.id); save(); return t; }
export function addCodes(adminId,productId,values){ const p=db.products.find(x=>x.id===productId); if(!p) throw Error('Товар не найден'); const clean=[...new Set(values.map(x=>x.trim()).filter(Boolean))]; for(const value of clean) db.codes.push({id:id(),productId,value:encrypt(value),createdAt:new Date().toISOString()}); audit(adminId,'codes_added',`${productId}:${clean.length}`); save(); return clean.length; }
export function approveTopup(adminId,topupId){ const t=db.topups.find(x=>x.id===topupId); if(!t||t.status!=='pending') throw Error('Заявка уже обработана'); t.status='approved'; db.users[String(t.userId)].balance+=t.amount; audit(adminId,'topup_approved',t.id); save(); return t; }
export function addProduct(adminId,p){ const product={id:id(),title:String(p.title).slice(0,80),term:String(p.term).slice(0,40),description:String(p.description).slice(0,240),price:Number(p.price),active:true}; if(!product.title||product.price<1) throw Error('Проверьте название и цену'); db.products.push(product); audit(adminId,'product_added',product.id); save(); return product; }
function audit(actor,action,target){db.audit.push({id:id(),actor,action,target,at:new Date().toISOString()});}
