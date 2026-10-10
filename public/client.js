window.EARN_API = (() => {
  const TOKEN_KEY = "earn_session_token";
  function token(){ return sessionStorage.getItem(TOKEN_KEY); }
  function saveToken(value){ sessionStorage.setItem(TOKEN_KEY,value); }
  function clearToken(){ sessionStorage.removeItem(TOKEN_KEY); }
  async function request(path, options={}){
    const headers={"content-type":"application/json",...(options.headers||{})};
    const current=token(); if(current)headers.authorization="Bearer "+current;
    let res;
    try{res=await fetch("/api"+path,{...options,headers})}catch{throw new Error("Could not connect. Check your internet and try again.")}
    let data={}; try{data=await res.json()}catch{}
    if(!res.ok)throw new Error(data.error||"Request failed. Try again.");
    return data;
  }
  return {
    token,saveToken,clearToken,
    login:(phone,password)=>request("/auth/login",{method:"POST",body:JSON.stringify({phone,password})}),
    signup:data=>request("/auth/signup",{method:"POST",body:JSON.stringify(data)}),
    me:()=>request("/me"),
    campaigns:()=>request("/campaigns"),
    campaign:id=>request("/campaigns/"+encodeURIComponent(id)),
    customerCreateOrder:data=>request("/customer/orders",{method:"POST",body:JSON.stringify(data)}),
    startSale:campaignId=>request("/campaigns/"+encodeURIComponent(campaignId)+"/start",{method:"POST",body:"{}"}),
    createOrder:data=>request("/orders",{method:"POST",body:JSON.stringify(data)}),
    reissueBuyerLink:orderId=>request("/orders/"+encodeURIComponent(orderId)+"/reissue-confirmation",{method:"POST",body:"{}"}),
    myOrders:()=>request("/me/orders"),
    myEarnings:()=>request("/me/earnings"),
    myPerformance:()=>request("/me/performance"),
    notifications:()=>request("/notifications"),
    readNotifications:()=>request("/notifications/read",{method:"POST",body:"{}"}),
    businessOrders:()=>request("/business/orders"),
    businessCampaigns:()=>request("/business/campaigns"),
    businessPerformance:()=>request("/business/performance"),
    editCampaign:(id,data)=>request("/campaigns/"+encodeURIComponent(id),{method:"PATCH",body:JSON.stringify(data)}),
    createCampaign:data=>request("/campaigns",{method:"POST",body:JSON.stringify(data)}),
    publishCampaign:id=>request("/campaigns/"+encodeURIComponent(id)+"/publish",{method:"POST",body:"{}"}),
    acceptOrder:(id,quantity)=>request("/orders/"+encodeURIComponent(id)+"/accept",{method:"POST",body:JSON.stringify({quantity})}),
    declineOrder:(id,reason)=>request("/orders/"+encodeURIComponent(id)+"/cancel",{method:"POST",body:JSON.stringify({reason})}),
    readyOrder:id=>request("/orders/"+encodeURIComponent(id)+"/ready",{method:"POST",body:"{}"}),
    openDispute:(orderId,reason,details)=>request("/orders/"+encodeURIComponent(orderId)+"/dispute",{method:"POST",body:JSON.stringify({reason,details})}),
    buyerOrder:token=>request("/customer/order?token="+encodeURIComponent(token)),
    confirmBuyerOrder:token=>request("/customer/confirm-order",{method:"POST",body:JSON.stringify({token})}),
    rejectBuyerOrder:token=>request("/customer/reject-order",{method:"POST",body:JSON.stringify({token})}),
    submitBuyerPayment:(token,method,reference)=>request("/customer/payment",{method:"POST",body:JSON.stringify({token,method,reference})}),
    verifyBuyerDelivery:(token,quantity,deliveryPin)=>request("/customer/verify-delivery",{method:"POST",body:JSON.stringify({token,quantity,deliveryPin})})
  };
})();
