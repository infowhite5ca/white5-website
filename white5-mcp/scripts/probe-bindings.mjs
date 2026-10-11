import { getPlatformProxy } from 'wrangler';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const folder = new URL('../.local/', import.meta.url);
await mkdir(folder, { recursive: true });
const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
if(process.argv.includes('--approved-project')) config.services=config.services.map(service=>service.binding==='GOOGLE_BUSINESS'?{...service,service:'white5-google-business-profile-mcp'}:service);
config.services = config.services.map(service => ({ ...service, remote: true }));
delete config.main;
await writeFile(new URL('probe.json', folder), JSON.stringify(config));
const proxy = await getPlatformProxy({ configPath: fileURLToPath(new URL('probe.json', folder)), persist: false });
try {
  const candidates=[];
  async function call(name, args = {}) {
    const result = await proxy.env.GOOGLE_BUSINESS.rpc({ method: 'tools/call', name, arguments: args });
    const data = JSON.parse(result.content[0].text);
    if (result.isError) throw new Error(JSON.stringify(data));
    return data;
  }
  if(process.argv.includes('--capabilities-only')){
    for(const [name,args] of [
      ['list_accounts',{}],
      ['list_locations',{account:'115421274606058010150'}],
      ['get_location',{location:'8623115222428082795'}],
      ['list_posts',{account:'115421274606058010150',location:'8623115222428082795'}],
      ['list_reviews',{account:'115421274606058010150',location:'8623115222428082795'}],
      ['get_performance',{location:'8623115222428082795',startDate:'2026-09-01',endDate:'2026-09-30',metrics:['WEBSITE_CLICKS','CALL_CLICKS']}],
    ]){
      try{const data=await call(name,args);console.log(JSON.stringify({name,ok:true,count:data.accounts?.length??data.locations?.length??data.localPosts?.length??data.reviews?.length,totalReviewCount:data.totalReviewCount,averageRating:data.averageRating,hasPerformance:Boolean(data.multiDailyMetricTimeSeries)}))}
      catch(error){console.log(JSON.stringify({name,ok:false,error:error.message}))}
    }
  }else{
  console.log(JSON.stringify({ name: 'connection_status', result: await call('connection_status') }));
  let accountPage;
  do {
    const accounts = await call('list_accounts', { pageToken: accountPage });
    for (const account of accounts.accounts || []) {
      let pageToken;
      do {
        const locations = await call('list_locations', { account: account.name, pageToken });
        for (const location of locations.locations || []) {
          console.log(JSON.stringify({ account: account.name, location: location.name, title: location.title, website: location.websiteUri, serviceArea: location.serviceArea, metadata: location.metadata }));
          if (/^white\s*5$/i.test(location.title) && location.metadata?.hasVoiceOfMerchant && !location.metadata?.duplicateLocation) candidates.push({account:account.name,location:location.name});
          for (const name of ['list_reviews', 'list_posts']) {
            const raw = await proxy.env.GOOGLE_BUSINESS.rpc({ method: 'tools/call', name, arguments: { account: account.name, location: location.name } });
            let data; try { data = JSON.parse(raw.content[0].text); } catch { data = raw.content[0].text; }
            console.log(JSON.stringify({ name, location: location.name, ok: !raw.isError, result: raw.isError ? data : { totalReviewCount: data.totalReviewCount, averageRating: data.averageRating, count: (data.reviews || data.localPosts || []).length, nextPageToken: Boolean(data.nextPageToken) } }));
          }
        }
        pageToken = locations.nextPageToken;
      } while (pageToken);
    }
    accountPage = accounts.nextPageToken;
  } while (accountPage);
  if(candidates.length===1){
    const primary=candidates[0];
    console.log(JSON.stringify({name:'get_location_permissions',result:await call('get_location_permissions',{location:primary.location})}));
    if(process.argv.includes('--select-primary'))console.log(JSON.stringify({name:'set_primary_location',result:await call('set_primary_location',{...primary,confirmed:true})}));
    console.log(JSON.stringify({name:'connection_status',result:await call('connection_status',primary)}));
  }
  for (const key of ['ZOHO','SQUARE','GOOGLE_ADS','META_ADS']) {
    console.log(JSON.stringify({ binding: key, status: await proxy.env[key].status() }));
  }
  }
} finally { await proxy.dispose(); }
