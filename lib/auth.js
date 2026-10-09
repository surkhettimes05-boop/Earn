const jwt=require("jsonwebtoken");
function secret(){const s=process.env.JWT_SECRET;if(!s||s.length<32)throw new Error("JWT_SECRET must be at least 32 characters");return s}
function sign(user){return jwt.sign({sub:user.id,role:user.role},secret(),{expiresIn:"7d"})}
function requireAuth(req){const h=req.headers.authorization||"";if(!h.startsWith("Bearer "))throw Object.assign(new Error("Authentication required"),{status:401});try{return jwt.verify(h.slice(7),secret())}catch{throw Object.assign(new Error("Invalid session"),{status:401})}}
function requireRole(session,...roles){if(!roles.includes(session.role))throw Object.assign(new Error("Forbidden"),{status:403})}
module.exports={sign,requireAuth,requireRole};