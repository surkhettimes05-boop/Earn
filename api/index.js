const {PrismaClient}=require("@prisma/client");
const bcrypt=require("bcryptjs");
const crypto=require("crypto");
const {sign,requireAuth,requireRole}=require("../lib/auth");
const {assertTransition,rewardForDelivery}=require("../lib/domain");
const db=global.__earnDb||new PrismaClient();
if(process.env.NODE_ENV!=="production")global.__earnDb=db;

const json=(res,status,data)=>{res.statusCode=status;res.setHeader("content-type","application/json");res.end(JSON.stringify(data,(_,v)=>typeof v==="bigint"?v.toString():v))};
const body=async req=>{if(req.body)return req.body;let s="";for await(const c of req)s+=c;if(s.length>1e6)throw Object.assign(new Error("Payload too large"),{status:413});return s?JSON.parse(s):{}};
const path=req=>new URL(req.url,"http://x").pathname.replace(/^\/api/,"");
const cleanPhone=p=>String(p||"").replace(/\D/g,"");
const validPhone=p=>/^9779[678]\d{8}$/.test(p)||/^9[678]\d{8}$/.test(p);
const hashPhone=p=>crypto.createHash("sha256").update(cleanPhone(p)).digest("hex");
const text=(v,min,max)=>typeof v==="string"&&v.trim().length>=min&&v.trim().length<=max;
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
  if(!Number.isFinite(reward)||reward<=0||!Number.isInteger(cap)||cap<1)return json(res,400,{error:"Reward and cap must be positive"});
  const row=await db.campaign.create({data:{businessId:biz.id,type:b.type,title:b.title.trim(),city:b.city.trim(),rewardPaisa:BigInt(Math.round(reward*100)),cap,successRule:b.successRule.trim(),status:"DRAFT"}});
  return json(res,201,row);
 }

 const pub=p.match(/^\/campaigns\/([^/]+)\/publish$/);
 if(m==="POST"&&pub){
  requireRole(session,"BUSINESS","ADMIN");
  const c=await db.campaign.findUnique({where:{id:pub[1]},include:{business:true}});
  if(!c)return json(res,404,{error:"Campaign not found"});
  if(session.role!=="ADMIN"&&c.business.ownerId!==session.sub)return json(res,403,{error:"Forbidden"});
  return json(res,200,await db.campaign.update({where:{id:c.id},data:{status:"LIVE"}}));
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
  requireRole(session,"EARNER");
  const b=await body(req);
  if(!b.idempotencyKey)return json(res,400,{error:"idempotencyKey required"});
  if(!text(b.customerName,2,80)||!validPhone(cleanPhone(b.customerPhone))||!text(b.product,2,120)||!Number.isInteger(Number(b.quantity))||Number(b.quantity)<1)return json(res,400,{error:"Enter valid order details"});
  const existing=await db.order.findUnique({where:{idempotencyKey:b.idempotencyKey}});
  if(existing){if(existing.earnerId!==session.sub)return json(res,409,{error:"Idempotency key conflict"});return json(res,200,existing)}
  const a=await db.attribution.findUnique({where:{code:b.attributionCode}});
  if(!a||a.earnerId!==session.sub)return json(res,400,{error:"Invalid attribution"});
  const c=await db.campaign.findFirst({where:{id:a.campaignId,status:"LIVE",type:"ORDER"}});
  if(!c)return json(res,409,{error:"Order campaign unavailable"});
  const o=await db.order.create({data:{campaignId:c.id,businessId:c.businessId,earnerId:session.sub,attributionCode:a.code,customerName:b.customerName.trim(),customerPhoneHash:hashPhone(b.customerPhone),product:b.product.trim(),quantity:Number(b.quantity),idempotencyKey:b.idempotencyKey}});
  return json(res,201,o);
 }

 const tr=p.match(/^\/orders\/([^/]+)\/(accept|deliver|cancel)$/);
 if(m==="POST"&&tr){
  requireRole(session,"BUSINESS","ADMIN");
  const desired={accept:"ACCEPTED",deliver:"DELIVERED",cancel:"CANCELLED"}[tr[2]];
  const result=await db.$transaction(async tx=>{
   const o=await tx.order.findUnique({where:{id:tr[1]},include:{campaign:true,business:true}});
   if(!o)throw Object.assign(new Error("Order not found"),{status:404});
   if(session.role!=="ADMIN"&&o.business.ownerId!==session.sub)throw Object.assign(new Error("Forbidden"),{status:403});
   if(o.status===desired)return o;
   assertTransition(o.status,desired);
   if(desired!=="DELIVERED")return tx.order.update({where:{id:o.id},data:{status:desired}});
   const spec=rewardForDelivery(o,o.campaign);
   const count=await tx.reward.count({where:{order:{campaignId:o.campaignId},status:{in:["EARNED","PAYABLE","PAID"]}}});
   if(count>=o.campaign.cap)throw Object.assign(new Error("Campaign reward cap reached"),{status:409});
   await tx.order.update({where:{id:o.id},data:{status:"DELIVERED"}});
   await tx.reward.create({data:{orderId:o.id,userId:o.earnerId,amountPaisa:spec.amountPaisa,status:"EARNED"}});
   await tx.ledgerEntry.create({data:{userId:o.earnerId,kind:"REWARD_EARNED",amountPaisa:spec.amountPaisa,referenceType:"ORDER",referenceId:o.id,idempotencyKey:spec.ledgerKey}});
   return tx.order.findUnique({where:{id:o.id},include:{reward:true}});
  });
  return json(res,200,result);
 }

 if(m==="GET"&&p==="/me/orders"){
  requireRole(session,"EARNER");
  return json(res,200,await db.order.findMany({where:{earnerId:session.sub},include:{campaign:{select:{title:true,rewardPaisa:true}},reward:true},orderBy:{createdAt:"desc"}}));
 }
 if(m==="GET"&&p==="/business/orders"){
  requireRole(session,"BUSINESS");
  const biz=await db.business.findUnique({where:{ownerId:session.sub}});
  if(!biz)return json(res,409,{error:"Business profile required"});
  return json(res,200,await db.order.findMany({where:{businessId:biz.id},include:{campaign:{select:{title:true,rewardPaisa:true}}},orderBy:{createdAt:"desc"}}));
 }
 if(m==="GET"&&p==="/business/campaigns"){
  requireRole(session,"BUSINESS");
  const biz=await db.business.findUnique({where:{ownerId:session.sub}});
  if(!biz)return json(res,409,{error:"Business profile required"});
  return json(res,200,await db.campaign.findMany({where:{businessId:biz.id},orderBy:{createdAt:"desc"}}));
 }
 if(m==="GET"&&p==="/me/earnings"){
  requireRole(session,"EARNER");
  const entries=await db.ledgerEntry.findMany({where:{userId:session.sub},orderBy:{createdAt:"desc"}});
  const total=entries.reduce((n,e)=>n+e.amountPaisa,0n);
  return json(res,200,{balancePaisa:total,entries});
 }
 return json(res,404,{error:"Not found"});
}catch(e){console.error(e);return json(res,e.status||500,{error:e.status?e.message:"Internal server error"})}};