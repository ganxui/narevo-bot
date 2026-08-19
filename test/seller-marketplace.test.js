import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('seller marketplace supports quantity, mandatory hold, review and withdrawal',async()=>{
  const previous=process.cwd();
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'narevo-seller-'));
  process.chdir(directory);
  process.env.DATA_KEY='12345678901234567890123456789012';
  try{
    const store=await import(`../src/store.js?seller=${Date.now()}`);
    const admin={id:1,first_name:'Admin'};
    const seller={id:2,first_name:'Seller'};
    const buyer={id:3,first_name:'Buyer'};
    store.userView(admin);store.userView(seller);store.userView(buyer);
    const category=store.adminView().categories[0];
    store.assignSellerCategory(admin.id,seller.id,category.id);
    const product=store.addSellerProduct(seller.id,{categoryId:category.id,title:'Test item',term:'1 month',description:'Test description',price:100});
    store.moderateSellerProduct(admin.id,product.id,true);
    assert.deepEqual(store.addSellerCodes(seller.id,product.id,['one','two','three','four']),{added:4,duplicates:0,rejected:0});
    store.adjustUserBalance(admin.id,buyer.id,'balance','set',1000,'test balance');

    const order=store.buy(buyer,product.id,3);
    assert.equal(order.quantity,3);
    assert.equal(order.totalPrice,300);
    assert.equal(order.codes.length,3);
    assert.equal(store.userView(buyer).user.balance,700);
    assert.equal(store.sellerView(seller.id).user.sellerHoldBalance,270);
    assert.throws(()=>store.buy(buyer,product.id,2),/Недостаточно товара/);
    assert.throws(()=>store.adjustUserBalance(admin.id,seller.id,'sellerHoldBalance','set',0,'forbidden'),/Проверьте параметры/);

    store.refundSellerOrder(admin.id,order.id,1,'one defective unit');
    assert.equal(store.userView(buyer).user.balance,800);
    assert.equal(store.sellerView(seller.id).user.sellerHoldBalance,180);
    store.approveSellerOrder(admin.id,order.id);
    store.releaseMatureHolds(Date.parse(order.holdReleaseAt)-1);
    assert.equal(store.sellerView(seller.id).user.sellerAvailableBalance,0);
    store.releaseMatureHolds(Date.parse(order.holdReleaseAt)+1);
    assert.equal(store.sellerView(seller.id).user.sellerAvailableBalance,180);
    assert.equal(store.sellerView(seller.id).user.sellerHoldBalance,0);

    const review=store.createReview(buyer.id,order.id,5,'Great');
    assert.equal(review.rating,5);
    assert.throws(()=>store.createReview(buyer.id,order.id,4,'Again'),/уже оставлен/);
    const withdrawal=store.createWithdrawal(seller.id,100);
    store.resolveWithdrawal(admin.id,withdrawal.id,'paid');
    assert.equal(store.sellerView(seller.id).user.sellerAvailableBalance,80);
  }finally{
    process.chdir(previous);
    fs.rmSync(directory,{recursive:true,force:true});
  }
});
