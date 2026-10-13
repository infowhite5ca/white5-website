import {getPlatformProxy} from 'wrangler';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const folder=new URL('../.local/',import.meta.url);await mkdir(folder,{recursive:true});
const config=JSON.parse(await readFile(new URL('../wrangler.jsonc',import.meta.url),'utf8'));config.services=config.services.map(s=>({...s,remote:true}));delete config.main;
await writeFile(new URL('management-probe.json',folder),JSON.stringify(config));
const proxy=await getPlatformProxy({configPath:fileURLToPath(new URL('management-probe.json',folder)),persist:false});
const account='accounts/115421274606058010150',location='locations/8623115222428082795',parent={account,location};
const results=[];const data={};
async function call(name,args={}){try{const r=await proxy.env.GOOGLE_BUSINESS.rpc({method:'tools/call',name,arguments:args});const value=JSON.parse(r.content[0].text);data[name]=value;const summary={name,ok:!r.isError&&value.available!==false,...(r.isError?{error:value}:{preview:value.preview,count:value.items?.length??value.services?.length??value.proposals?.length??value.mediaItems?.length??value.reviews?.length??value.localPosts?.length??value.accounts?.length??value.locations?.length})};results.push(summary);console.log(JSON.stringify(summary));return value;}catch{results.push({name,ok:false,error:'Service call failed'});console.log(JSON.stringify(results.at(-1)));}}
try{
 const list=await proxy.env.GOOGLE_BUSINESS.rpc({method:'tools/list'});console.log(JSON.stringify({providerTools:list.tools.length,unique:new Set(list.tools.map(t=>t.name)).size===list.tools.length}));
 if(process.argv.includes('--post-preview')){
   const posts=await call('list_posts',parent);
   const post=posts.localPosts?.find(p=>p.media?.some(m=>m.mediaFormat==='VIDEO'))||posts.localPosts?.[0];
   if(!post)throw new Error('No post available for preview check.');
   const result=await call('update_post',{postName:post.name,post:{summary:'Read-only regression preview; no publication approved.'},confirmed:false});
   if(result?.preview!==true||result.executed!==false)throw new Error('Post preview failed.');
   await writeFile(new URL('post-preview-verification.json',folder),JSON.stringify({checkedAt:new Date().toISOString(),results,existingMediaFormats:post.media?.map(m=>m.mediaFormat),preview:result},null,2));
 }else{
 const calls=[['connection_status',parent],['list_accounts',{}],['list_locations',{account}],['get_location',{location}],['capabilities',parent],['list_categories',{query:'window'}],['get_category_types',{names:['categories/gcid:window_cleaning_service']}],['get_google_updates',{location}],['find_duplicates',parent],['list_services',{location}],['get_service_types',{location}],['prepare_white5_services',{location}],['list_attributes',{location}],['get_attributes',{location}],['list_media',parent],['list_customer_media',parent],['check_media_publication',{...parent,since:'2026-10-12',observedPublicCount:3}],['list_posts',parent],['list_reviews',parent],['review_summary',parent],['get_performance',{location,startDate:'2026-09-01',endDate:'2026-09-30'}],['search_keywords',{location,startMonth:'2026-09',endMonth:'2026-09'}],['compare_performance',{location,startDate:'2026-09-01',endDate:'2026-09-30',previousStartDate:'2026-08-01',previousEndDate:'2026-08-31'}],['performance_summary',{location,period:'monthly'}],['list_action_types',{location}],['list_action_links',{location}],['get_voice_of_merchant',{location}],['get_verification_options',{location}],['list_verifications',{location}],['list_admins',parent],['list_admins',{...parent,scope:'account'}],['list_invitations',{account}],['get_notifications',{account}],['list_post_drafts',{}],['list_jobs',{}],['list_reports',{}],['get_audit_log',{}],['run_full_audit',parent],['poll_changes',parent]];
 for(const [name,args] of calls)await call(name,args);
 for(const [name,collection,field,key] of [['get_media','list_media','mediaItems','mediaName'],['get_customer_media','list_customer_media','mediaItems','mediaName'],['get_post','list_posts','localPosts','postName'],['get_review','list_reviews','reviews','reviewName'],['suggest_review_reply','list_reviews','reviews','reviewName'],['get_action_link','list_action_links','placeActionLinks','name']]){const first=data[collection]?.[field]?.[0];if(first?.name)await call(name,{[key]:first.name});else results.push({name,skipped:'No accessible resource returned by list.'});}
 await call('update_services',{location,upsert:[{item:{freeFormServiceItem:{category:'categories/gcid:window_cleaning_service',label:{displayName:'Deck Sanding',languageCode:'en'}}}}],validateOnly:false,confirmed:false});
 const post={topicType:'STANDARD',summary:'Preview only — this content is not approved for publication.'};
 await call('create_post',{...parent,post,confirmed:false});
 await call('save_post_draft',{...parent,post,confirmed:false});
 await call('update_location',{location,changes:{profile:{description:data.get_location?.profile?.description||'White5 cleaning services in Calgary.'}},validateOnly:true,confirmed:false});
 await call('schedule_job',{...parent,kind:'weekly_report',runAt:new Date(Date.now()+86400000).toISOString(),confirmed:false});
 const attribute=data.list_attributes?.attributeMetadata?.find(a=>a.valueType==='BOOL'&&!a.deprecated);
 if(attribute)await call('update_attributes',{location,attributes:[{name:attribute.parent,values:[true]}],confirmed:false});
 await call('upload_media_batch',{files:[{file_id:'file-preview-only',download_url:'https://files.oaiusercontent.com/preview-only.png',mime_type:'image/png'}],confirmed:false});
 if(data.list_posts?.localPosts?.[0]?.name)await call('update_post',{postName:data.list_posts.localPosts[0].name,post:{summary:'Preview only; no content change approved.'},confirmed:false});
 if(data.list_reviews?.reviews?.[0]?.name)await call('reply_to_review',{reviewName:data.list_reviews.reviews[0].name,comment:'Preview only; no reply approved.',confirmed:false});
 const jobs=await call('list_jobs',{});if(jobs?.items?.length)throw new Error('Unexpected existing jobs require review.');
 for(const name of ['ZOHO','SQUARE','GOOGLE_ADS','META_ADS']){const status=await proxy.env[name].status();results.push({provider:name,status});console.log(JSON.stringify({provider:name,status}));}
 await writeFile(new URL('management-verification.json',folder),JSON.stringify({checkedAt:new Date().toISOString(),results,data},null,2));
 }
}finally{await proxy.dispose();}
