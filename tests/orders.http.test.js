const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const { PrismaClient } = require("@prisma/client");
const { sign } = require("../lib/auth");

if (!process.env.TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) {
  throw new Error("orders.http.test.js must be launched through tests/run-integration.js");
}

const db = new PrismaClient();
global.__earnDb = db;
const handler = require("../api/index");
process.env.CRON_SECRET = "integration-cron-secret-" + Date.now();
const cronHandler = require("../api/cron/expire-orders");
const { expireStaleSubmittedOrders } = require("../lib/order-expiry");

const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const ids = { users: [], businesses: [], campaigns: [], attributions: [], orders: [] };

function response() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(raw) { this.body = raw ? JSON.parse(raw) : undefined; }
  };
}
async function request(method, url, token, body) {
  const req = Readable.from([]);
  req.method = method; req.url = url; req.headers = token ? { authorization: "Bearer " + token } : {};
  req.body = body;
  const res = response();
  await handler(req, res);
  return res;
}
function phone(n) { return "98" + String(10000000 + n).slice(-8); }
async function user(role, n) {
  const u = await db.user.create({data:{phone:phone(n),passwordHash:"test-only",role}});
  ids.users.push(u.id); return u;
}
async function fixture({cap=10, earnerNumber=1}={}) {
  const owner=await user("BUSINESS",100+earnerNumber), earner=await user("EARNER",200+earnerNumber);
  const business=await db.business.create({data:{ownerId:owner.id,name:"HTTP Test "+runId}}); ids.businesses.push(business.id);
  const campaign=await db.campaign.create({data:{businessId:business.id,type:"ORDER",status:"LIVE",title:"Rice "+runId,city:"Test City",rewardPaisa:4200n,commissionBasis:"PER_UNIT",unitLabel:"bag",unitPricePaisa:220000n,businessCommissionPaisa:6000n,earnerShareBps:7000,cap,successRule:"Delivered"}}); ids.campaigns.push(campaign.id);
  const attribution=await db.attribution.create({data:{code:"http-"+runId+"-"+earnerNumber+"-"+Math.random().toString(36).slice(2),campaignId:campaign.id,earnerId:earner.id}}); ids.attributions.push(attribution.id);
  return {owner,earner,business,campaign,attribution,token:sign(earner)};
}
function orderBody(f, suffix, overrides={}) {
  return {idempotencyKey:"idem-"+runId+"-"+suffix,attributionCode:f.attribution.code,customerName:"Buyer "+suffix,customerPhone:phone(500+Number(String(suffix).replace(/\D/g,"").slice(-4)||0)),product:"Rice",quantity:2,...overrides};
}
async function createRewardAtCap(f) {
  const o=await db.order.create({data:{campaignId:f.campaign.id,businessId:f.business.id,earnerId:f.earner.id,attributionCode:f.attribution.code,customerName:"Prior buyer",customerPhoneHash:"prior-"+runId+Math.random(),product:"Rice",quantity:1,idempotencyKey:"prior-"+runId+Math.random()}});
  ids.orders.push(o.id);
  await db.reward.create({data:{orderId:o.id,userId:f.earner.id,amountPaisa:4200n,status:"EARNED"}});
}
test.after(async()=>{
  if(ids.campaigns.length) await db.orderEvent.deleteMany({where:{order:{campaignId:{in:ids.campaigns}}}});
  if(ids.campaigns.length) await db.reward.deleteMany({where:{order:{campaignId:{in:ids.campaigns}}}});
  if(ids.campaigns.length) await db.dispute.deleteMany({where:{order:{campaignId:{in:ids.campaigns}}}});
  if(ids.campaigns.length) await db.payment.deleteMany({where:{order:{campaignId:{in:ids.campaigns}}}});
  if(ids.campaigns.length) await db.order.deleteMany({where:{campaignId:{in:ids.campaigns}}});
  if(ids.attributions.length) await db.attribution.deleteMany({where:{id:{in:ids.attributions}}});
  if(ids.campaigns.length) await db.campaign.deleteMany({where:{id:{in:ids.campaigns}}});
  if(ids.businesses.length) await db.business.deleteMany({where:{id:{in:ids.businesses}}});
  if(ids.users.length) await db.user.deleteMany({where:{id:{in:ids.users}}});
  await db.$disconnect();
});

