const API="/api";
let token=localStorage.getItem("earn.token")||"";
export const session={get token(){return token},get role(){return localStorage.getItem("earn.role")||""},set(x){token=x.token;localStorage.setItem("earn.token",x.token);localStorage.setItem("earn.role",x.role)},clear(){token="";localStorage.removeItem("earn.token");localStorage.removeItem("earn.role")}};
export async function request(path,options={}){const headers={"content-type":"application/json",...(options.headers||{})};if(token)headers.authorization="Bearer "+token;const r=await fetch(API+path,{...options,headers});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Something went wrong");return d}
const post=(p,b={})=>request(p,{method:"POST",body:JSON.stringify(b)});
export const api={
 signup:b=>post("/auth/signup",b),login:b=>post("/auth/login",b),me:()=>request("/me"),campaigns:()=>request("/campaigns"),
 startCampaign:id=>post("/campaigns/"+id+"/start"),createOrder:b=>post("/orders",b),myOrders:()=>request("/me/orders"),earnings:()=>request("/me/earnings"),
 businessOrders:()=>request("/business/orders"),businessCampaigns:()=>request("/business/campaigns"),createCampaign:b=>post("/campaigns",b),publish:id=>post("/campaigns/"+id+"/publish"),
 accept:(id,q)=>post("/orders/"+id+"/accept",{quantity:q}),ready:id=>post("/orders/"+id+"/ready"),cancel:(id,reason)=>post("/orders/"+id+"/cancel",{reason}),
 dispute:(id,b)=>post("/orders/"+id+"/dispute",b),customerOrder:t=>request("/customer/order?token="+encodeURIComponent(t)),confirmBuyer:t=>post("/customer/confirm-order",{token:t}),
 customerPayment:(t,b)=>post("/customer/payment",{token:t,...b}),verifyDelivery:(t,quantity,deliveryPin)=>post("/customer/verify-delivery",{token:t,quantity,deliveryPin}),
 adminOrders:()=>request("/admin/orders"),confirmPayment:id=>post("/orders/"+id+"/confirm-payment"),assignLogistics:(id,b)=>post("/orders/"+id+"/assign-logistics",b),
 pickup:(id,b)=>post("/orders/"+id+"/pickup",b),outForDelivery:id=>post("/orders/"+id+"/out-for-delivery"),delivered:id=>post("/orders/"+id+"/delivered"),
 completeReturn:id=>post("/orders/"+id+"/complete-return"),markRefunded:id=>post("/orders/"+id+"/mark-refunded"),settlementPaid:id=>post("/settlements/"+id+"/paid")
};
export const money=p=>"Rs "+(Number(p||0)/100).toLocaleString("en-NP",{maximumFractionDigits:2});
