import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {invoke,schemas,toolDefinitions} from '../.local/test/operations.mjs';
import {mergeServices,serviceKey} from '../.local/test/services.mjs';
import {metricTotals,managementRead} from '../.local/test/reads.mjs';
import {MovieScanner} from '../.local/test/video.mjs';
import {attachControl} from './helpers.mjs';
const original=globalThis.fetch;afterEach(()=>globalThis.fetch=original);
const props={userId:'owner',refreshToken:'test',scopes:['business:read','business:write']};
const env=()=>attachControl({GOOGLE_CLIENT_ID:'test',GOOGLE_CLIENT_SECRET:'test',OAUTH_KV:{get:async()=>null,put:async()=>{}}});
const parse=r=>JSON.parse(r.content[0].text);
const category='categories/gcid:window_cleaning_service';
const types={categories:[{name:category,serviceTypes:[{serviceTypeId:'job_type_id:window_cleaning'}]}]};
const structured={structuredServiceItem:{serviceTypeId:'job_type_id:window_cleaning'}};
const custom=name=>({freeFormServiceItem:{category,label:{displayName:name,languageCode:'en'}}});
test('service merge preserves unrelated fields and fixed Money; duplicate/unknown/ineligible edits fail',()=>{
 const other={...custom('Existing'),futureGoogleField:'preserved'};const args={upsert:[{item:{...structured,price:{currencyCode:'CAD',units:'140',nanos:0}}}],removeKeys:[]};
 const result=mergeServices([structured,other],args,types);assert.deepEqual(result[1],other);assert.equal(result[0].price.units,'140');
 assert.equal(mergeServices(result,{upsert:[{item:structured}],removeKeys:[]},types)[0].price,undefined);
 assert.throws(()=>mergeServices([structured],{upsert:[],removeKeys:['missing']},types));
 assert.throws(()=>mergeServices([],{upsert:[{item:structured},{item:structured}],removeKeys:[]},types));
 assert.throws(()=>mergeServices([],{upsert:[{item:{structuredServiceItem:{serviceTypeId:'job_type_id:fake'}}}],removeKeys:[]},types));
 for(const price of [{currencyCode:'CAD',units:'From 140'},{currencyCode:'USD',units:'140'},{currencyCode:'CAD',units:'-1'},{currencyCode:'CAD',units:'140',nanos:1e9}])assert.equal(schemas.update_services.safeParse({upsert:[{item:{...structured,price}}]}).success,false);
});
test('services publish only exact current preview, preserve unrelated services, narrow mask and read back',async()=>{
 const local=env(),writes=[];let items=[structured,custom('Unrelated')];
 globalThis.fetch=async(url,init={})=>{if(String(url).includes('oauth2'))return Response.json({access_token:'x'});if(String(url).includes('categories:batchGet'))return Response.json(types);if(init.method==='PATCH'){writes.push({url,body:JSON.parse(init.body)});items=JSON.parse(init.body).serviceItems;}return Response.json({name:'locations/2',categories:{primaryCategory:{name:category}},serviceItems:items,metadata:{canModifyServiceList:true}});};
 const args={location:'2',upsert:[{item:custom('Deck Cleaning')}],validateOnly:false};const preview=parse(await invoke(local,props,'update_services',args));assert.equal(writes.length,0);assert.equal(preview.after.serviceItems.length,3);
 const result=parse(await invoke(local,props,'update_services',{...args,confirmed:true,previewId:preview.previewId}));assert.equal(result.readBack.serviceItems.length,3);assert.equal(writes.length,1);assert.equal(new URL(writes[0].url).searchParams.get('updateMask'),'serviceItems');
 const replay=parse(await invoke(local,props,'update_services',{...args,confirmed:true,previewId:preview.previewId}));assert.equal(replay.replay,true);assert.equal(writes.length,1);
});
test('tampered, expired, cross-owner and stale confirmations cannot write',async()=>{
 let state='before',writes=0;globalThis.fetch=async(url,init={})=>{if(String(url).includes('oauth2'))return Response.json({access_token:'x'});if(init.method==='PATCH')writes++;return Response.json({summary:state,topicType:'STANDARD'});};
 const a={postName:'accounts/1/locations/2/localPosts/3',post:{summary:'approved'}};
 for(const mode of ['args','owner','state','expired']){const local=env();state='before';const p=parse(await invoke(local,props,'update_post',a));let args={...a,confirmed:true,previewId:p.previewId},identity=props;if(mode==='args')args.post={summary:'unapproved'};if(mode==='owner')identity={...props,userId:'other'};if(mode==='state')state='changed elsewhere';if(mode==='expired')local.controlData.get('preview:'+p.previewId).expires=0;await assert.rejects(invoke(local,identity,'update_post',args),e=>e.category==='approval_conflict');}
 assert.equal(writes,0);
});
test('concurrent identical confirmations execute one write',async()=>{
 const local=env();let writes=0;globalThis.fetch=async(url,init={})=>{if(String(url).includes('oauth2'))return Response.json({access_token:'x'});if(init.method==='PUT'){writes++;await new Promise(r=>setTimeout(r,5));}return Response.json({name:'accounts/1/locations/2/reviews/3'});};
 const args={reviewName:'accounts/1/locations/2/reviews/3',comment:'Thank you.'};const p=parse(await invoke(local,props,'reply_to_review',args));await Promise.all([1,2].map(()=>invoke(local,props,'reply_to_review',{...args,confirmed:true,previewId:p.previewId})));assert.equal(writes,1);
});
test('destructive operations require separate phrase and owners cannot be removed',async()=>{
 const local=env();let writes=0;globalThis.fetch=async(url,init={})=>{if(String(url).includes('oauth2'))return Response.json({access_token:'x'});if(init.method==='DELETE')writes++;return Response.json({admins:[{name:'locations/2/admins/3',role:'OWNER'}]});};
 await assert.rejects(invoke(local,props,'remove_manager',{name:'locations/2/admins/3'}),e=>e.category==='invalid_request');
 const a={postName:'accounts/1/locations/2/localPosts/3'},p=parse(await invoke(local,props,'delete_post',a));await assert.rejects(invoke(local,props,'delete_post',{...a,previewId:p.previewId,confirmed:true}),e=>e.category==='confirmation_required');assert.equal(writes,0);
});
test('draft and schedule previews do not create jobs or alarms; approved exact schedule does',async()=>{
 const local=env();globalThis.fetch=async(url)=>Response.json(String(url).includes('oauth2')?{access_token:'x'}:{name:'locations/2',metadata:{hasVoiceOfMerchant:true}});
 const args={account:'1',location:'2',kind:'weekly_report',runAt:new Date(Date.now()+86400000).toISOString()};const p=parse(await invoke(local,props,'schedule_job',args));assert.equal(local.controlData.has('alarm'),false);assert.equal([...local.controlData.keys()].some(k=>k.startsWith('job:')),false);
 const saved=parse(await invoke(local,props,'schedule_job',{...args,confirmed:true,previewId:p.previewId}));assert.equal(saved.value.runAt,args.runAt);assert.equal(local.controlData.has('alarm'),true);assert.equal(saved.value.id,p.after.id);
});
test('uncertain scheduled write is not repeated by alarm retries',async()=>{
 const local=env();local.GOOGLE_REFRESH_TOKEN='test';let writes=0;globalThis.fetch=async(url,init={})=>{if(String(url).includes('oauth2'))return Response.json({access_token:'x'});if(init.method==='POST'){writes++;throw new Error('network');}return Response.json({metadata:{hasVoiceOfMerchant:true}});};local.controlData.set('job:test',{id:'test',kind:'post',account:'accounts/1',location:'locations/2',post:{summary:'Approved',topicType:'STANDARD'},runAt:new Date(Date.now()-1000).toISOString(),status:'scheduled'});await local.controlObject.alarm();await local.controlObject.alarm();assert.equal(writes,1);assert.equal(local.controlData.get('job:test').status,'needs_review');
});
test('media publication never equates API acceptance with visibility',async()=>{const result=await managementRead(async()=>({mediaItems:[{name:'test',createTime:'2026-10-12'}],totalMediaItemCount:1}),'check_media_publication',{account:'1',location:'2',observedPublicCount:0});assert.equal(result.apiAcceptedCount,1);assert.equal(result.publicVisibility.available,false);assert.equal(result.userReportedPublicCount,0);});
test('missing metric values stay unavailable and zero counts remain zero',()=>{const result=metricTotals({multiDailyMetricTimeSeries:[{dailyMetricTimeSeries:[{dailyMetric:'CALL_CLICKS',timeSeries:{datedValues:[{value:'0'},{}]}},{dailyMetric:'WEBSITE_CLICKS',timeSeries:{datedValues:[{}]}}]}]});assert.deepEqual(result.CALL_CLICKS,{total:0,reportedDays:1});assert.equal(result.WEBSITE_CLICKS.total,null);});
test('events and offers validate dates, topic restrictions and CTA rules',()=>{const event={title:'Deck care',schedule:{startDate:{year:2026,month:10,day:20},endDate:{year:2026,month:10,day:21}}};const base={account:'1',location:'2',post:{topicType:'EVENT',summary:'Deck care',event}};assert.equal(schemas.create_post.safeParse(base).success,true);assert.equal(schemas.create_post.safeParse({...base,post:{...base.post,topicType:'STANDARD'}}).success,false);assert.equal(schemas.create_post.safeParse({...base,post:{...base.post,topicType:'OFFER',offer:{redeemOnlineUrl:'https://white5.ca'},callToAction:{actionType:'CALL'}}}).success,false);});
test('no Q&A or closed-location tools; attachment batch metadata is advertised',()=>{assert.equal(toolDefinitions.some(t=>/questions|answers|close_location|transfer_location|delete_location/.test(t.name)),false);assert.deepEqual(toolDefinitions.find(t=>t.name==='upload_media_batch')._meta['openai/fileParams'],['files']);assert.equal(schemas.update_notifications.safeParse({notificationTypes:['NEW_QUESTION'],pubsubTopic:''}).success,false);});
test('attachment batches route through write authorization and preview without downloading',async()=>{
 const local=env();let downloads=0;globalThis.fetch=async(url)=>{if(String(url).includes('oauth2'))return Response.json({access_token:'x'});downloads++;throw new Error('Must not download in preview');};
 const args={files:[{file_id:'file-test',download_url:'https://files.oaiusercontent.com/example.png',mime_type:'image/png'}]};
 assert.equal(toolDefinitions.find(t=>t.name==='upload_media_batch').annotations.readOnlyHint,false);
 const p=parse(await invoke(local,props,'upload_media_batch',args));assert.equal(p.preview,true);assert.equal(p.after.files.length,1);assert.equal(downloads,0);
 await assert.rejects(invoke(local,{...props,scopes:['business:read']},'upload_media_batch',{...args,confirmed:true,previewId:p.previewId}),e=>e.category==='insufficient_scope');
});
test('location-specific attribute metadata omits incompatible language/region parameters',async()=>{let called;await managementRead(async u=>{called=new URL(u);return {};},'list_attributes',{location:'2',pageSize:100});assert.equal(called.searchParams.get('parent'),'locations/2');assert.equal(called.searchParams.has('languageCode'),false);assert.equal(called.searchParams.has('regionCode'),false);});
test('attribute previews use paginated attributeMetadata and reject multi-value singleton attributes',async()=>{
 const local=env();let writes=0;
 globalThis.fetch=async(url,init={})=>{const u=new URL(url);if(u.hostname==='oauth2.googleapis.com')return Response.json({access_token:'x'});if(init.method==='PATCH')writes++;if(u.pathname==='/v1/attributes')return Response.json(u.searchParams.has('pageToken')?{attributeMetadata:[{parent:'attributes/estimate',valueType:'BOOL',repeatable:false}]}:{attributeMetadata:[],nextPageToken:'next'});return Response.json({name:'locations/2/attributes',attributes:[]});};
 const p=parse(await invoke(local,props,'update_attributes',{location:'2',attributes:[{name:'attributes/estimate',values:[true]}]}));assert.equal(p.preview,true);assert.equal(p.after.attributes[0].values[0],true);assert.equal(writes,0);
 await assert.rejects(invoke(local,props,'update_attributes',{location:'2',attributes:[{name:'attributes/estimate',values:[true,false]}]}),e=>e.category==='invalid_request');
});
test('verification discovery reports existing Voice of Merchant without initiating verification',async()=>{
 const calls=[];const result=await managementRead(async(u,init)=>{calls.push({u,init});return {hasVoiceOfMerchant:true,hasBusinessAuthority:true};},'get_verification_options',{location:'2'});assert.equal(result.status,'not_required');assert.equal(result.optionsRequested,false);assert.equal(calls.length,1);assert.equal(calls[0].init,undefined);
 const methods=[];await managementRead(async(u,init)=>{methods.push(init?.method||'GET');return init?{options:[]}:{hasVoiceOfMerchant:false};},'get_verification_options',{location:'2'});assert.deepEqual(methods,['GET','POST']);
});
test('media category updates reject COVER and PROFILE; batch input validates each item',()=>{for(const category of ['COVER','PROFILE'])assert.equal(schemas.update_media.safeParse({mediaName:'accounts/1/locations/2/media/x',category}).success,false);assert.equal(schemas.create_media_batch.safeParse({items:[{sourceUrl:'http://127.0.0.1/image.jpg'}]}).success,false);});
test('post summary updates preserve Google-only photo/video media without rewriting it',async()=>{for(const mediaFormat of ['PHOTO','VIDEO']){const local=env(),writes=[];globalThis.fetch=async(url,init={})=>{if(String(url).includes('oauth2'))return Response.json({access_token:'x'});if(init.method==='PATCH')writes.push(JSON.parse(init.body));return Response.json({topicType:'STANDARD',summary:'old',media:[{name:'media/123',mediaFormat,googleUrl:'https://lh3.googleusercontent.com/photo'}]});};const args={postName:'accounts/1/locations/2/localPosts/3',post:{summary:'new'}};const p=parse(await invoke(local,props,'update_post',args));await invoke(local,props,'update_post',{...args,confirmed:true,previewId:p.previewId});assert.deepEqual(writes,[{summary:'new'}]);}});
test('private state compare-and-set refuses cancelling a job that has begun',async()=>{const local=env(),before={id:'x',status:'scheduled'};local.controlData.set('job:x',{id:'x',status:'running'});const response=await local.controlObject.fetch(new Request('https://internal/put',{method:'POST',body:JSON.stringify({key:'job:x',expected:before,value:{...before,status:'cancelled'}})}));assert.equal(response.status,409);assert.equal(local.controlData.get('job:x').status,'running');});
function movie(duration=20,width=1280,height=720){const box=(type,bytes)=>{const b=Buffer.alloc(8);b.writeUInt32BE(8+bytes.length);b.write(type,4);return Buffer.concat([b,bytes]);};const mv=Buffer.alloc(24);mv.writeUInt32BE(1000,12);mv.writeUInt32BE(duration*1000,16);const tk=Buffer.alloc(84);tk.writeUInt32BE(width*65536,76);tk.writeUInt32BE(height*65536,80);const hd=Buffer.alloc(20);hd.write('vide',8);return Buffer.concat([box('ftyp',Buffer.from('isom0000')),box('mdat',Buffer.alloc(300)),box('moov',Buffer.concat([box('mvhd',mv),box('trak',Buffer.concat([box('tkhd',tk),box('mdia',box('hdlr',hd))]))]))]);}
test('streaming MP4 scanner handles split headers, rejects long/low-resolution/truncated videos',()=>{const bytes=movie(),scanner=new MovieScanner();for(let i=0;i<bytes.length;i+=3)scanner.push(bytes.subarray(i,i+3));assert.equal(scanner.finish().durationSeconds,20);for(const bytes of [movie(31),movie(20,640,480),movie().subarray(0,200)]){assert.throws(()=>{const s=new MovieScanner();s.push(bytes);s.finish();});}});