test("POST /api/orders creates snapshots and one ORDER_SUBMITTED event", async()=>{
  const f=await fixture({earnerNumber:11}); const res=await request("POST","/api/orders",f.token,orderBody(f,"11"));
  assert.equal(res.statusCode,201); ids.orders.push(res.body.id);
  assert.equal(res.body.productSubtotalPaisaSnapshot,"440000");
  assert.equal(res.body.totalCommissionPaisaSnapshot,"12000");
  assert.equal(res.body.merchantSettlementPaisaSnapshot,"428000");
  assert.match(res.body.customerConfirmationPath,/^\/confirm-order\?token=/);
  assert.equal(await db.orderEvent.count({where:{orderId:res.body.id,type:"ORDER_SUBMITTED"}}),1);
});

test("same idempotency key returns same order without duplicate row or event", async()=>{
  const f=await fixture({earnerNumber:12}), body=orderBody(f,"12");
  const a=await request("POST","/api/orders",f.token,body), b=await request("POST","/api/orders",f.token,body);
  ids.orders.push(a.body.id); assert.equal(a.statusCode,201); assert.equal(b.statusCode,200); assert.equal(b.body.id,a.body.id);
  assert.equal(await db.order.count({where:{idempotencyKey:body.idempotencyKey}}),1);
  assert.equal(await db.orderEvent.count({where:{orderId:a.body.id,type:"ORDER_SUBMITTED"}}),1);
});

test("duplicate buyer on same campaign is rejected", async()=>{
  const f=await fixture({earnerNumber:13}), first=orderBody(f,"13",{customerPhone:phone(913)});
  const a=await request("POST","/api/orders",f.token,first); ids.orders.push(a.body.id);
  const b=await request("POST","/api/orders",f.token,{...first,idempotencyKey:first.idempotencyKey+"-2"});
  assert.equal(b.statusCode,409);
});

test("campaign cap exceeded is rejected", async()=>{
  const f=await fixture({cap:1,earnerNumber:14}); await createRewardAtCap(f);
  const res=await request("POST","/api/orders",f.token,orderBody(f,"14")); assert.equal(res.statusCode,409); assert.match(res.body.error,/cap/i);
});

test("two parallel requests competing for last cap slot yield exactly one success", async()=>{
  const f=await fixture({cap:1,earnerNumber:15});
  const [a,b]=await Promise.all([
    request("POST","/api/orders",f.token,orderBody(f,"151",{customerPhone:phone(951)})),
    request("POST","/api/orders",f.token,orderBody(f,"152",{customerPhone:phone(952)}))
  ]);
  const successes=[a,b].filter(x=>x.statusCode===201); const rejected=[a,b].filter(x=>x.statusCode===409);
  for(const x of successes) ids.orders.push(x.body.id);
  assert.equal(successes.length,1); assert.equal(rejected.length,1); assert.match(rejected[0].body.error,/cap/i);
});

test("sale link owned by another earner is rejected", async()=>{
  const f=await fixture({earnerNumber:16}), other=await user("EARNER",316), token=sign(other);
  const res=await request("POST","/api/orders",token,orderBody(f,"16")); assert.equal(res.statusCode,400); assert.match(res.body.error,/attribution/i);
});


test("owning earner can re-issue buyer link and old token is invalidated", async()=>{
  const f=await fixture({earnerNumber:17}), created=await request("POST","/api/orders",f.token,orderBody(f,"17"));
  ids.orders.push(created.body.id);
  const oldPath=created.body.customerConfirmationPath;
  const reissued=await request("POST","/api/orders/"+created.body.id+"/reissue-confirmation",f.token,{});
  assert.equal(reissued.statusCode,200);
  assert.notEqual(reissued.body.customerConfirmationPath,oldPath);
  const oldToken=new URL(oldPath,"http://x").searchParams.get("token");
  const newToken=new URL(reissued.body.customerConfirmationPath,"http://x").searchParams.get("token");
  const oldLookup=await request("GET","/api/customer/order?token="+oldToken,null);
  const newLookup=await request("GET","/api/customer/order?token="+newToken,null);
  assert.equal(oldLookup.statusCode,404);
  assert.equal(newLookup.statusCode,200);
  assert.equal(newLookup.body.id,created.body.id);
  assert.equal(await db.orderEvent.count({where:{orderId:created.body.id,type:"CUSTOMER_LINK_REISSUED"}}),1);
});

