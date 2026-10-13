import { GBPControl } from '../.local/test/control.mjs';
export function attachControl(env){const data=new Map();let queue=Promise.resolve();const storage={
 get:async k=>structuredClone(data.get(k)),put:async(k,v)=>data.set(k,structuredClone(v)),delete:async k=>data.delete(k),
 list:async({prefix='',limit=1000,reverse=false}={})=>new Map([...data].filter(([k])=>k.startsWith(prefix)).sort(([a],[b])=>reverse?b.localeCompare(a):a.localeCompare(b)).slice(0,limit)),
 setAlarm:async t=>data.set('alarm',t),deleteAlarm:async()=>data.delete('alarm'),
 transaction:fn=>{const run=queue.then(()=>fn(storage));queue=run.catch(()=>{});return run;},
};const object=new GBPControl({storage},env);env.GBP_CONTROL={idFromName:x=>x,get:()=>({fetch:(url,init)=>object.fetch(new Request(url,init))})};env.controlData=data;env.controlObject=object;return env;}
