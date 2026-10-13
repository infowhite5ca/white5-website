import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { invoke, schemas, toolDefinitions, WRITES } from '../.local/test/operations.mjs';
import { googleRequest, refreshAccessToken, classifyGoogleError } from '../.local/test/client.mjs';
import { authHandler } from '../.local/test/auth.mjs';
import { saveInternalGoogleRefreshToken, loadInternalGoogleRefreshToken } from '../.local/test/stored.mjs';
import { health } from '../.local/test/health.mjs';
import { aliases, upstream } from '../.local/test/catalog.mjs';
import { createServer } from '../.local/test/gateway.mjs';
import approvedWorker from '../.local/test/approved.mjs';
import { stagePhoto } from '../.local/test/media.mjs';
import { attachControl } from './helpers.mjs';
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const storage = new Map();
const env = { GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret', ALLOWED_GOOGLE_EMAIL: 'test@example.com', OAUTH_KV: { get: async (k, type) => type === 'json' ? JSON.parse(storage.get(k) || 'null') : storage.get(k) || null, put: async (k,v) => storage.set(k,v), delete: async k => storage.delete(k) } };
attachControl(env);
const props = { userId: 'test', refreshToken: 'refresh-secret', scopes: ['business:read','business:write'] };
const parse = result => JSON.parse(result.content[0].text);

// A real PNG fixture with deterministic noise; no user/customer photo is used.
function photoPng(width=256,height=256) {
  const chunk=(type,data)=>{
    const name=Buffer.from(type), payload=Buffer.concat([name,data]);let crc=0xffffffff;
    for(const byte of payload){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}
    const length=Buffer.alloc(4),sum=Buffer.alloc(4);length.writeUInt32BE(data.length);sum.writeUInt32BE((crc^0xffffffff)>>>0);
    return Buffer.concat([length,payload,sum]);
  };
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
  const scan=Buffer.alloc((width*3+1)*height);let seed=12345;
  for(let y=0;y<height;y++)for(let x=1;x<=width*3;x++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;scan[y*(width*3+1)+x]=seed&255}
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(scan)),chunk('IEND',Buffer.alloc(0))]);
}
function photoEnv() {
  const photos=new Map();
  return {...env,photos,OAUTH_KV:{...env.OAUTH_KV,
    put:async(key,value,options)=>photos.set(key,{value,options}),
    getWithMetadata:async key=>{const entry=photos.get(key);return {value:entry?.value??null,metadata:entry?.options.metadata??null}},
  }};
}

test('upload preview is local, redacts signed URLs, and real upload requires write scope',async()=>{
  let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({access_token:'test'})};
  const preview=parse(await invoke(env,props,'upload_media',example.upload_media));
  assert.equal(preview.published,false);assert.equal(preview.preview,true);
  assert.equal(JSON.stringify(preview).includes('private-test-signature'),false);
  await assert.rejects(invoke(env,{...props,scopes:['business:read']},'upload_media',{...example.upload_media,confirmed:true}));
  assert.equal(calls,1);
});

test('real photo staging uses no bearer, expires in KV, and serves original bytes through the public route',async()=>{
  const fixture=photoPng(), mediaEnv=photoEnv();let calls=0;
  globalThis.fetch=async(url,init)=>{
    calls++;assert.equal(url,example.upload_media.file.download_url);assert.equal(init.redirect,'manual');
    assert.equal(new Headers(init.headers).has('authorization'),false);
    return new Response(fixture,{headers:{'content-type':'image/png','content-length':String(fixture.length)}});
  };
  const result=await stagePhoto(mediaEnv,example.upload_media.file);
  assert.equal(calls,1);assert.equal(result.uploaded,true);assert.equal(result.published,false);
  assert.equal(result.width,256);assert.equal(result.height,256);assert.equal(result.sizeBytes,fixture.length);
  assert.match(result.sourceUrl,/^https:\/\/white5-google-business-mcp\.[^/]+\/media\/photo\/[a-f0-9]{64}$/);
  const stored=[...mediaEnv.photos.values()][0];assert.equal(stored.options.expirationTtl,72*3600);
  assert.equal(JSON.stringify(stored.options).includes('private-test-signature'),false);
  const response=await authHandler.fetch(new Request(result.sourceUrl),mediaEnv,{});
  assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');
  assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),fixture);
  const head=await authHandler.fetch(new Request(result.sourceUrl,{method:'HEAD'}),mediaEnv,{});
  assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);
  stored.options.metadata.expiresAt=Date.now()-1;
  assert.equal((await authHandler.fetch(new Request(result.sourceUrl),mediaEnv,{})).status,404);
  assert.equal((await authHandler.fetch(new Request(result.sourceUrl,{method:'POST'}),mediaEnv,{})).status,405);
  assert.equal((await authHandler.fetch(new Request('https://example.test/media/photo/../../secret'),mediaEnv,{})).status,404);
});

