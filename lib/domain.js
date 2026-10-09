function canTransition(from,to){return ({SUBMITTED:["CANCELLED"],CUSTOMER_CONFIRMED:["ACCEPTED","CANCELLED"],ACCEPTED:["DELIVERED","CANCELLED"],DELIVERED:[],CANCELLED:[]}[from]||[]).includes(to)}
function assertTransition(from,to){if(!canTransition(from,to))throw Object.assign(new Error("Invalid order transition: "+from+" -> "+to),{status:409})}
const divRound=(n,d)=>(n+d/2n)/d;
function commissionQuote(campaign,quantity=1){
 const q=BigInt(quantity),basis=campaign.commissionBasis||"FIXED_ORDER";
 let total;
 if(basis==="PER_UNIT") total=BigInt(campaign.businessCommissionPaisa||0)*q;
 else if(basis==="PERCENT_GMV"){
  if(campaign.unitPricePaisa==null||campaign.businessCommissionBps==null)throw Object.assign(new Error("Campaign pricing is incomplete"),{status:409});
  total=divRound(BigInt(campaign.unitPricePaisa)*q*BigInt(campaign.businessCommissionBps),10000n);
 } else total=BigInt(campaign.businessCommissionPaisa??campaign.rewardPaisa??0);
 const share=BigInt(campaign.earnerShareBps??10000);
 const earner=divRound(total*share,10000n);
 return {totalCommissionPaisa:total,earnerRewardPaisa:earner,platformFeePaisa:total-earner};
}
function rewardForDelivery(order,campaign){
 if(order.status!=="ACCEPTED")throw Object.assign(new Error("Only accepted orders can be delivered"),{status:409});
 const amount=order.earnerRewardPaisaSnapshot!=null?BigInt(order.earnerRewardPaisaSnapshot):BigInt(campaign.rewardPaisa);
 return {amountPaisa:amount,ledgerKey:"reward:order:"+order.id};
}
module.exports={canTransition,assertTransition,commissionQuote,rewardForDelivery};
