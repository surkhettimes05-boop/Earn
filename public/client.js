window.EARN_API = (() => {
  const TOKEN_KEY = "earn_session_token";
  function token(){ return sessionStorage.getItem(TOKEN_KEY); }
  function saveToken(value){ sessionStorage.setItem(TOKEN_KEY,value); }
  function clearToken(){ sessionStorage.removeItem(TOKEN_KEY); }
  async function request(path, options={}){
    const headers={"content-type":"application/json",...(options.headers||{})};
    const current=token(); if(current)headers.authorization="Bearer "+current;
    const res=await fetch("/api"+path,{...options,headers});
    let data={}; try{data=await res.json()}catch{}
    if(!res.ok)throw new Error(data.error||"Request failed");
    return data;
  }
  return {
    token,saveToken,clearToken,
    login:(phone,password)=>request("/auth/login",{method:"POST",body:JSON.stringify({phone,password})}),
    signup:data=>request("/auth/signup",{method:"POST",body:JSON.stringify(data)}),
    me:()=>request("/me")
  };
})();
