import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const config=await readFile(join(process.env.APPDATA,'xdg.config/.wrangler/config/default.toml'),'utf8');
const token=config.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
if(!token)throw new Error('Cloudflare login unavailable');
const dir=new URL(`../.local/backups/${new Date().toISOString().replaceAll(':','-')}/`,import.meta.url);
await mkdir(dir,{recursive:true});
const base='https://api.cloudflare.com/client/v4/accounts/bf77f2b4dd0f909b5b1d1d7d89389cc4/workers';
const manifest=[];
for(const worker of ['white5-mcp','white5-google-business-mcp']){
 const headers={authorization:`Bearer ${token}`};
 for(const part of ['settings','deployments']){
  const response=await fetch(`${base}/scripts/${worker}/${part}`,{headers});
  if(!response.ok)throw new Error(`Backup ${part} failed ${response.status}`);
  await writeFile(new URL(`${worker}-${part}.json`,dir),JSON.stringify(await response.json(),null,2));
 }
 const response=await fetch(`${base}/services/${worker}/environments/production/content`,{headers});
 if(!response.ok)throw new Error(`Source backup failed ${response.status}`);
 for(const [part,value] of await response.formData()){
  const name=typeof value==='string'?part:value.name;
  const bytes=Buffer.from(typeof value==='string'?value:await value.arrayBuffer());
  await writeFile(new URL(`${worker}-${name.replaceAll('/','_')}`,dir),bytes);
  manifest.push({worker,module:name,sha256:createHash('sha256').update(bytes).digest('hex')});
 }
}
for(const [name,path] of [['gateway','../wrangler.jsonc'],['gbp','../../google-business-profile-mcp/wrangler.jsonc']])await copyFile(new URL(path,import.meta.url),new URL(`${name}-local-wrangler.jsonc`,dir));
await writeFile(new URL('manifest.json',dir),JSON.stringify(manifest,null,2));
console.log(JSON.stringify({backup:dir.pathname,modules:manifest}));
