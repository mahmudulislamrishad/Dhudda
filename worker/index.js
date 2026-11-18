const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",...headers}});
const te=new TextEncoder();
const b64u=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
const hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,"0")).join("");
async function hash(s){return hex(await crypto.subtle.digest("SHA-256",te.encode(s)));}
function encJson(v){return b64u(te.encode(JSON.stringify(v)));}
async function jwt(payload,secret){const a=encJson({alg:"HS256",typ:"JWT"}),b=encJson(payload),d=a+"."+b,k=await crypto.subtle.importKey("raw",te.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);return d+"."+b64u(await crypto.subtle.sign("HMAC",k,te.encode(d)));}
function cors(origin,env){const allow=["https://mahmudulislamrishad.github.io",...(env.APP_ORIGIN||"").split(",").map(x=>x.trim().replace(/\/+$/,""))];if(!origin||!allow.includes(origin.replace(/\/+$/,"")))return {};return {"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type,Authorization,X-Admin-Secret","Access-Control-Max-Age":"86400","Vary":"Origin"};}
async function readBody(req){try{return await req.json()}catch{return null}}
async function auth(req,env){const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");if(!token)return null;return env.DB.prepare("SELECT u.id,u.username,u.display_name,u.is_verified,u.public_key FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?").bind(await hash(token),Date.now()).first();}
async function run(env,sql,...args){return env.DB.prepare(sql).bind(...args).run();}
export default {async fetch(req,env){
 const origin=req.headers.get("Origin")||"",headers=cors(origin,env),url=new URL(req.url);
 if(req.method==="OPTIONS")return new Response(null,{status:headers["Access-Control-Allow-Origin"]?204:403,headers});
 if(origin&&!headers["Access-Control-Allow-Origin"])return json({error:"Origin not allowed"},403);
 try{
  if(url.pathname==="/health"&&req.method==="GET")return json({ok:true,service:"dhudda-hub-api"},200,headers);
  if(url.pathname==="/api/token"&&req.method==="POST"){
   for(const k of ["LIVEKIT_URL","LIVEKIT_API_KEY","LIVEKIT_API_SECRET"])if(!env[k])return json({error:`Server configuration missing: ${k}`},500,headers);
   const b=await readBody(req),room=String(b?.roomName||"").trim(),name=String(b?.participantName||"").trim();
   if(!/^[a-zA-Z0-9_-]{2,50}$/.test(room)||!name||name.length>30)return json({error:"Invalid room or participant name"},400,headers);
   const now=Math.floor(Date.now()/1000),claims={iss:env.LIVEKIT_API_KEY,sub:"guest_"+crypto.randomUUID(),name,nbf:now-5,exp:now+600,video:{roomJoin:true,room,canPublish:true,canSubscribe:true,canPublishData:true}};
   return json({serverUrl:env.LIVEKIT_URL,token:await jwt(claims,env.LIVEKIT_API_SECRET)},200,headers);
  }
  if(url.pathname==="/api/activate"&&req.method==="POST"){
   const b=await readBody(req),key=String(b?.key||"").trim().toUpperCase(),device=String(b?.deviceId||""),username=String(b?.username||"").trim().toLowerCase(),display=String(b?.displayName||"").trim(),pub=String(b?.publicKey||"");
   if(!/^DH-[A-Z0-9]{5}(?:-[A-Z0-9]{5}){3}$/.test(key)||!/^[a-f0-9-]{50,80}$/i.test(device)||!/^[a-z0-9_]{3,20}$/.test(username)||!display||display.length>40||pub.length<20||pub.length>1200)return json({error:"তথ্য সঠিক নয়। Username 3-20 অক্ষর (a-z, 0-9, _)।"},400,headers);
   const kh=await hash(key);
   // Conditional UPDATE claims the key once; the key is burned even if account creation subsequently fails.
   const claimed=await env.DB.prepare("UPDATE activation_keys SET used_at=?,used_device=? WHERE key_hash=? AND used_at IS NULL RETURNING key_type").bind(Date.now(),device,kh).all();
   if(!claimed.results?.length)return json({error:"Key invalid অথবা আগে ব্যবহার হয়েছে।"},400,headers);
   const id=crypto.randomUUID(),token=crypto.randomUUID()+crypto.randomUUID(),now=Date.now(),type=claimed.results[0].key_type;
   try{await run(env,"INSERT INTO users(id,username,display_name,is_verified,device_id,public_key,created_at) VALUES(?,?,?,?,?,?,?)",id,username,display,type==="vip"?1:0,device,pub,now);}
   catch(e){return json({error:"Username আগে থেকেই আছে অথবা device আগে activate করা হয়েছে। এই key ব্যবহার হয়ে গেছে।"},409,headers);}
   await run(env,"INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)",await hash(token),id,now+2592000000);
   return json({token,user:{id,username,display_name:display,is_verified:type==="vip"?1:0,public_key:pub}},200,headers);
  }
  if(url.pathname==="/api/vip-revoke"&&req.method==="POST"){
   if(!env.ADMIN_SECRET||req.headers.get("X-Admin-Secret")!==env.ADMIN_SECRET)return json({error:"Forbidden"},403,headers);
   const b=await readBody(req),u=String(b?.username||"").trim().toLowerCase();if(!u)return json({error:"Username required"},400,headers);
   const r=await run(env,"UPDATE users SET is_verified=0 WHERE username=?",u);return json({ok:r.meta.changes===1},200,headers);
  }
  const me=await auth(req,env);if(!me)return json({error:"Login required"},401,headers);
  if(url.pathname==="/api/me")return json({user:me},200,headers);
  if(url.pathname==="/api/users"&&req.method==="GET"){
   const q=(url.searchParams.get("q")||"").trim().toLowerCase();if(q.length<2)return json({users:[]},200,headers);
   const r=await env.DB.prepare("SELECT id,username,display_name,is_verified,public_key FROM users WHERE username LIKE ? AND id<>? LIMIT 20").bind("%"+q+"%",me.id).all();return json({users:r.results},200,headers);
  }
  if(url.pathname==="/api/friends"&&req.method==="GET"){
   const r=await env.DB.prepare("SELECT u.id,u.username,u.display_name,u.is_verified,u.public_key FROM friendships f JOIN users u ON u.id=CASE WHEN f.requester_id=? THEN f.recipient_id ELSE f.requester_id END WHERE (f.requester_id=? OR f.recipient_id=?) AND f.status='accepted'").bind(me.id,me.id,me.id).all();return json({friends:r.results},200,headers);
  }
  if(url.pathname==="/api/requests"&&req.method==="GET"){
   const r=await env.DB.prepare("SELECT f.id,u.id AS user_id,u.username,u.display_name,u.is_verified FROM friendships f JOIN users u ON u.id=f.requester_id WHERE f.recipient_id=? AND f.status='pending'").bind(me.id).all();return json({requests:r.results},200,headers);
  }
  if(url.pathname==="/api/friend-request"&&req.method==="POST"){
   const b=await readBody(req),target=String(b?.userId||"");if(!target||target===me.id)return json({error:"Invalid user"},400,headers);
   const other=await env.DB.prepare("SELECT id FROM users WHERE id=?").bind(target).first();if(!other)return json({error:"User not found"},404,headers);
   try{await run(env,"INSERT INTO friendships(id,requester_id,recipient_id,status,created_at) VALUES(?,?,?,'pending',?)",crypto.randomUUID(),me.id,target,Date.now());}catch{return json({error:"Friend request already exists or you are already friends"},409,headers);}
   return json({ok:true},200,headers);
  }
  if(url.pathname==="/api/friend-accept"&&req.method==="POST"){
   const b=await readBody(req),id=String(b?.requestId||"");const r=await run(env,"UPDATE friendships SET status='accepted' WHERE id=? AND recipient_id=? AND status='pending'",id,me.id);return json({ok:r.meta.changes===1},200,headers);
  }
  if(url.pathname==="/api/chat-ticket"&&req.method==="POST"){
   const b=await readBody(req),other=String(b?.userId||"");const f=await env.DB.prepare("SELECT id FROM friendships WHERE status='accepted' AND ((requester_id=? AND recipient_id=?) OR (requester_id=? AND recipient_id=?))").bind(me.id,other,other,me.id).first();if(!f)return json({error:"Friends only"},403,headers);
   const ticket=crypto.randomUUID()+crypto.randomUUID();await run(env,"INSERT INTO chat_tickets(token_hash,user_id,friendship_id,expires_at) VALUES(?,?,?,?)",await hash(ticket),me.id,f.id,Date.now()+60000);return json({ticket},200,headers);
  }
  if(url.pathname==="/api/chat"&&req.method==="GET"){
   if(req.headers.get("Upgrade")!=="websocket")return json({error:"WebSocket required"},426,headers);
   const ticket=url.searchParams.get("ticket")||"",th=await hash(ticket),t=await env.DB.prepare("SELECT friendship_id FROM chat_tickets WHERE token_hash=? AND user_id=? AND expires_at>?").bind(th,me.id,Date.now()).first();if(!t)return json({error:"Invalid chat ticket"},401,headers);
   await run(env,"DELETE FROM chat_tickets WHERE token_hash=?",th);
   const forwardUrl=new URL(req.url);forwardUrl.protocol="https:";forwardUrl.hostname="chat.internal";forwardUrl.pathname="/connect";forwardUrl.search="";const forwardRequest=new Request(forwardUrl.toString(),req);forwardRequest.headers.set("X-User-Id",me.id);return env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(t.friendship_id)).fetch(forwardRequest);
  }
  return json({error:"Not found"},404,headers);
 }catch(e){console.error(e);return json({error:"Server error"},500,headers);}
}};
export class ChatRoom {
 constructor(ctx){this.ctx=ctx;}
 async fetch(req){const pair=new WebSocketPair(),client=pair[0],server=pair[1];this.ctx.acceptWebSocket(server);server.serializeAttachment({userId:req.headers.get("X-User-Id")||""});return new Response(null,{status:101,webSocket:client});}
 webSocketMessage(ws,message){if(typeof message!=="string"||message.length>16000){ws.close(1009,"Message too large");return;}let p;try{p=JSON.parse(message)}catch{ws.close(1003,"Invalid JSON");return;}if(p.type!=="ciphertext"||typeof p.data!=="string"||p.data.length>14000){ws.close(1008,"Encrypted payload only");return;}for(const peer of this.ctx.getWebSockets()){if(peer!==ws)try{peer.send(JSON.stringify({type:"ciphertext",data:p.data}))}catch{}}}
 webSocketClose(ws){try{ws.close()}catch{}}
}
