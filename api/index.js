const {PrismaClient}=require("@prisma/client");
const bcrypt=require("bcryptjs");
const crypto=require("crypto");
const {sign,requireAuth,requireRole}=require("../lib/auth");
const {assertTransition,commissionQuote,rewardForDelivery}=require("../lib/domain");
const db=global.__earnDb||new PrismaClient();
if(process.env.NODE_ENV!=="production")global.__earnDb=db;

const json=(res,status,data)=>{res.statusCode=status;res.setHeader("content-type","application/json");res.end(JSON.stringify(data,(_,v)=>typeof v==="bigint"?v.toString():v))};
const body=async req=>{if(req.body)return req.body;let s="";for await(const c of req)s+=c;if(s.length>1e6)throw Object.assign(new Error("Payload too large"),{status:413});return s?JSON.parse(s):{}};
const url=req=>new URL(req.url,"http://x");
const path=req=>url(req).pathname.replace(/^\/api/,"");
const cleanPhone=p=>String(p||"").replace(/\D/g,"");
const validPhone=p=>/^9779[678]\d{8}$/.test(p)||/^9[678]\d{8}$/.test(p);
const hashPhone=p=>crypto.createHash("sha256").update(cleanPhone(p)).digest("hex");
const text=(v,min,max)=>typeof v==="string"&&v.trim().length>=min&&v.trim().length<=max;
const hashSecret=v=>crypto.createHash("sha256").update(String(v)).digest("hex");
const publicUser=u=>({id:u.id,phone:u.phone,role:u.role,displayName:u.earner?.displayName||null,business:u.business?{id:u.business.id,name:u.business.name,verified:u.business.verified}:null});