test('attachment downloads reject SSRF, redirects, expiry and raw error leakage before storage',async()=>{
  let calls=0;const mediaEnv=photoEnv();
  globalThis.fetch=async()=>{calls++;throw new Error('sensitive URL secret')};
  for(const url of ['http://files.oaiusercontent.com/a','https://127.0.0.1/a','https://[::1]/a','https://169.254.169.254/latest','https://files.oaiusercontent.com.evil.test/a','https://user:secret@files.oaiusercontent.com/a','https://files.oaiusercontent.com:444/a','file:///tmp/a']) {
    await assert.rejects(invoke(mediaEnv,props,'upload_media',{file:{...example.upload_media.file,download_url:url},confirmed:true}));
  }
  assert.equal(calls,0);
  for(const status of [302,401,403,404,429]) {
    globalThis.fetch=async()=>new Response(null,{status,headers:{location:'https://127.0.0.1/'}});
    await assert.rejects(stagePhoto(mediaEnv,example.upload_media.file),error=>error.category==='invalid_media'&&!error.message.includes('private-test-signature'));
  }
  globalThis.fetch=async()=>{throw new Error(example.upload_media.file.download_url)};
  await assert.rejects(stagePhoto(mediaEnv,example.upload_media.file),error=>!error.message.includes('private-test-signature'));
  assert.equal(mediaEnv.photos.size,0);
});

test('attachment validation rejects MIME mismatches, unsupported/truncated images, dimensions and excessive bytes',async()=>{
  const mediaEnv=photoEnv(), good=photoPng();
  for(const [bytes,type] of [[good,'image/jpeg'],[Buffer.alloc(20000),'image/png'],[good.subarray(0,good.length-12),'image/png'],[photoPng(249,256),'image/png'],[Buffer.alloc(100),'image/png']]) {
    globalThis.fetch=async()=>new Response(bytes,{headers:{'content-type':type}});
    await assert.rejects(stagePhoto(mediaEnv,example.upload_media.file),error=>error.category==='invalid_media');
  }
  globalThis.fetch=async()=>new Response(good,{headers:{'content-length':String(6*1024*1024)}});
  await assert.rejects(stagePhoto(mediaEnv,example.upload_media.file),error=>error.status===413);
  let cancelled=false;
  globalThis.fetch=async()=>new Response(new ReadableStream({pull(c){c.enqueue(new Uint8Array(1024*1024))},cancel(){cancelled=true}}));
  await assert.rejects(stagePhoto(mediaEnv,example.upload_media.file),error=>error.status===413);
  assert.equal(cancelled,true);assert.equal(mediaEnv.photos.size,0);
});

test('JPEG headers are accepted with optional file metadata omitted',async()=>{
  const mediaEnv=photoEnv(), jpeg=Buffer.alloc(11000);
  // SOI, SOF0 (8-bit, 256x256, one component), EOI: header inspection fixture.
  Buffer.from([255,216,255,192,0,11,8,1,0,1,0,1,1,17,0]).copy(jpeg);jpeg[jpeg.length-2]=255;jpeg[jpeg.length-1]=217;
  globalThis.fetch=async()=>new Response(jpeg,{headers:{'content-type':'image/jpeg'}});
  const result=await stagePhoto(mediaEnv,{download_url:example.upload_media.file.download_url});
  assert.equal(result.mimeType,'image/jpeg');assert.equal(result.width,256);
});

