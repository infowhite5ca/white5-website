// One-time browser authorization. Credentials never leave Worker memory/KV.
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
const config=await readFile(join(process.env.APPDATA,'xdg.config/.wrangler/config/default.toml'),'utf8');
const cloudflareToken=config.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
if(!cloudflareToken)throw new Error('Run wrangler whoami to refresh Cloudflare authorization.');
const base='https://api.cloudflare.com/client/v4/accounts/bf77f2b4dd0f909b5b1d1d7d89389cc4';
const worker='white5-google-business-profile-mcp';
const secretUrl=`${base}/workers/scripts/${worker}/secrets`;
const doneUrl=`${base}/storage/kv/namespaces/969c10c47a9542ea8e7459a331c2ac78/values/google-install-complete`;
const origin=`https://${worker}.volodymyronufriichuk68.workers.dev`;
const cf=(url,init={})=>fetch(url,{...init,headers:{authorization:`Bearer ${cloudflareToken}`,'content-type':'application/json',...init.headers}});
const existing=await cf(doneUrl);
if(existing.ok){console.log('Gateway Google authorization is already installed.');process.exit(0)}
if(existing.status!==404)throw new Error(`Cloudflare KV check: HTTP ${existing.status}`);
const installToken=randomBytes(32).toString('base64url');
const created=await cf(secretUrl,{method:'PUT',body:JSON.stringify({name:'GOOGLE_INSTALL_TOKEN',type:'secret_text',text:installToken})});
if(!created.ok)throw new Error(`Temporary installation credential: HTTP ${created.status}`);
let stopped=false;
process.on('SIGINT',()=>{stopped=true});process.on('SIGTERM',()=>{stopped=true});
const server=createServer((req,res)=>{
 if(req.url!=='/start'){res.writeHead(404);res.end();return}
 res.writeHead(302,{'location':`${origin}/oauth/google/install?token=${encodeURIComponent(installToken)}`,'cache-control':'no-store','referrer-policy':'no-referrer'});res.end();
});
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 console.log(`OPEN_BROWSER=http://127.0.0.1:${server.address().port}/start`);
 const deadline=Date.now()+15*60*1000;
 let installed=false;
 while(!stopped&&Date.now()<deadline){
  await new Promise(resolve=>setTimeout(resolve,5000));
  const result=await cf(doneUrl);
  if(result.ok){installed=true;console.log('Encrypted Google gateway authorization installed.');break}
  if(result.status!==404)throw new Error(`Installation status HTTP ${result.status}`);
 }
 if(!installed)throw new Error('Authorization incomplete. Temporary installation access will be removed.');
}finally{
 server.close();
 const removed=await cf(`${secretUrl}/GOOGLE_INSTALL_TOKEN`,{method:'DELETE'});
 console.log(`Temporary installation credential removed: ${removed.ok}`);
 if(!removed.ok)process.exitCode=1;
}
