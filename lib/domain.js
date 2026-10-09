const transitions={
 SUBMITTED:["CUSTOMER_CONFIRMED","CANCELLED"],
 CUSTOMER_CONFIRMED:["PAYMENT_PENDING","CANCELLED"],
 PAYMENT_PENDING:["PAID","CANCELLED"],
 PAID:["READY_FOR_PICKUP","CANCELLED"],
 READY_FOR_PICKUP:["PICKED_UP","CANCELLED"],
 PICKED_UP:["OUT_FOR_DELIVERY","DELIVERED","DELIVERY_FAILED","DISPUTED"],
 OUT_FOR_DELIVERY:["DELIVERED","DELIVERY_FAILED","DISPUTED"],
 DELIVERED:["VERIFIED","PARTIALLY_DELIVERED","DISPUTED"],
 PARTIALLY_DELIVERED:["RETURN_IN_PROGRESS","DISPUTED"],
 DELIVERY_FAILED:["RETURN_IN_PROGRESS","DISPUTED"],
 RETURN_IN_PROGRESS:["RETURNED","DISPUTED"],
 VERIFIED:[],RETURNED:[],CANCELLED:[],DISPUTED:[]
};
function canTransition(from,to){return (transitions[from]||[]).includes(to)}
function assertTransition(from,to){if(!canTransition(from,to))throw Object.assign(new Error("Invalid order transition: "+from+" -> "+to),{status:409})}
const divRound=(n,d)=>(n+d/2n)/d;
function commissionQuote(campaign,quantity=1){
 const q=BigInt(quantity),basis=campaign.commissionBasis||"FIXED_ORDER"; let total;
 if(basis==="PER_UNIT")total=BigInt(campaign.businessCommissionPaisa||0)*q;
 else if(basis==="PERCENT_GMV"){if(campaign.unitPricePaisa==null||campaign.businessCommissionBps==null)throw Object.assign(new Error("Campaign pricing is incomplete"),{status:409});total=divRound(BigInt(campaign.unitPricePaisa)*q*BigInt(campaign.businessCommissionBps),10000n)}
 else total=BigInt(campaign.businessCommissionPaisa??campaign.rewardPaisa??0);
 const share=BigInt(campaign.earnerShareBps??10000),earner=divRound(total*share,10000n);
 return {totalCommissionPaisa:total,earnerRewardPaisa:earner,platformFeePaisa:total-earner};
}
function verifiedEconomics(order,quantity){
 const q=BigInt(quantity),unit=BigInt(order.unitPricePaisaSnapshot||0),gmv=unit*q; let total;
 if(order.commissionBasisSnapshot==="PER_UNIT")total=BigInt(order.businessCommissionPaisaSnapshot||0)*q;
 else if(order.commissionBasisSnapshot==="PERCENT_GMV")total=divRound(gmv*BigInt(order.businessCommissionBpsSnapshot||0),10000n);
 else total=quantity>0?BigInt(order.totalCommissionPaisaSnapshot||0):0n;
 const earner=divRound(total*BigInt(order.earnerShareBpsSnapshot||10000),10000n);
 return {gmvPaisa:gmv,totalCommissionPaisa:total,earnerRewardPaisa:earner,platformFeePaisa:total-earner,merchantSettlementPaisa:gmv-total};
}
function rewardForDelivery(order,campaign){const amount=order.earnerRewardPaisaSnapshot!=null?BigInt(order.earnerRewardPaisaSnapshot):BigInt(campaign.rewardPaisa);return {amountPaisa:amount,ledgerKey:"reward:order:"+order.id}}
module.exports={canTransition,assertTransition,commissionQuote,verifiedEconomics,rewardForDelivery};