test('gallery writes need a state-bound preview and read back the accepted item',async()=>{
  const requests=[];const local=attachControl({...env});
  globalThis.fetch=async(url,init)=>{requests.push({url:String(url),init});return Response.json(String(url).includes('oauth2')?{access_token:'test'}:{name:'accounts/1/locations/2/media/3'})};
  const args={...example.create_media,category:'AT_WORK',description:'Window cleaning'};
  const preview=parse(await invoke(local,props,'create_media',args));
  assert.equal(preview.preview,true);assert.equal(requests.some(r=>r.init?.method==='POST'&&!r.url.includes('oauth2')),false);
  await invoke(local,props,'create_media',{...args,confirmed:true,previewId:preview.previewId});
  const write=requests.find(r=>r.init?.method==='POST'&&!r.url.includes('oauth2'));
  assert.deepEqual(JSON.parse(write.init.body),{mediaFormat:'PHOTO',sourceUrl:'https://white5.ca/photo.jpg',locationAssociation:{category:'AT_WORK'},description:'Window cleaning'});
  assert.ok(requests.some(r=>r.url==='https://mybusiness.googleapis.com/v4/accounts/1/locations/2/media/3'));
  assert.equal(schemas.create_media.safeParse({...example.create_media,category:'COVER',description:'invalid'}).success,false);
  await invoke(local,props,'list_media',{account:'1',location:'2',pageSize:10,pageToken:'next page'});
  assert.equal(new URL(requests.at(-1).url).searchParams.get('pageToken'),'next page');
});