test("buyer can reject an unrecognized order before payment and release its cap slot", async()=>{
  const f=await fixture({cap:1,earnerNumber:18}), created=await request("POST","/api/orders",f.token,orderBody(f,"18"));
  ids.orders.push(created.body.id);
  const buyerToken=new URL(created.body.customerConfirmationPath,"http://x").searchParams.get("token");
  const rejected=await request("POST","/api/customer/reject-order",null,{token:buyerToken});
  assert.equal(rejected.statusCode,200); assert.equal(rejected.body.status,"CANCELLED");
  assert.equal(await db.orderEvent.count({where:{orderId:created.body.id,type:"CUSTOMER_REJECTED_ORDER"}}),1);
  const replacement=await request("POST","/api/orders",f.token,orderBody(f,"181",{customerPhone:phone(981)}));
  assert.equal(replacement.statusCode,201); ids.orders.push(replacement.body.id);
});

test("buyer cannot reject after payment is confirmed", async()=>{
  const f=await fixture({earnerNumber:19}), created=await request("POST","/api/orders",f.token,orderBody(f,"19"));
  ids.orders.push(created.body.id);
  const buyerToken=new URL(created.body.customerConfirmationPath,"http://x").searchParams.get("token");
  await db.order.update({where:{id:created.body.id},data:{status:"PAID",paymentConfirmedAt:new Date()}});
  const rejected=await request("POST","/api/customer/reject-order",null,{token:buyerToken});
  assert.equal(rejected.statusCode,409);
});

test("buyer rejection with submitted payment reference opens dispute and refund path", async()=>{
  const f=await fixture({earnerNumber:20}), created=await request("POST","/api/orders",f.token,orderBody(f,"20"));
  ids.orders.push(created.body.id);
  const buyerToken=new URL(created.body.customerConfirmationPath,"http://x").searchParams.get("token");
  await db.order.update({where:{id:created.body.id},data:{status:"PAYMENT_PENDING"}});
  await db.payment.create({data:{orderId:created.body.id,amountPaisa:440000n,method:"BANK",reference:"REF-"+runId,status:"SUBMITTED",submittedAt:new Date()}});
  const rejected=await request("POST","/api/customer/reject-order",null,{token:buyerToken});
  assert.equal(rejected.statusCode,200); assert.equal(rejected.body.status,"DISPUTED");
  const payment=await db.payment.findUnique({where:{orderId:created.body.id}});
  assert.equal(payment.status,"REFUND_PENDING"); assert.equal(payment.refundedPaisa,440000n);
  assert.equal(await db.dispute.count({where:{orderId:created.body.id,status:"OPEN"}}),1);
  assert.equal(await db.orderEvent.count({where:{orderId:created.body.id,type:"CUSTOMER_REJECTED_ORDER"}}),1);
});

test("real DB expiry cancels only SUBMITTED orders older than 24 hours and records ORDER_EXPIRED", async()=>{
  const f=await fixture({cap:2,earnerNumber:21});
  const old=await db.order.create({data:{campaignId:f.campaign.id,businessId:f.business.id,earnerId:f.earner.id,attributionCode:f.attribution.code,customerName:"Old buyer",customerPhoneHash:"old-"+runId,product:"Rice",quantity:1,idempotencyKey:"old-"+runId,createdAt:new Date(Date.now()-25*60*60*1000)}});
  const fresh=await db.order.create({data:{campaignId:f.campaign.id,businessId:f.business.id,earnerId:f.earner.id,attributionCode:f.attribution.code,customerName:"Fresh buyer",customerPhoneHash:"fresh-"+runId,product:"Rice",quantity:1,idempotencyKey:"fresh-"+runId,createdAt:new Date(Date.now()-23*60*60*1000)}});
  ids.orders.push(old.id,fresh.id);
  const result=await expireStaleSubmittedOrders(db,{now:new Date(),hours:24});
  assert.ok(result.expired>=1);
  assert.equal((await db.order.findUnique({where:{id:old.id}})).status,"CANCELLED");
  assert.equal((await db.order.findUnique({where:{id:fresh.id}})).status,"SUBMITTED");
  assert.equal(await db.orderEvent.count({where:{orderId:old.id,type:"ORDER_EXPIRED"}}),1);
});

test("cron GET rejects missing and wrong secrets", async()=>{
  for(const authorization of [undefined,"Bearer wrong-secret"]){
    const req=Readable.from([]); req.method="GET"; req.url="/api/cron/expire-orders"; req.headers={};
    if(authorization)req.headers.authorization=authorization;
    const res=response(); await cronHandler(req,res); assert.equal(res.statusCode,401);
  }
});

