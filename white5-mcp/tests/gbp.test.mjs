import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { invoke, schemas, toolDefinitions, WRITES } from '../.local/test/operations.mjs';
import { googleRequest, refreshAccessToken, classifyGoogleError } from '../.local/test/client.mjs';
import { authHandler } from '../.local/test/auth.mjs';
import { saveInternalGoogleRefreshToken, loadInternalGoogleRefreshToken } from '../.local/test/stored.mjs';
import { health } from '../.local/test/health.mjs';
import { aliases, upstream } from '../.local/test/catalog.mjs';
import { createServer } from '../.local/test/gateway.mjs';
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const storage = new Map();
const env = { GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret', ALLOWED_GOOGLE_EMAIL: 'test@example.com', OAUTH_KV: { get: async (k, type) => type === 'json' ? JSON.parse(storage.get(k) || 'null') : storage.get(k) || null, put: async (k,v) => storage.set(k,v), delete: async k => storage.delete(k) } };
const props = { userId: 'test', refreshToken: 'refresh-secret', scopes: ['business:read','business:write'] };
const parse = result => JSON.parse(result.content[0].text);
const example = {
  prepare_post: {account:'1',location:'2',post:{summary:'Example',callToAction:{actionType:'LEARN_MORE',url:'https://white5.ca'},media:[{sourceUrl:'https://white5.ca/photo.jpg'}]}},
  create_post: {account:'1',location:'2',post:{summary:'Example'}},
  update_post: {postName:'accounts/1/locations/2/localPosts/3',post:{summary:'Updated'}},
  delete_post: {postName:'accounts/1/locations/2/localPosts/3'},
  reply_to_review: {reviewName:'accounts/1/locations/2/reviews/3',comment:'Thanks'},
  update_location: {location:'2',changes:{websiteUri:'https://white5.ca'}},
  set_primary_location: {account:'1',location:'2'},
};
test('all mutations and draft preparation validate locally without any fetch or credentials', async () => {
  globalThis.fetch = () => { throw new Error('Unexpected network call'); };
  for (const name of [...WRITES, 'prepare_post']) {
    const result = parse(await invoke(env, undefined, name, example[name]));
    assert.equal(result.executed, false, name); assert.equal(result.preview, true, name);
  }
});
test('reject malformed paths, URL credential leaks, invalid CTA, dates and unknown write fields', () => {
  for (const value of ['accounts/1?x=1','../1','1/reviews/2','https://evil.test','accounts/%2e%2e']) assert.equal(schemas.list_locations.safeParse({account:value}).success,false);
  for (const post of [{summary:'ok',callToAction:{actionType:'CALL',url:'https://white5.ca'}},{summary:'ok',callToAction:{actionType:'BOOK'}},{summary:'ok',media:[{sourceUrl:'https://secret:pw@example.com/x'}]},{summary:'ok',state:'LIVE'},{}]) assert.equal(schemas.create_post.safeParse({account:'1',location:'2',post}).success,false);
  assert.equal(schemas.get_performance.safeParse({location:'2',startDate:'2026-02-30',endDate:'2026-03-01'}).success,false);
  assert.equal(schemas.update_location.safeParse({location:'2',changes:{openInfo:{status:'CLOSED_PERMANENTLY'}}}).success,false);
});
test('confirmed writes require write scope; API calls use exact method, body and narrow masks', async () => {
  const requests=[];
  globalThis.fetch = async (url,init) => { requests.push({url:String(url),init}); return Response.json(String(url).includes('oauth2') ? {access_token:'access-secret'} : {}); };
  await assert.rejects(invoke(env,{...props,scopes:['business:read']},'create_post',{...example.create_post,confirmed:true}));
  assert.equal(requests.length,0);
  await invoke(env,props,'update_post',{...example.update_post,confirmed:true});
  assert.equal(requests[1].init.method,'PATCH');
  assert.equal(new URL(requests[1].url).searchParams.get('updateMask'),'summary');
  assert.deepEqual(JSON.parse(requests[1].init.body),{summary:'Updated'});
  requests.length=0;
  const validation = parse(await invoke(env,props,'update_location',{...example.update_location,confirmed:true}));
  assert.equal(validation.validated,true); assert.equal(validation.executed,false);
  assert.equal(new URL(requests[1].url).searchParams.get('validateOnly'),'true');
});
test('401, disabled API, insufficient scope, ambiguous permission, 404 and 429 are distinct and safe', () => {
  const disabled = {error:{message:'credential access-secret',details:[{'@type':'type.googleapis.com/google.rpc.ErrorInfo',reason:'SERVICE_DISABLED'}]}};
  assert.equal(classifyGoogleError(401,{}).category,'authentication_failed');
  assert.equal(classifyGoogleError(403,disabled).category,'api_disabled');
  assert.equal(classifyGoogleError(403,{error:{details:[{'@type':'x/ErrorInfo',reason:'ACCESS_TOKEN_SCOPE_INSUFFICIENT'}]}}).category,'insufficient_scope');
  assert.equal(classifyGoogleError(403,{}).category,'permission_denied');
  assert.equal(classifyGoogleError(404,{}).category,'not_found_or_unavailable');
  assert.equal(classifyGoogleError(429,{},45).retryAfter,45);
  assert.equal(classifyGoogleError(429,{error:{message:'Quota limit 0'}}).category,'project_quota_zero');
  assert.equal(JSON.stringify(classifyGoogleError(403,disabled)).includes('access-secret'),false);
});
test('GET retries transient failures; POST never retries; Retry-After is respected', async () => {
  let count=0;
  globalThis.fetch=async()=> ++count<3 ? Response.json({}, {status:503,headers:{'retry-after':'0'}}) : Response.json({ok:true});
  assert.equal((await googleRequest('x','https://mybusiness.googleapis.com/v4/accounts/1')).ok,true); assert.equal(count,3);
  count=0; globalThis.fetch=async()=>{count++;return Response.json({}, {status:429,headers:{'retry-after':'30'}})};
  await assert.rejects(googleRequest('x','https://mybusiness.googleapis.com/v4/accounts/1'),e=>e.status===429&&e.retryAfter===30); assert.equal(count,1);
  count=0; globalThis.fetch=async()=>{count++;return Response.json({}, {status:503})};
  await assert.rejects(googleRequest('x','https://mybusiness.googleapis.com/v4/accounts/1',{method:'POST',body:'{}'})); assert.equal(count,1);
});
test('token refresh validates scope and never returns raw OAuth error details', async()=>{
  globalThis.fetch=async()=>Response.json({access_token:'secret',scope:'https://www.googleapis.com/auth/adwords'});
  await assert.rejects(refreshAccessToken(env,'test'),e=>e.category==='insufficient_scope');
  globalThis.fetch=async()=>Response.json({error:'invalid_grant',error_description:'refresh-secret'}, {status:400});
  await assert.rejects(refreshAccessToken(env,'test'),e=>e.category==='authentication_failed'&&!e.message.includes('refresh-secret'));
});
test('permissions and performance use documented endpoints and query fields',async()=>{
  const urls=[];
  globalThis.fetch=async(url,init)=>{urls.push(String(url));assert.equal(init.redirect,'manual');return Response.json(String(url).includes('oauth2')?{access_token:'secret'}:{})};
  await invoke(env,props,'get_location_permissions',{location:'2'});
  assert.ok(urls.includes('https://mybusinessverifications.googleapis.com/v1/locations/2/VoiceOfMerchantState'));
  await invoke(env,props,'get_performance',{location:'2',startDate:'2026-09-01',endDate:'2026-09-30',metrics:['WEBSITE_CLICKS','CALL_CLICKS']});
  const url=new URL(urls.at(-1));assert.equal(url.pathname,'/v1/locations/2:fetchMultiDailyMetricsTimeSeries');assert.deepEqual(url.searchParams.getAll('dailyMetrics'),['WEBSITE_CLICKS','CALL_CLICKS']);assert.equal(url.searchParams.get('dailyRange.start_date.month'),'9');
});
test('encrypted KV token storage and ciphertext tampering',async()=>{
  storage.clear(); await saveInternalGoogleRefreshToken(env,'sensitive-refresh-value');
  assert.equal([...storage.values()].join('').includes('sensitive-refresh-value'),false);
  assert.equal(await loadInternalGoogleRefreshToken(env),'sensitive-refresh-value');
  const key=[...storage.keys()][0]; const data=JSON.parse(storage.get(key)); data.ciphertext='AAAA'; storage.set(key,JSON.stringify(data));
  assert.equal(await loadInternalGoogleRefreshToken(env),null);
});
test('OAuth initiation binds browser cookie; callback rejects missing and replayed state before token exchange',async()=>{
  storage.clear(); let calls=0; globalThis.fetch=async()=>{calls++;throw new Error('Unexpected OAuth call')};
  const authEnv={...env,OAUTH_PROVIDER:{parseAuthRequest:async()=>({clientId:'client',redirectUri:'https://example.com/cb',scope:['business:read']}),lookupClient:async()=>({clientName:'test'})}};
  const start=await authHandler.fetch(new Request('https://example.test/authorize'),authEnv,{});
  assert.match(start.headers.get('set-cookie'),/Secure; HttpOnly; SameSite=Lax/);
  const state=new URL(start.headers.get('location')).searchParams.get('state');
  const callback=new Request(`https://example.test/oauth/google/callback?state=${state}&code=test`);
  assert.equal((await authHandler.fetch(callback,authEnv,{})).status,400);
  assert.equal((await authHandler.fetch(callback,authEnv,{})).status,400); assert.equal(calls,0);
});
test('catalog advertises every requested alias and leaves other providers unchanged',async()=>{
  const names=aliases.map(x=>x.name);
  for(const name of ['get_gbp_status','list_gbp_accounts','list_gbp_locations','get_gbp_location','list_gbp_posts','create_gbp_post','update_gbp_post','delete_gbp_post','list_gbp_reviews','get_gbp_review','reply_gbp_review']) assert.ok(names.includes(name),name);
  assert.equal(new Set(names).size,names.length);
  const original=JSON.parse(await readFile(new URL('../src/upstream-tools.json',import.meta.url),'utf8'));
  for(const provider of ['zoho','square','google_ads','meta_ads']) assert.deepEqual(upstream[provider],original[provider]);
  assert.equal(toolDefinitions.length,16);
});
test('missing GBP does not fail healthy integrations; public Zoho health is explicitly unchecked',async()=>{
  const binding={status:async()=>({configured:true}),rpc:async()=>({content:[{type:'text',text:'{}'}]})};
  const response=await health({ZOHO:binding,SQUARE:binding,GOOGLE_ADS:binding,META_ADS:binding});
  const data=await response.json(); assert.equal(response.status,200); assert.equal(data.services.gbp,false); assert.equal(data.services.zoho,null); assert.equal(data.services.square,true);
});

test('health reports partial GBP API access as degraded while preserving connected status',async()=>{
  const binding={status:async()=>({connected:true,capabilities:{accounts:{available:true},posts:{available:false,category:'api_disabled'}}}),rpc:async()=>({content:[{type:'text',text:'{}'}]})};
  const response=await health({ZOHO:binding,SQUARE:binding,GOOGLE_ADS:binding,META_ADS:binding,GOOGLE_BUSINESS:binding},'test');
  const data=await response.json(); assert.equal(response.status,200); assert.equal(data.services.gbp,true); assert.equal(data.degraded,true);
});
test('MCP protocol tools/list includes GBP; calls route to provider; unconfirmed writes are previews',async()=>{
  const calls=[];
  const binding={rpc:async request=>{calls.push(request);return {content:[{type:'text',text:JSON.stringify({ok:true,confirmed:request.arguments?.confirmed})}]}}};
  const server=createServer({GOOGLE_BUSINESS:binding}, {scopes:['white5:read','white5:write'],accessToken:'test-gateway-token'});
  const pending=new Map(); let id=0;
  const transport={start:async()=>{},close:async()=>{},send:async message=>pending.get(message.id)?.(message)};
  await server.connect(transport);
  const rpc=(method,params)=>new Promise(resolve=>{const requestId=++id;pending.set(requestId,resolve);transport.onmessage({jsonrpc:'2.0',id:requestId,method,params})});
  try {
    const init=await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'test',version:'1'}}); assert.ok(init.result);
    const listed=await rpc('tools/list',{}); assert.ok(listed.result.tools.some(t=>t.name==='get_gbp_status'));
    const read=await rpc('tools/call',{name:'list_gbp_accounts',arguments:{}}); assert.equal(read.result.isError,undefined); assert.equal(calls.at(-1).name,'list_accounts');
    await rpc('tools/call',{name:'create_gbp_post',arguments:example.create_post}); assert.equal(calls.at(-1).arguments.confirmed,false);
    const denied=await rpc('tools/call',{name:'run_provider_read_tool',arguments:{provider:'google_business',tool_name:'delete_post',arguments:example.delete_post}}); assert.equal(denied.result.isError,true);
  } finally {await server.close()}
});