test('approved-project adapter preserves legacy public discovery and rejects unauthorized installation',async()=>{
  const context={waitUntil:()=>{}};
  const approvedEnv={...env,MCP_PUBLIC_ORIGIN:'https://example.test'};
  const root=await approvedWorker.fetch(new Request('https://example.test/'),approvedEnv,context);
  assert.deepEqual((await root.json()).tools,['list_business_accounts','list_locations','get_location']);
  const metadata=await approvedWorker.fetch(new Request('https://example.test/.well-known/oauth-authorization-server'),approvedEnv,context);
  assert.deepEqual((await metadata.json()).scopes_supported,['business-profile:read']);
  assert.equal((await approvedWorker.fetch(new Request('https://example.test/mcp'),approvedEnv,context)).status,401);
  assert.equal((await approvedWorker.fetch(new Request('https://example.test/oauth/google/install?token=bad'),approvedEnv,context)).status,403);
  const start=await approvedWorker.fetch(new Request('https://example.test/oauth/google/install?token=temporary-test'),{...approvedEnv,GOOGLE_INSTALL_TOKEN:'temporary-test'},context);
  assert.equal(start.status,302);
  const google=new URL(start.headers.get('location'));
  assert.equal(google.searchParams.get('client_id'),'test-client');
  assert.equal(google.searchParams.get('redirect_uri'),'https://example.test/oauth/google/callback');
  assert.match(start.headers.get('set-cookie'),/Secure; HttpOnly/);
  const rejected=await approvedWorker.fetch(new Request(`https://example.test/oauth/google/callback?state=${google.searchParams.get('state')}&code=bad`),approvedEnv,context);
  assert.equal(rejected.status,400);assert.match(await rejected.text(),/browser state did not match/);
  assert.equal((await approvedWorker.fetch(new Request('https://example.test/oauth/google/callback?state=old&code=bad'),approvedEnv,context)).status,400);
});
const example = {
  upload_media: {file:{download_url:'https://files.oaiusercontent.com/photo?sig=private-test-signature',file_id:'file-test',mime_type:'image/png',file_name:'photo.png'}},
  create_media: {account:'1',location:'2',sourceUrl:'https://white5.ca/photo.jpg'},
  prepare_post: {account:'1',location:'2',post:{summary:'Example',callToAction:{actionType:'LEARN_MORE',url:'https://white5.ca'},media:[{sourceUrl:'https://white5.ca/photo.jpg'}]}},
  create_post: {account:'1',location:'2',post:{summary:'Example'}},
  update_post: {postName:'accounts/1/locations/2/localPosts/3',post:{summary:'Updated'}},
  delete_post: {postName:'accounts/1/locations/2/localPosts/3'},
  reply_to_review: {reviewName:'accounts/1/locations/2/reviews/3',comment:'Thanks'},
  update_location: {location:'2',changes:{websiteUri:'https://white5.ca'}},
  set_primary_location: {account:'1',location:'2'},
};
test('local post preparation is read only; authenticated writes fail closed without approval storage', async()=>{
 globalThis.fetch=async()=>Response.json({access_token:'test'});
 const preview=parse(await invoke(env,undefined,'prepare_post',example.prepare_post));assert.equal(preview.preview,true);
 await assert.rejects(invoke({...env,GBP_CONTROL:undefined},props,'upload_media',example.upload_media),e=>e.category==='not_configured');
});
test('reject malformed paths, URL credential leaks, invalid CTA, dates and unknown write fields', () => {
  for (const value of ['accounts/1?x=1','../1','1/reviews/2','https://evil.test','accounts/%2e%2e']) assert.equal(schemas.list_locations.safeParse({account:value}).success,false);
  for (const post of [{summary:'ok',callToAction:{actionType:'CALL',url:'https://white5.ca'}},{summary:'ok',callToAction:{actionType:'BOOK'}},{summary:'ok',media:[{sourceUrl:'https://secret:pw@example.com/x'}]},{summary:'ok',state:'LIVE'},{}]) assert.equal(schemas.create_post.safeParse({account:'1',location:'2',post}).success,false);
  assert.equal(schemas.get_performance.safeParse({location:'2',startDate:'2026-02-30',endDate:'2026-03-01'}).success,false);
  assert.equal(schemas.update_location.safeParse({location:'2',changes:{openInfo:{status:'CLOSED_PERMANENTLY'}}}).success,false);
});
test('confirmed writes require scope and preview; narrow masks and Google validation remain intact',async()=>{
 const requests=[],local=attachControl({...env});globalThis.fetch=async(url,init)=>{requests.push({url:String(url),init});return Response.json(String(url).includes('oauth2')?{access_token:'test'}:{});};
 await assert.rejects(invoke(local,{...props,scopes:['business:read']},'create_post',{...example.create_post,confirmed:true}));assert.equal(requests.length,0);
 const preview=parse(await invoke(local,props,'update_post',{...example.update_post,confirmed:true}));assert.equal(preview.preview,true);assert.equal(requests.some(r=>r.init?.method==='PATCH'),false);
 await invoke(local,props,'update_post',{...example.update_post,confirmed:true,previewId:preview.previewId});const patch=requests.find(r=>r.init?.method==='PATCH');assert.equal(new URL(patch.url).searchParams.get('updateMask'),'summary');assert.deepEqual(JSON.parse(patch.init.body),{summary:'Updated'});
 const p=parse(await invoke(local,props,'update_location',example.update_location));const result=parse(await invoke(local,props,'update_location',{...example.update_location,confirmed:true,previewId:p.previewId}));assert.equal(result.validated,true);assert.equal(result.executed,false);
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

test('structured zero-quota errors preserve safe Google evidence and do not retry',async()=>{
  const payload={error:{status:'RESOURCE_EXHAUSTED',message:'credential access-secret',details:[{'@type':'type.googleapis.com/google.rpc.ErrorInfo',reason:'RATE_LIMIT_EXCEEDED',metadata:{consumer:'projects/686968841791',service:'mybusinessaccountmanagement.googleapis.com',quota_limit_value:'0',quota_limit:'DefaultRequestsPerMinutePerProject',quota_metric:'mybusinessaccountmanagement.googleapis.com/default_requests',quota_location:'global',access_token:'access-secret',arbitrary:'refresh-secret'}}]}};
  let count=0;globalThis.fetch=async()=>{count++;return Response.json(payload,{status:429})};
  await assert.rejects(googleRequest('x','https://mybusinessaccountmanagement.googleapis.com/v1/accounts'),error=>{
    assert.equal(error.category,'project_quota_zero');
    assert.equal(error.google.status,'RESOURCE_EXHAUSTED');
    assert.equal(error.google.metadata.consumer,'projects/686968841791');
    assert.equal(error.google.metadata.quota_limit_value,'0');
    assert.equal(JSON.stringify(error).includes('secret'),false);
    return true;
  });
  assert.equal(count,1);
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
test('status distinguishes successful OAuth refresh from zero-quota account access',async()=>{
  globalThis.fetch=async url=>String(url).includes('oauth2')?Response.json({access_token:'secret'}):Response.json({error:{status:'RESOURCE_EXHAUSTED',details:[{'@type':'x/ErrorInfo',reason:'RATE_LIMIT_EXCEEDED',metadata:{quota_limit_value:'0'}}]}},{status:429});
  const result=parse(await invoke(env,props,'connection_status',{}));
  assert.equal(result.tokenRefresh,true);assert.equal(result.connected,false);
  assert.equal(result.capabilities.accounts.category,'project_quota_zero');
  assert.equal(result.capabilities.reviews.available,null);
});

test('permissions and performance use documented endpoints and query fields',async()=>{
  const urls=[];
  globalThis.fetch=async(url,init)=>{urls.push(String(url));assert.equal(init.redirect,'manual');return Response.json(String(url).includes('oauth2')?{access_token:'secret'}:{})};
  await invoke(env,props,'get_location_permissions',{location:'2'});
  assert.ok(urls.includes('https://mybusinessverifications.googleapis.com/v1/locations/2/VoiceOfMerchantState'));
  await invoke(env,props,'get_performance',{location:'2',startDate:'2026-09-01',endDate:'2026-09-30',metrics:['WEBSITE_CLICKS','CALL_CLICKS']});
  const url=new URL(urls.at(-1));assert.equal(url.pathname,'/v1/locations/2:fetchMultiDailyMetricsTimeSeries');assert.deepEqual(url.searchParams.getAll('dailyMetrics'),['WEBSITE_CLICKS','CALL_CLICKS']);assert.equal(url.searchParams.get('dailyRange.startDate.month'),'9');
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
  assert.equal(toolDefinitions.length,74);
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
    const upload = listed.result.tools.find(t=>t.name==='upload_media');
    assert.deepEqual(upload._meta['openai/fileParams'],['file']);
    const fileSchema=upload.inputSchema.properties.file;
    assert.deepEqual([...fileSchema.required].sort(),['download_url','file_id']);
    for(const property of ['download_url','file_id','mime_type','file_name']) assert.ok(fileSchema.properties[property]);
    assert.equal(upload.annotations.readOnlyHint,false);
    await rpc('tools/call',{name:'upload_media',arguments:example.upload_media});
    assert.equal(calls.at(-1).name,'upload_media');assert.equal(calls.at(-1).arguments.confirmed,false);
    assert.deepEqual(calls.at(-1).arguments.file,example.upload_media.file);
    const advancedPreview=await rpc('tools/call',{name:'run_provider_write_tool',arguments:{provider:'google_business',tool_name:'upload_media',arguments:example.upload_media,confirmed:true}});
    assert.equal(JSON.stringify(advancedPreview).includes('private-test-signature'),false);
    const read=await rpc('tools/call',{name:'list_gbp_accounts',arguments:{}}); assert.equal(read.result.isError,undefined); assert.equal(calls.at(-1).name,'list_accounts');
    await rpc('tools/call',{name:'create_gbp_post',arguments:example.create_post}); assert.equal(calls.at(-1).arguments.confirmed,false);
    const denied=await rpc('tools/call',{name:'run_provider_read_tool',arguments:{provider:'google_business',tool_name:'delete_post',arguments:example.delete_post}}); assert.equal(denied.result.isError,true);
  } finally {await server.close()}
});