test("cron GET with CRON_SECRET returns expired count", async()=>{
  const f=await fixture({earnerNumber:22});
  const old=await db.order.create({data:{campaignId:f.campaign.id,businessId:f.business.id,earnerId:f.earner.id,attributionCode:f.attribution.code,customerName:"Cron buyer",customerPhoneHash:"cron-"+runId,product:"Rice",quantity:1,idempotencyKey:"cron-"+runId,createdAt:new Date(Date.now()-25*60*60*1000)}});
  ids.orders.push(old.id);
  const req=Readable.from([]); req.method="GET"; req.url="/api/cron/expire-orders"; req.headers={authorization:"Bearer "+process.env.CRON_SECRET};
  const res=response(); await cronHandler(req,res);
  assert.equal(res.statusCode,200); assert.equal(typeof res.body.expired,"number"); assert.ok(res.body.expired>=1);
  assert.equal((await db.order.findUnique({where:{id:old.id}})).status,"CANCELLED");
});


test("buyer payment instructions appear only while PAYMENT_PENDING", async()=>{
  const previous={
    accountName:process.env.EARN_PAYMENT_ACCOUNT_NAME,
    referenceFormat:process.env.EARN_PAYMENT_REFERENCE_FORMAT,
    bankName:process.env.EARN_PAYMENT_BANK_NAME,
    bankAccount:process.env.EARN_PAYMENT_BANK_ACCOUNT,
    esewa:process.env.EARN_PAYMENT_ESEWA_ID,
    khalti:process.env.EARN_PAYMENT_KHALTI_ID,
    qr:process.env.EARN_PAYMENT_QR_IMAGE_URL
  };
  Object.assign(process.env,{
    EARN_PAYMENT_ACCOUNT_NAME:"EARN Test Account",
    EARN_PAYMENT_REFERENCE_FORMAT:"TEST-ORDER-REFERENCE",
    EARN_PAYMENT_BANK_NAME:"Test Bank",
    EARN_PAYMENT_BANK_ACCOUNT:"TEST-ACCOUNT-ONLY",
    EARN_PAYMENT_ESEWA_ID:"9800000000",
    EARN_PAYMENT_KHALTI_ID:"9800000001",
    EARN_PAYMENT_QR_IMAGE_URL:"https://example.test/earn-qr.png"
  });
  try{
    const f=await fixture({earnerNumber:23}), created=await request("POST","/api/orders",f.token,orderBody(f,"23"));
    ids.orders.push(created.body.id);
    const buyerToken=new URL(created.body.customerConfirmationPath,"http://x").searchParams.get("token");
    const submitted=await request("GET","/api/customer/order?token="+buyerToken,null);
    assert.equal(submitted.statusCode,200);
    assert.equal(Object.hasOwn(submitted.body,"paymentInstructions"),false);

    await db.order.update({where:{id:created.body.id},data:{status:"PAYMENT_PENDING",deliveryFeePaisa:10000n}});
    await db.payment.create({data:{orderId:created.body.id,amountPaisa:450000n,method:"BANK_OR_QR",status:"PENDING"}});
    const pending=await request("GET","/api/customer/order?token="+buyerToken,null);
    assert.equal(pending.statusCode,200);
    assert.deepEqual(pending.body.paymentInstructions,{
      accountName:"EARN Test Account",
      referenceFormat:"TEST-ORDER-REFERENCE",
      bank:{name:"Test Bank",account:"TEST-ACCOUNT-ONLY"},
      eSewa:{id:"9800000000"},
      khalti:{id:"9800000001"},
      qrImageUrl:"https://example.test/earn-qr.png"
    });

    await db.order.update({where:{id:created.body.id},data:{status:"PAID"}});
    const paid=await request("GET","/api/customer/order?token="+buyerToken,null);
    assert.equal(paid.statusCode,200);
    assert.equal(Object.hasOwn(paid.body,"paymentInstructions"),false);
  }finally{
    const restore=(name,value)=>value===undefined?delete process.env[name]:process.env[name]=value;
    restore("EARN_PAYMENT_ACCOUNT_NAME",previous.accountName);
    restore("EARN_PAYMENT_REFERENCE_FORMAT",previous.referenceFormat);
    restore("EARN_PAYMENT_BANK_NAME",previous.bankName);
    restore("EARN_PAYMENT_BANK_ACCOUNT",previous.bankAccount);
    restore("EARN_PAYMENT_ESEWA_ID",previous.esewa);
    restore("EARN_PAYMENT_KHALTI_ID",previous.khalti);
    restore("EARN_PAYMENT_QR_IMAGE_URL",previous.qr);
  }
});
