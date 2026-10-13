import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
const origin = 'https://white5-mcp.volodymyronufriichuk68.workers.dev';
const state = randomBytes(24).toString('base64url'), verifier = randomBytes(48).toString('base64url');
const callback = createServer();
await new Promise(resolve => callback.listen(0,'127.0.0.1',resolve));
const redirect = `http://127.0.0.1:${callback.address().port}/callback`;
const registered = await fetch(`${origin}/oauth/register`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({client_name:'White5 GBP production verification',redirect_uris:[redirect],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none',scope:'white5:read white5:write'})});
if(!registered.ok) { callback.close();throw new Error(`Registration failed: ${registered.status}`) }
const {client_id} = await registered.json();
const authorize = new URL(`${origin}/authorize`);
authorize.search = new URLSearchParams({client_id,redirect_uri:redirect,response_type:'code',scope:'white5:read white5:write',state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',resource:`${origin}/mcp`}).toString();
console.log(`AUTH_URL=${authorize}`);
const code = await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{callback.close();reject(new Error('Authorization timed out'))},10*60*1000);
  callback.on('request',(request,response)=>{
    const url=new URL(request.url,'http://127.0.0.1');
    if(url.pathname!='/callback'||url.searchParams.get('state')!==state){response.writeHead(400);response.end('Invalid callback');return}
    clearTimeout(timer);response.writeHead(200,{'content-type':'text/plain','cache-control':'no-store'});response.end('White5 verification authorized. Return to Codex.');callback.close();
    if(!url.searchParams.get('code')) reject(new Error('Authorization was not granted')); else resolve(url.searchParams.get('code'));
  });
});
const exchanged=await fetch(`${origin}/oauth/token`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id,code,code_verifier:verifier,redirect_uri:redirect,resource:`${origin}/mcp`})});
if(!exchanged.ok)throw new Error(`Token exchange failed: ${exchanged.status}`);
const tokens=await exchanged.json();
let access=tokens.access_token;
let id=0;
async function rpc(method,params={}){
  const response=await fetch(`${origin}/mcp`,{method:'POST',headers:{authorization:`Bearer ${access}`,accept:'application/json, text/event-stream','content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});
  if(!response.ok)throw new Error(`MCP ${method}: HTTP ${response.status}`);
  const raw=await response.text();const payload=JSON.parse(raw.split(/\r?\n/).find(l=>l.startsWith('data:'))?.slice(5)||raw);
  if(payload.error)throw new Error(`MCP ${method}: protocol error ${payload.error.code}`);
  return payload.result;
}
async function tool(name,args={}){
  const result=await rpc('tools/call',{name,arguments:args});
  const text=result.content.find(c=>c.type==='text').text;
  let data; try {data=JSON.parse(text.slice(text.indexOf('{')))} catch {data={message:text}}
  return {ok:!result.isError,data};
}
await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'production-verifier',version:'1'}});
const catalog=await rpc('tools/list');
const uploadTool=catalog.tools.find(t=>t.name==='upload_media');
if(!uploadTool || JSON.stringify(uploadTool._meta?.['openai/fileParams'])!==JSON.stringify(['file'])) throw new Error('Production upload_media file metadata is missing');
for(const key of ['download_url','file_id','mime_type','file_name']) if(!uploadTool.inputSchema.properties.file.properties[key]) throw new Error('Production file input schema is incomplete');
await mkdir(new URL('../.local/',import.meta.url),{recursive:true});
await writeFile(new URL('../.local/production-catalog.json',import.meta.url),JSON.stringify(catalog,null,2));
console.log(JSON.stringify({productionTools:catalog.tools.map(t=>t.name)}));
for(const name of ['list_gbp_services','update_gbp_services','run_full_gbp_audit','upload_gbp_media_batch','create_gbp_media_batch','schedule_gbp_job'])if(!catalog.tools.some(t=>t.name===name))throw new Error('Missing production management tool: '+name);
const report={};
for(const [name,args] of [
  ['list_gbp_services',{location:'locations/8623115222428082795'}],['prepare_gbp_white5_services',{location:'locations/8623115222428082795'}],['get_gbp_capabilities',{}],['list_gbp_jobs',{}],
  ['get_gbp_status',{}],['list_gbp_accounts',{}],['list_gbp_locations',{account:'accounts/115421274606058010150'}],
  ['upload_media',{file:{download_url:'https://files.oaiusercontent.com/schema-test-only?sig=not-a-real-link',file_id:'schema-test',mime_type:'image/png',file_name:'schema-test.png'},confirmed:false}],
  ['create_gbp_media',{account:'115421274606058010150',location:'8623115222428082795',sourceUrl:'https://white5.ca/schema-test-only.png',category:'AT_WORK',confirmed:false}],
  ['list_gbp_media',{account:'115421274606058010150',location:'8623115222428082795',pageSize:1}],
  ['get_gbp_location',{location:'locations/8623115222428082795'}],
  ['get_gbp_performance',{location:'8623115222428082795',startDate:'2026-09-01',endDate:'2026-09-30',metrics:['BUSINESS_IMPRESSIONS_DESKTOP_SEARCH','BUSINESS_IMPRESSIONS_MOBILE_SEARCH','BUSINESS_IMPRESSIONS_DESKTOP_MAPS','BUSINESS_IMPRESSIONS_MOBILE_MAPS','WEBSITE_CLICKS','CALL_CLICKS']}],
  ['list_gbp_posts',{account:'115421274606058010150',location:'8623115222428082795'}],
  ['list_gbp_reviews',{account:'115421274606058010150',location:'8623115222428082795'}],
  ['prepare_gbp_post',{account:'115421274606058010150',location:'8623115222428082795',post:{summary:'Schema verification only; not published.'}}],
  ['square_connection_check',{}],['get_google_ads_accounts',{}],['list_email_folders',{}],
  ['run_provider_read_tool',{provider:'meta_ads',tool_name:'get_meta_connection_status',arguments:{}}],
]){
  if(!catalog.tools.some(t=>t.name===name)){report[name]={advertised:false};continue}
  const result=await tool(name,args);
  report[name]={ok:result.ok,...(result.ok?{count:result.data.accounts?.length??result.data.locations?.length??result.data.reviews?.length??result.data.localPosts?.length??result.data.mediaItems?.length,preview:result.data.preview}: {error:result.data})};
  if(['upload_media','create_gbp_media'].includes(name)&&(!result.ok||result.data.preview!==true||result.data.executed!==false)) throw new Error(`${name} preview safety check failed`);
}
const refreshed=await fetch(`${origin}/oauth/token`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id,refresh_token:tokens.refresh_token,resource:`${origin}/mcp`})});
report.connectorTokenRefresh={ok:refreshed.ok};
if(refreshed.ok)access=(await refreshed.json()).access_token;
const health=await fetch(`${origin}/health`,{headers:{authorization:`Bearer ${access}`}});
report.health={status:health.status,data:await health.json()};
await writeFile(new URL('../.local/production-verification.json',import.meta.url),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