module.exports=async(req,res)=>{try{
 const p=path(req),m=req.method;

 if(m==="POST"&&p==="/auth/signup"){
  const b=await body(req),phone=cleanPhone(b.phone),role=String(b.role||"").toUpperCase();
  if(!validPhone(phone))return json(res,400,{error:"Enter a valid Nepal mobile number"});
  if(!["EARNER","BUSINESS"].includes(role))return json(res,400,{error:"Choose earner or business"});
  if(!text(b.password,8,72))return json(res,400,{error:"Password must be 8–72 characters"});
  if(role==="EARNER"&&!text(b.displayName,2,60))return json(res,400,{error:"Your name is required"});
  if(role==="BUSINESS"&&!text(b.businessName,2,80))return json(res,400,{error:"Business name is required"});
  const exists=await db.user.findUnique({where:{phone}});
  if(exists)return json(res,409,{error:"An account already exists for this phone"});
  const passwordHash=await bcrypt.hash(b.password,12);
  const user=await db.$transaction(async tx=>{
   const u=await tx.user.create({data:{phone,passwordHash,role}});
   if(role==="EARNER")await tx.earnerProfile.create({data:{userId:u.id,displayName:b.displayName.trim()}});
   else await tx.business.create({data:{ownerId:u.id,name:b.businessName.trim(),verified:false}});
   return tx.user.findUnique({where:{id:u.id},include:{earner:true,business:true}});
  });
  return json(res,201,{token:sign(user),role:user.role,user:publicUser(user)});
 }

 if(m==="POST"&&p==="/auth/login"){
  const b=await body(req),phone=cleanPhone(b.phone),u=await db.user.findUnique({where:{phone},include:{earner:true,business:true}});
  if(!u||!await bcrypt.compare(b.password||"",u.passwordHash))return json(res,401,{error:"Invalid phone or password"});
  return json(res,200,{token:sign(u),role:u.role,user:publicUser(u)});
 }

 if(m==="GET"&&p==="/campaigns"){
  const rows=await db.campaign.findMany({where:{status:"LIVE"},include:{business:{select:{name:true,verified:true}}},orderBy:{createdAt:"desc"}});
  return json(res,200,rows);
 }

 // Customer endpoints are intentionally public but protected by a high-entropy order token.
 if(m==="GET"&&p==="/customer/order"){
  const t=url(req).searchParams.get("token")||"";
  if(!text(t,20,200))return json(res,400,{error:"Invalid order token"});
  const o=await db.order.findUnique({where:{customerConfirmTokenHash:hashSecret(t)},include:{campaign:{select:{title:true,unitLabel:true}},business:{select:{name:true}},payment:true,logistics:true}});
  if(!o)return json(res,404,{error:"Order not found"});
  return json(res,200,{id:o.id,status:o.status,customerName:o.customerName,product:o.product,quantity:o.quantity,acceptedQuantity:o.acceptedQuantity,deliveredQuantity:o.deliveredQuantity,unitPricePaisa:o.unitPricePaisaSnapshot,productSubtotalPaisa:o.productSubtotalPaisaSnapshot,deliveryFeePaisa:o.deliveryFeePaisa,campaign:o.campaign,business:o.business,payment:o.payment?{status:o.payment.status,amountPaisa:o.payment.amountPaisa,method:o.payment.method}:null});
 }
 if(m==="POST"&&p==="/customer/confirm-order"){
  const b=await body(req),t=String(b.token||"");
  if(!text(t,20,200))return json(res,400,{error:"Invalid order token"});
  const o=await db.order.findUnique({where:{customerConfirmTokenHash:hashSecret(t)}});
  if(!o)return json(res,404,{error:"Order not found"});
  if(o.status!=="SUBMITTED"&&o.status!=="CUSTOMER_CONFIRMED")return json(res,409,{error:"Order can no longer be confirmed"});
  if(o.status==="CUSTOMER_CONFIRMED")return json(res,200,{id:o.id,status:o.status});
  const pin=String(crypto.randomInt(100000,1000000));
  const x=await db.order.update({where:{id:o.id},data:{status:"CUSTOMER_CONFIRMED",customerConfirmedAt:new Date(),deliveryPinHash:hashSecret(pin)}});
  await db.orderEvent.create({data:{orderId:o.id,type:"CUSTOMER_CONFIRMED",actorRole:"CUSTOMER"}});
  return json(res,200,{id:x.id,status:x.status,deliveryPin:pin});
 }
 if(m==="POST"&&p==="/customer/payment"){
  const b=await body(req),t=String(b.token||"");
  if(!text(t,20,200)||!text(b.reference,3,120)||!text(b.method,2,40))return json(res,400,{error:"Payment method and reference are required"});
  const o=await db.order.findUnique({where:{customerConfirmTokenHash:hashSecret(t)},include:{payment:true}});
  if(!o)return json(res,404,{error:"Order not found"});
  if(!["PAYMENT_PENDING","ACCEPTED"].includes(o.status)||!o.payment)return json(res,409,{error:"This order is not awaiting payment"});
  const pay=await db.payment.update({where:{orderId:o.id},data:{status:"SUBMITTED",method:b.method.trim(),reference:b.reference.trim(),submittedAt:new Date()}});
  await db.orderEvent.create({data:{orderId:o.id,type:"PAYMENT_SUBMITTED",actorRole:"CUSTOMER",metadata:{method:b.method.trim()}}});
  return json(res,200,pay);
 }
 if(m==="POST"&&p==="/customer/verify-delivery"){
  const b=await body(req),t=String(b.token||""),qty=Number(b.quantity),pin=String(b.deliveryPin||"");
  if(!text(t,20,200)||!Number.isInteger(qty)||qty<0||!/^[0-9]{6}$/.test(pin))return json(res,400,{error:"Quantity and 6-digit delivery PIN are required"});
  const result=await db.$transaction(async tx=>{
   const o=await tx.order.findUnique({where:{customerConfirmTokenHash:hashSecret(t)},include:{campaign:true,payment:true,logistics:true}});
   if(!o)throw Object.assign(new Error("Order not found"),{status:404});
   if(!["DELIVERED","OUT_FOR_DELIVERY"].includes(o.status))throw Object.assign(new Error("Order is not ready for delivery verification"),{status:409});
   if(hashSecret(pin)!==o.deliveryPinHash)throw Object.assign(new Error("Incorrect delivery PIN"),{status:409});
   if(qty>(o.pickedUpQuantity??o.acceptedQuantity??o.quantity))throw Object.assign(new Error("Verified quantity exceeds picked-up quantity"),{status:409});
   const unit=BigInt(o.unitPricePaisaSnapshot||0),sale=unit*BigInt(qty);
   let totalCommission;
   if(o.commissionBasisSnapshot==="PER_UNIT")totalCommission=BigInt(o.businessCommissionPaisaSnapshot||0)*BigInt(qty);
   else if(o.commissionBasisSnapshot==="PERCENT_GMV")totalCommission=(sale*BigInt(o.businessCommissionBpsSnapshot||0)+5000n)/10000n;
   else totalCommission=qty>0?BigInt(o.totalCommissionPaisaSnapshot||0):0n;
   const share=BigInt(o.earnerShareBpsSnapshot||10000),earner=(totalCommission*share+5000n)/10000n,commissionPlatform=totalCommission-earner,merchant=sale-totalCommission;
   const picked=o.pickedUpQuantity??o.acceptedQuantity??o.quantity,returned=Math.max(0,picked-qty),next=qty===picked?"VERIFIED":"PARTIALLY_DELIVERED",logisticsMargin=o.logistics?o.logistics.quotedFeePaisa-o.logistics.transporterCostPaisa:0n,platform=commissionPlatform+logisticsMargin,settleStatus=returned>0?"HELD":"PAYABLE",refund=unit*BigInt(returned);
   await tx.order.update({where:{id:o.id},data:{status:next,deliveredQuantity:qty,returnedQuantity:returned,verifiedAt:new Date(),deliveryVerifiedAt:new Date(),earnerRewardPaisaSnapshot:earner,platformFeePaisaSnapshot:platform,merchantSettlementPaisaSnapshot:merchant}});
   await tx.reward.upsert({where:{orderId:o.id},create:{orderId:o.id,userId:o.earnerId,amountPaisa:earner,status:"EARNED"},update:{amountPaisa:earner,status:"EARNED"}});
   await tx.ledgerEntry.upsert({where:{idempotencyKey:"reward:order:"+o.id},create:{userId:o.earnerId,kind:"REWARD_EARNED",amountPaisa:earner,referenceType:"ORDER",referenceId:o.id,idempotencyKey:"reward:order:"+o.id},update:{amountPaisa:earner}});
   await tx.settlement.upsert({where:{orderId_partyType:{orderId:o.id,partyType:"MERCHANT"}},create:{orderId:o.id,partyType:"MERCHANT",partyId:o.businessId,amountPaisa:merchant,status:settleStatus},update:{amountPaisa:merchant,status:settleStatus}});
   await tx.settlement.upsert({where:{orderId_partyType:{orderId:o.id,partyType:"EARNER"}},create:{orderId:o.id,partyType:"EARNER",partyId:o.earnerId,amountPaisa:earner,status:settleStatus},update:{amountPaisa:earner,status:settleStatus}});
   await tx.settlement.upsert({where:{orderId_partyType:{orderId:o.id,partyType:"PLATFORM"}},create:{orderId:o.id,partyType:"PLATFORM",amountPaisa:platform,status:settleStatus},update:{amountPaisa:platform,status:settleStatus}});
   if(o.logistics)await tx.settlement.upsert({where:{orderId_partyType:{orderId:o.id,partyType:"TRANSPORTER"}},create:{orderId:o.id,partyType:"TRANSPORTER",amountPaisa:o.logistics.transporterCostPaisa,status:settleStatus},update:{amountPaisa:o.logistics.transporterCostPaisa,status:settleStatus}});
   if(refund>0n&&o.payment)await tx.payment.update({where:{orderId:o.id},data:{status:"REFUND_PENDING",refundedPaisa:refund}});
   await tx.orderEvent.create({data:{orderId:o.id,type:next,actorRole:"CUSTOMER",metadata:{verifiedQuantity:qty,returnedQuantity:returned,refundPaisa:refund.toString()}}});
   return tx.order.findUnique({where:{id:o.id},include:{reward:true,settlements:true}});
  });
  return json(res,200,result);
 }

 const session=requireAuth(req);

 if(m==="GET"&&p==="/me"){
  const u=await db.user.findUnique({where:{id:session.sub},include:{earner:true,business:true}});
  if(!u)return json(res,404,{error:"Account not found"});
  return json(res,200,publicUser(u));
 }

 if(m==="POST"&&p==="/campaigns"){
  requireRole(session,"BUSINESS");
  const b=await body(req),biz=await db.business.findUnique({where:{ownerId:session.sub}});
  if(!biz)return json(res,409,{error:"Business profile required"});
  if(!["ORDER","LEAD","CONTENT","REFERRAL"].includes(b.type))return json(res,400,{error:"Invalid campaign type"});
  if(!text(b.title,3,100)||!text(b.city,2,80)||!text(b.successRule,5,1000))return json(res,400,{error:"Complete the campaign details"});
  const reward=Number(b.rewardNpr),cap=Number(b.cap);
  if(!Number.isInteger(cap)||cap<1)return json(res,400,{error:"Cap must be positive"});
  let commercial={commissionBasis:"FIXED_ORDER",businessCommissionPaisa:null,businessCommissionBps:null,unitPricePaisa:null,unitLabel:null,earnerShareBps:10000};
  let rewardPaisa;
  if(b.type==="ORDER"){
   if(!Object.prototype.hasOwnProperty.call(b,"commissionBasis")||!text(String(b.commissionBasis||""),3,30))return json(res,400,{error:"ORDER campaigns require commission terms. Refresh the app and try again."});
   if(!Object.prototype.hasOwnProperty.call(b,"earnerSharePercent"))return json(res,400,{error:"ORDER campaigns require an earner share."});
   const basis=String(b.commissionBasis),unitPrice=Number(b.unitPriceNpr),businessCommission=Number(b.businessCommissionNpr),businessPercent=Number(b.businessCommissionPercent),earnerPercent=Number(b.earnerSharePercent);
   if(!["FIXED_ORDER","PER_UNIT","PERCENT_GMV"].includes(basis))return json(res,400,{error:"Choose a valid commission structure"});
   if(!Number.isFinite(earnerPercent)||earnerPercent<=0||earnerPercent>100)return json(res,400,{error:"Earner share must be between 0 and 100%"});
   if((basis==="PER_UNIT"||basis==="PERCENT_GMV")&&(!Number.isFinite(unitPrice)||unitPrice<=0))return json(res,400,{error:"Enter the product price"});
   if(basis==="PERCENT_GMV"&&(!Number.isFinite(businessPercent)||businessPercent<=0||businessPercent>100))return json(res,400,{error:"Enter a valid commission percentage"});
   if(basis!=="PERCENT_GMV"&&(!Number.isFinite(businessCommission)||businessCommission<=0))return json(res,400,{error:"Enter what the business will pay"});
   commercial={commissionBasis:basis,unitLabel:text(b.unitLabel,1,30)?b.unitLabel.trim():null,unitPricePaisa:Number.isFinite(unitPrice)&&unitPrice>0?BigInt(Math.round(unitPrice*100)):null,businessCommissionPaisa:basis!=="PERCENT_GMV"?BigInt(Math.round(businessCommission*100)):null,businessCommissionBps:basis==="PERCENT_GMV"?Math.round(businessPercent*100):null,earnerShareBps:Math.round(earnerPercent*100)};
   const preview=commissionQuote(commercial,1); rewardPaisa=preview.earnerRewardPaisa;
  }else{
   if(!Number.isFinite(reward)||reward<=0)return json(res,400,{error:"Reward must be positive"});
   rewardPaisa=BigInt(Math.round(reward*100));
  }
  const row=await db.campaign.create({data:{businessId:biz.id,type:b.type,title:b.title.trim(),city:b.city.trim(),rewardPaisa,cap,successRule:b.successRule.trim(),status:"DRAFT",...commercial}});
  return json(res,201,row);
 }

 const pub=p.match(/^\/campaigns\/([^/]+)\/publish$/);
 if(m==="POST"&&pub){
  requireRole(session,"BUSINESS","ADMIN");
  const c=await db.campaign.findUnique({where:{id:pub[1]},include:{business:true}});
  if(!c)return json(res,404,{error:"Campaign not found"});
  if(session.role!=="ADMIN"&&c.business.ownerId!==session.sub)return json(res,403,{error:"Forbidden"});
  if(c.type==="ORDER"){
   const legacy=c.commissionBasis==="FIXED_ORDER"&&c.businessCommissionPaisa==null&&c.businessCommissionBps==null;
   const missingSplit=!Number.isInteger(c.earnerShareBps)||c.earnerShareBps<=0||c.earnerShareBps>10000;
   const missingTerms=c.commissionBasis==="PER_UNIT"&&(!c.unitPricePaisa||!c.unitLabel||!c.businessCommissionPaisa)||c.commissionBasis==="PERCENT_GMV"&&(!c.unitPricePaisa||!c.unitLabel||!c.businessCommissionBps)||c.commissionBasis==="FIXED_ORDER"&&!c.businessCommissionPaisa;
   if(legacy||missingSplit||missingTerms)return json(res,409,{error:"This ORDER campaign has incomplete commission terms and cannot be published."});
  }
  return json(res,200,await db.campaign.update({where:{id:c.id},data:{status:"LIVE"}}));
 }

 const ctl=p.match(/^\/campaigns\/([^/]+)\/(pause|resume|close)$/);
 if(m==="POST"&&ctl){
  requireRole(session,"BUSINESS","ADMIN");
  const c=await db.campaign.findUnique({where:{id:ctl[1]},include:{business:true}});
  if(!c)return json(res,404,{error:"Campaign not found"});
  if(session.role!=="ADMIN"&&c.business.ownerId!==session.sub)return json(res,403,{error:"Forbidden"});
  const next={pause:"PAUSED",resume:"LIVE",close:"CLOSED"}[ctl[2]];
  if(c.status==="CLOSED")return json(res,409,{error:"Closed campaigns cannot be reopened"});
  if(ctl[2]==="resume"&&c.status!=="PAUSED")return json(res,409,{error:"Only paused campaigns can resume"});
  return json(res,200,await db.campaign.update({where:{id:c.id},data:{status:next}}));
 }

 const start=p.match(/^\/campaigns\/([^/]+)\/start$/);
 if(m==="POST"&&start){
  requireRole(session,"EARNER");
  const c=await db.campaign.findFirst({where:{id:start[1],status:"LIVE"}});
  if(!c)return json(res,404,{error:"Live campaign not found"});
  const code=crypto.randomBytes(5).toString("hex");
  const a=await db.attribution.upsert({where:{campaignId_earnerId:{campaignId:c.id,earnerId:session.sub}},create:{campaignId:c.id,earnerId:session.sub,code},update:{}});
  return json(res,200,a);
 }

 if(m==="POST"&&p==="/orders"){
  requireRole(session,"EARNER"); const b=await body(req);
  if(!b.idempotencyKey)return json(res,400,{error:"idempotencyKey required"});
  if(!text(b.customerName,2,80)||!validPhone(cleanPhone(b.customerPhone))||!text(b.product,2,120)||!Number.isInteger(Number(b.quantity))||Number(b.quantity)<1)return json(res,400,{error:"Enter valid order details"});
  const existing=await db.order.findUnique({where:{idempotencyKey:b.idempotencyKey}}); if(existing)return json(res,200,existing);
  const a=await db.attribution.findUnique({where:{code:b.attributionCode}}); if(!a||a.earnerId!==session.sub)return json(res,400,{error:"Invalid attribution"});
  const c=await db.campaign.findFirst({where:{id:a.campaignId,status:"LIVE",type:"ORDER"}}); if(!c)return json(res,409,{error:"Order campaign unavailable"});
  const phoneHash=hashPhone(b.customerPhone),quantity=Number(b.quantity),quote=commissionQuote(c,quantity),subtotal=BigInt(c.unitPricePaisa||0)*BigInt(quantity);
  const confirmToken=crypto.randomBytes(24).toString("hex");
  try {
   const o=await db.$transaction(async tx=>{
    // Lock this campaign row so cap checks and inserts for the same campaign serialize.
    await tx.$queryRawUnsafe('SELECT id FROM "Campaign" WHERE id = $1 FOR UPDATE',c.id);
    const duplicate=await tx.order.findFirst({where:{campaignId:c.id,customerPhoneHash:phoneHash,status:{notIn:["CANCELLED","RETURNED"]}}});
    if(duplicate){const err=new Error("DUPLICATE_BUYER");err.code="DUPLICATE_BUYER";throw err}
    // The removed handler counted EARNED/PAYABLE/PAID rewards against the cap.
    // Reserve capacity earlier as well: every non-cancelled/non-returned order consumes
    // one slot. Without this reservation, two new orders could both pass a reward-only
    // count before either has reached reward creation.
    const reserved=await tx.order.count({where:{campaignId:c.id,status:{notIn:["CANCELLED","RETURNED"]}}});
    if(reserved>=c.cap){const err=new Error("CAMPAIGN_CAP");err.code="CAMPAIGN_CAP";throw err}
    const order=await tx.order.create({data:{campaignId:c.id,businessId:c.businessId,earnerId:session.sub,attributionCode:a.code,customerName:b.customerName.trim(),customerPhoneHash:phoneHash,customerConfirmTokenHash:hashSecret(confirmToken),product:b.product.trim(),quantity,idempotencyKey:b.idempotencyKey,unitPricePaisaSnapshot:c.unitPricePaisa,commissionBasisSnapshot:c.commissionBasis,businessCommissionPaisaSnapshot:c.businessCommissionPaisa,businessCommissionBpsSnapshot:c.businessCommissionBps,earnerShareBpsSnapshot:c.earnerShareBps,earnerRewardPaisaSnapshot:quote.earnerRewardPaisa,platformFeePaisaSnapshot:quote.platformFeePaisa,productSubtotalPaisaSnapshot:subtotal,totalCommissionPaisaSnapshot:quote.totalCommissionPaisa,merchantSettlementPaisaSnapshot:subtotal-quote.totalCommissionPaisa}});
    await tx.orderEvent.create({data:{orderId:order.id,type:"ORDER_SUBMITTED",actorRole:"EARNER",actorId:session.sub}});
    return order;
   });
   return json(res,201,{...o,customerConfirmationPath:"/confirm-order?token="+confirmToken});
  } catch(err) {
   if(err.code==="DUPLICATE_BUYER")return json(res,409,{error:"This customer already has an active or completed order"});
   if(err.code==="CAMPAIGN_CAP")return json(res,409,{error:"Campaign reward cap reached"});
   throw err;
  }
 }

 const action=p.match(/^\/orders\/([^/]+)\/(accept|ready|cancel)$/);
 if(m==="POST"&&action){
  requireRole(session,"BUSINESS","ADMIN"); const b=await body(req);
  const o=await db.order.findUnique({where:{id:action[1]},include:{business:true}});
  if(!o)return json(res,404,{error:"Order not found"}); if(session.role!=="ADMIN"&&o.business.ownerId!==session.sub)return json(res,403,{error:"Forbidden"});
  if(action[2]==="accept"){
   if(o.status!=="CUSTOMER_CONFIRMED")return json(res,409,{error:"Customer must confirm first"});
   const qty=Number(b.quantity||o.quantity); if(!Number.isInteger(qty)||qty<1||qty>o.quantity)return json(res,400,{error:"Invalid accepted quantity"});
   const x=await db.$transaction(async tx=>{const z=await tx.order.update({where:{id:o.id},data:{status:"ACCEPTED",acceptedQuantity:qty,acceptedAt:new Date()}});await tx.orderEvent.create({data:{orderId:o.id,type:"BUSINESS_ACCEPTED",actorRole:session.role,actorId:session.sub,metadata:{acceptedQuantity:qty}}});return z}); return json(res,200,x);
  }
  if(action[2]==="ready"){
   if(o.status!=="PAID")return json(res,409,{error:"Payment must be confirmed first"});
   const x=await db.order.update({where:{id:o.id},data:{status:"READY_FOR_PICKUP",readyForPickupAt:new Date()}});await db.orderEvent.create({data:{orderId:o.id,type:"READY_FOR_PICKUP",actorRole:session.role,actorId:session.sub}});return json(res,200,x);
  }
  if(["PICKED_UP","OUT_FOR_DELIVERY","DELIVERED","VERIFIED","PARTIALLY_DELIVERED"].includes(o.status))return json(res,409,{error:"After pickup this order must be reconciled, not cancelled"});
  if(!text(b.reason,3,300))return json(res,400,{error:"Cancellation reason is required"});
  const x=await db.$transaction(async tx=>{const z=await tx.order.update({where:{id:o.id},data:{status:"CANCELLED",cancelledAt:new Date(),cancelReason:b.reason.trim()}});const pay=await tx.payment.findUnique({where:{orderId:o.id}});if(pay?.status==="CONFIRMED")await tx.payment.update({where:{orderId:o.id},data:{status:"REFUND_PENDING",refundedPaisa:pay.amountPaisa}});await tx.orderEvent.create({data:{orderId:o.id,type:"CANCELLED",actorRole:session.role,actorId:session.sub,metadata:{reason:b.reason.trim()}}});return z});return json(res,200,x);
 }

 const payConfirm=p.match(/^\/orders\/([^/]+)\/confirm-payment$/);
 if(m==="POST"&&payConfirm){requireRole(session,"ADMIN");const o=await db.order.findUnique({where:{id:payConfirm[1]},include:{payment:true}});if(!o||!o.payment)return json(res,404,{error:"Payment not found"});if(o.payment.status!=="SUBMITTED")return json(res,409,{error:"Customer payment reference has not been submitted"});const x=await db.$transaction(async tx=>{await tx.payment.update({where:{orderId:o.id},data:{status:"CONFIRMED",confirmedAt:new Date()}});const z=await tx.order.update({where:{id:o.id},data:{status:"PAID",paymentConfirmedAt:new Date()}});await tx.orderEvent.create({data:{orderId:o.id,type:"PAYMENT_CONFIRMED",actorRole:"ADMIN",actorId:session.sub}});return z});return json(res,200,x)}

 const assign=p.match(/^\/orders\/([^/]+)\/assign-logistics$/);
 if(m==="POST"&&assign){requireRole(session,"ADMIN");const b=await body(req),o=await db.order.findUnique({where:{id:assign[1]}});if(!o||o.status!=="ACCEPTED")return json(res,409,{error:"Business must accept the order before logistics is quoted"});if(!text(b.transporterName,2,100))return json(res,400,{error:"Transporter name required"});const quoted=BigInt(Math.round(Number(b.quotedFeeNpr||0)*100)),cost=BigInt(Math.round(Number(b.transporterCostNpr||0)*100));if(quoted<0n||cost<0n||cost>quoted)return json(res,400,{error:"Enter valid logistics quote and transporter cost"});const code=String(crypto.randomInt(100000,1000000)),amount=BigInt(o.unitPricePaisaSnapshot||0)*BigInt(o.acceptedQuantity||o.quantity)+quoted;const result=await db.$transaction(async tx=>{const l=await tx.logisticsAssignment.upsert({where:{orderId:o.id},create:{orderId:o.id,transporterName:b.transporterName.trim(),transporterPhone:b.transporterPhone||null,quotedFeePaisa:quoted,transporterCostPaisa:cost,pickupCodeHash:hashSecret(code)},update:{transporterName:b.transporterName.trim(),transporterPhone:b.transporterPhone||null,quotedFeePaisa:quoted,transporterCostPaisa:cost,pickupCodeHash:hashSecret(code)}});await tx.payment.upsert({where:{orderId:o.id},create:{orderId:o.id,amountPaisa:amount,method:"BANK_OR_QR"},update:{amountPaisa:amount,status:"PENDING"}});await tx.order.update({where:{id:o.id},data:{status:"PAYMENT_PENDING",deliveryFeePaisa:quoted}});await tx.orderEvent.create({data:{orderId:o.id,type:"LOGISTICS_QUOTED",actorRole:"ADMIN",actorId:session.sub,metadata:{quotedFeePaisa:quoted.toString(),transporterCostPaisa:cost.toString()}}});return l});return json(res,200,{...result,pickupCode:code,paymentAmountPaisa:amount})}

 const pickup=p.match(/^\/orders\/([^/]+)\/pickup$/);
 if(m==="POST"&&pickup){requireRole(session,"ADMIN");const b=await body(req),o=await db.order.findUnique({where:{id:pickup[1]},include:{logistics:true}});if(!o||o.status!=="READY_FOR_PICKUP"||!o.logistics)return json(res,409,{error:"Logistics must be assigned"});if(hashSecret(String(b.pickupCode||""))!==o.logistics.pickupCodeHash)return json(res,409,{error:"Incorrect pickup code"});const qty=Number(b.quantity);if(!Number.isInteger(qty)||qty<1||qty>(o.acceptedQuantity||o.quantity))return json(res,400,{error:"Invalid pickup quantity"});const x=await db.$transaction(async tx=>{await tx.logisticsAssignment.update({where:{orderId:o.id},data:{status:"PICKED_UP",pickedUpAt:new Date()}});const z=await tx.order.update({where:{id:o.id},data:{status:"PICKED_UP",pickedUpQuantity:qty,pickedUpAt:new Date()}});await tx.orderEvent.create({data:{orderId:o.id,type:"PICKED_UP",actorRole:"ADMIN",actorId:session.sub,metadata:{quantity:qty}}});return z});return json(res,200,x)}

 const out=p.match(/^\/orders\/([^/]+)\/out-for-delivery$/);
 if(m==="POST"&&out){requireRole(session,"ADMIN");const o=await db.order.findUnique({where:{id:out[1]}});if(!o||o.status!=="PICKED_UP")return json(res,409,{error:"Order must be picked up"});await db.logisticsAssignment.update({where:{orderId:o.id},data:{status:"OUT_FOR_DELIVERY"}});return json(res,200,await db.order.update({where:{id:o.id},data:{status:"OUT_FOR_DELIVERY"}}))}

 const delivered=p.match(/^\/orders\/([^/]+)\/delivered$/);
 if(m==="POST"&&delivered){requireRole(session,"ADMIN");const o=await db.order.findUnique({where:{id:delivered[1]}});if(!o||!["PICKED_UP","OUT_FOR_DELIVERY"].includes(o.status))return json(res,409,{error:"Order is not in delivery"});await db.logisticsAssignment.update({where:{orderId:o.id},data:{status:"DELIVERED",deliveredAt:new Date()}});const x=await db.order.update({where:{id:o.id},data:{status:"DELIVERED",deliveredAt:new Date()}});await db.orderEvent.create({data:{orderId:o.id,type:"DELIVERED",actorRole:"ADMIN",actorId:session.sub}});return json(res,200,x)}

 const dispute=p.match(/^\/orders\/([^/]+)\/dispute$/);
 if(m==="POST"&&dispute){const b=await body(req);if(!text(b.reason,3,120))return json(res,400,{error:"Dispute reason required"});const o=await db.order.findUnique({where:{id:dispute[1]},include:{business:true}});if(!o)return json(res,404,{error:"Order not found"});if(session.role==="EARNER"&&o.earnerId!==session.sub||session.role==="BUSINESS"&&o.business.ownerId!==session.sub)return json(res,403,{error:"Forbidden"});const d=await db.dispute.create({data:{orderId:o.id,openedBy:session.role+":"+session.sub,reason:b.reason,details:b.details||null}});await db.order.update({where:{id:o.id},data:{status:"DISPUTED"}});return json(res,201,d)}

 const ret=p.match(/^\/orders\/([^/]+)\/complete-return$/);
 if(m==="POST"&&ret){requireRole(session,"ADMIN");const o=await db.order.findUnique({where:{id:ret[1]},include:{payment:true,logistics:true}});if(!o||!["PARTIALLY_DELIVERED","DELIVERY_FAILED","RETURN_IN_PROGRESS"].includes(o.status))return json(res,409,{error:"No return is pending"});const x=await db.$transaction(async tx=>{if(o.logistics)await tx.logisticsAssignment.update({where:{orderId:o.id},data:{status:"RETURNED",returnedAt:new Date()}});await tx.settlement.updateMany({where:{orderId:o.id,status:"HELD"},data:{status:"PAYABLE"}});await tx.orderEvent.create({data:{orderId:o.id,type:"RETURN_COMPLETED",actorRole:"ADMIN",actorId:session.sub}});return tx.order.update({where:{id:o.id},data:{status:o.deliveredQuantity>0?"PARTIALLY_DELIVERED":"RETURNED"}})});return json(res,200,x)}

 const refund=p.match(/^\/orders\/([^/]+)\/mark-refunded$/);
 if(m==="POST"&&refund){requireRole(session,"ADMIN");const pay=await db.payment.findUnique({where:{orderId:refund[1]}});if(!pay||pay.status!=="REFUND_PENDING")return json(res,409,{error:"No refund is pending"});const x=await db.payment.update({where:{orderId:refund[1]},data:{status:"REFUNDED"}});await db.orderEvent.create({data:{orderId:refund[1],type:"REFUND_COMPLETED",actorRole:"ADMIN",actorId:session.sub,metadata:{amountPaisa:pay.refundedPaisa.toString()}}});return json(res,200,x)}

 const settle=p.match(/^\/settlements\/([^/]+)\/paid$/);
 if(m==="POST"&&settle){requireRole(session,"ADMIN");const st=await db.settlement.findUnique({where:{id:settle[1]}});if(!st)return json(res,404,{error:"Settlement not found"});if(st.status!=="PAYABLE")return json(res,409,{error:"Settlement is not payable"});const x=await db.settlement.update({where:{id:st.id},data:{status:"PAID",paidAt:new Date()}});if(st.partyType==="EARNER"){const rw=await db.reward.findUnique({where:{orderId:st.orderId}});if(rw&&rw.status!=="PAID"){await db.reward.update({where:{id:rw.id},data:{status:"PAID"}});await db.ledgerEntry.create({data:{userId:rw.userId,kind:"PAYOUT",amountPaisa:-rw.amountPaisa,referenceType:"REWARD",referenceId:rw.id,idempotencyKey:"payout:reward:"+rw.id}})}}return json(res,200,x)}

 if(m==="GET"&&p==="/admin/orders"){requireRole(session,"ADMIN");return json(res,200,await db.order.findMany({include:{campaign:{select:{title:true,unitLabel:true}},business:{select:{name:true}},payment:true,logistics:true,settlements:true,disputes:{where:{status:"OPEN"}}},orderBy:{createdAt:"desc"}}))}

 if(m==="GET"&&p==="/me/orders"){
  requireRole(session,"EARNER");
  return json(res,200,await db.order.findMany({where:{earnerId:session.sub},include:{campaign:{select:{title:true,rewardPaisa:true,commissionBasis:true,unitLabel:true}},reward:true,payment:true,logistics:true,settlements:true,disputes:{where:{status:"OPEN"}}},orderBy:{createdAt:"desc"}}));
 }
 if(m==="GET"&&p==="/business/orders"){
  requireRole(session,"BUSINESS");
  const biz=await db.business.findUnique({where:{ownerId:session.sub}});
  if(!biz)return json(res,409,{error:"Business profile required"});
  return json(res,200,await db.order.findMany({where:{businessId:biz.id},include:{campaign:{select:{title:true,rewardPaisa:true,commissionBasis:true,unitLabel:true}},reward:true,payment:true,logistics:true,settlements:true,disputes:{where:{status:"OPEN"}}},orderBy:{createdAt:"desc"}}));
 }
 if(m==="GET"&&p==="/business/campaigns"){
  requireRole(session,"BUSINESS");
  const biz=await db.business.findUnique({where:{ownerId:session.sub}});
  if(!biz)return json(res,409,{error:"Business profile required"});
  return json(res,200,await db.campaign.findMany({where:{businessId:biz.id},orderBy:{createdAt:"desc"}}));
 }
 const payable=p.match(/^\/rewards\/([^/]+)\/payable$/);
 if(m==="POST"&&payable){
  requireRole(session,"BUSINESS","ADMIN");
  const r=await db.reward.findUnique({where:{id:payable[1]},include:{order:{include:{business:true}}}});
  if(!r)return json(res,404,{error:"Reward not found"});
  if(session.role!=="ADMIN"&&r.order.business.ownerId!==session.sub)return json(res,403,{error:"Forbidden"});
  if(r.status==="PAYABLE")return json(res,200,r);
  if(r.status!=="EARNED")return json(res,409,{error:"Only earned rewards can become payable"});
  return json(res,200,await db.reward.update({where:{id:r.id},data:{status:"PAYABLE"}}));
 }
 const paid=p.match(/^\/rewards\/([^/]+)\/paid$/);
 if(m==="POST"&&paid){
  requireRole(session,"BUSINESS","ADMIN");
  const result=await db.$transaction(async tx=>{
   const r=await tx.reward.findUnique({where:{id:paid[1]},include:{order:{include:{business:true}}}});
   if(!r)throw Object.assign(new Error("Reward not found"),{status:404});
   if(session.role!=="ADMIN"&&r.order.business.ownerId!==session.sub)throw Object.assign(new Error("Forbidden"),{status:403});
   if(r.status==="PAID")return r;
   if(r.status!=="PAYABLE")throw Object.assign(new Error("Reward must be payable before marking paid"),{status:409});
   const key="payout:reward:"+r.id;
   await tx.reward.update({where:{id:r.id},data:{status:"PAID"}});
   await tx.ledgerEntry.create({data:{userId:r.userId,kind:"PAYOUT",amountPaisa:-r.amountPaisa,referenceType:"REWARD",referenceId:r.id,idempotencyKey:key}});
   return tx.reward.findUnique({where:{id:r.id}});
  });
  return json(res,200,result);
 }
 if(m==="GET"&&p==="/me/earnings"){
  requireRole(session,"EARNER");
  const entries=await db.ledgerEntry.findMany({where:{userId:session.sub},orderBy:{createdAt:"desc"}});
  const total=entries.reduce((n,e)=>n+e.amountPaisa,0n);
  return json(res,200,{balancePaisa:total,entries});
 }
 return json(res,404,{error:"Not found"});
}catch(e){console.error(e);return json(res,e.status||500,{error:e.status?e.message:"Internal server error"})}};