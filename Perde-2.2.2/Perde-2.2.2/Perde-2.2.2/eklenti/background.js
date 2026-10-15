'use strict';
importScripts('settings.js');
const {defaults:DEFAULTS,normalize,videoId}=PerdeSettings;
let opening=null;
const LOCAL='http://127.0.0.1:8765';
const SCRIPTS=['settings.js','tracking.js','motion.js','content.js','audio-content.js','gambling.js'];
const youtube=url=>{try{return new URL(url).protocol==='https:'&&/(^|\.)youtube(?:-nocookie)?\.com$/.test(new URL(url).hostname);}catch{return false;}};
const ownPage=sender=>sender.id===chrome.runtime.id&&sender.url?.startsWith(chrome.runtime.getURL(''));
async function ensureEngine(){
  if(opening)return opening;
  opening=(async()=>{if(!(await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']})).length)await chrome.offscreen.createDocument({url:'offscreen.html',reasons:['BLOBS','AUDIO_PLAYBACK'],justification:'Görüntüleri cihazda analiz etmek ve ayrılmış vokali video ile eşzamanlı oynatmak.'});})();
  try{await opening;}finally{opening=null;}
}
async function engine(message,target='perde-engine'){await ensureEngine();return chrome.runtime.sendMessage({...message,target});}
async function permitted(url){try{const u=new URL(url);return ['https:','http:'].includes(u.protocol)&&await chrome.permissions.contains({origins:[`${u.origin}/*`]});}catch{return false;}}
async function readImage(url){
  const u=new URL(url);
  if(!await permitted(url)||u.username||u.password)throw Error('Görsel kaynağı için izin yok. Görsel koruma altında tutuluyor.');
  const response=await fetch(url,{credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error('Görsel okunamadı.');
  const mime=(response.headers.get('content-type')||'').split(';')[0];
  if(!/^image\/(jpeg|png|webp|gif|avif)$/.test(mime))throw Error('Desteklenmeyen görsel biçimi.');
  const reader=response.body.getReader();let total=0;const chunks=[];
  while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>2500000){await reader.cancel();throw Error('Görsel analiz sınırından büyük.');}chunks.push(value);}
  let binary='';for(const chunk of chunks)for(let i=0;i<chunk.length;i+=8192)binary+=String.fromCharCode(...chunk.subarray(i,i+8192));
  return `data:${mime};base64,${btoa(binary)}`;
}
async function service(path,method='GET',body){
  const {vocalToken}=await chrome.storage.session.get('vocalToken');
  if(!vocalToken)throw Error('Eklenti panelinden yerel servis anahtarını bağla.');
  if(!await permitted(LOCAL))throw Error('Yerel servis izni verilmedi.');
  let response;try{response=await fetch(LOCAL+path,{method,headers:{Authorization:`Bearer ${vocalToken}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});}catch{throw Error('Yerel vokal servisine ulaşılamadı. Servisi başlatıp yeniden dene.');}
  const data=await response.json();if(!response.ok)throw Error(data.error||'Vokal servisi işlemi reddetti.');return data;
}
async function cancelVocal(){
  const {vocalJob}=await chrome.storage.session.get('vocalJob');
  await chrome.storage.session.remove('vocalJob');
  await engine({type:'audio-release'},'perde-audio').catch(()=>{});
  if(vocalJob)await service(`/jobs/${vocalJob.id}`,'DELETE').catch(()=>{});
}
let vocalQueue=Promise.resolve();
function serializedVocal(work){const task=vocalQueue.then(work);vocalQueue=task.catch(()=>{});return task;}
async function vocal(message,sender){
  if(!sender.tab||!youtube(sender.url))throw Error('Vokal yalnızca YouTube içinde kullanılabilir.');
  const tab=sender.tab.id,frame=sender.frameId||0;
  if(message.type==='vocal-start'){
    const id=videoId(sender.url);
    if(!id||id!==message.videoId)throw Error('Önce bir YouTube videosu aç.');
    const {settings}=await chrome.storage.local.get({settings:DEFAULTS}),s=normalize(settings);
    if(!s.vocalEnabled)throw Error('Vokal özelliği ayarlarda kapalı.');
    const existing=(await chrome.storage.session.get('vocalJob')).vocalJob;
    if(existing)throw Error('Önce açık vokal oturumunu kapat. Aynı anda bir video destekleniyor.');
    const job=await service('/jobs','POST',{videoId:id,maxMinutes:s.maxMinutes,saveVocal:message.saveVocal===true});
    if(!/^[a-f0-9]{32}$/.test(job.id||''))throw Error('Servis geçersiz iş kimliği döndürdü.');
    await chrome.storage.session.set({vocalJob:{id:job.id,tab,frame,videoId:id}});
    return {ok:true};
  }
  const {vocalJob:job}=await chrome.storage.session.get('vocalJob');
  if(!job||job.tab!==tab||job.frame!==frame)throw Error('Bu sayfanın etkin vokal oturumu yok.');
  if(message.type==='vocal-cancel'){await cancelVocal();return {ok:true};}
  if(videoId(sender.url)!==job.videoId){if(message.type!=='vocal-heartbeat')await cancelVocal();throw Error('Video değişti; önceki vokal kapatıldı.');}
  if(message.type==='vocal-heartbeat'){
    const result=await service(`/jobs/${job.id}`);
    if(result.state==='error')throw Error(result.error||'Vokal oturumu sona erdi.');
    return {ok:true,saved:result.saved,saveVocal:result.saveVocal,cacheWarning:result.cacheWarning};
  }
  if(message.type==='vocal-retain')return {ok:true,...await service(`/jobs/${job.id}/retention`,'POST',{saveVocal:message.saveVocal===true})};
  if(message.type==='vocal-status'){
    const result=await service(`/jobs/${job.id}`);
    if(result.state==='ready'&&!job.loaded){
      const {vocalToken}=await chrome.storage.session.get('vocalToken');
      const loaded=await engine({type:'audio-load',job:job.id,token:vocalToken,retry:message.retry===true},'perde-audio');
      if(!loaded?.ok)return {ok:true,...result,state:'transfer-error',error:loaded?.error||'Ses yüklenemedi.',retryable:true};
      if(loaded.state==='loading')return {ok:true,...result,state:'transferring',progress:loaded.progress};
      job.loaded=true;await chrome.storage.session.set({vocalJob:job});
    }
    return {ok:true,...result};
  }
  if(message.type==='vocal-sync'&&job.loaded){
    const result=await engine({type:'audio-sync',time:message.time,rate:message.rate,volume:message.volume,playing:message.playing},'perde-audio');
    if(result?.reload){job.loaded=false;await chrome.storage.session.set({vocalJob:job});}
    return result;
  }
  throw Error('Vokal henüz hazır değil.');
}
async function registerSites(){
  const {siteOrigins=[]}=await chrome.storage.local.get('siteOrigins');
  const matches=[];for(const origin of siteOrigins)if(typeof origin==='string'&&await permitted(origin.replace(/\*$/,''))&&!youtube(origin))matches.push(origin);
  const old=await chrome.scripting.getRegisteredContentScripts({ids:['perde-sites']});
  if(matches.length){const config={id:'perde-sites',matches,js:SCRIPTS,css:['content.css'],runAt:'document_start',allFrames:true,persistAcrossSessions:true};if(old.length)await chrome.scripting.updateContentScripts([config]);else await chrome.scripting.registerContentScripts([config]);}
  else if(old.length)await chrome.scripting.unregisterContentScripts({ids:['perde-sites']});
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message?.target==='perde-engine'||message?.target==='perde-audio')return;
  const handle=async()=>{
    if(sender.id!==chrome.runtime.id||!ownPage(sender)&&!await permitted(sender.url))throw Error('Bu sayfaya erişim izni yok.');
    // A slow health request must never hold up media timing or pause commands.
    if(message?.type==='vocal-heartbeat')return vocal(message,sender);
    if(message?.type?.startsWith('vocal-'))return serializedVocal(()=>vocal(message,sender));
    switch(message?.type){
      case 'detect':return engine({type:'engine-detect',image:message.image,confidence:message.confidence,detail:message.detail});
      case 'image-read':return {ok:true,image:await readImage(message.url)};
      case 'model-check':return engine({type:'engine-status'});
      case 'diagnostics':return {ok:true,version:chrome.runtime.getManifest().version};
      case 'service-connect':
        if(!ownPage(sender)||!/^[-\w]{32,128}$/.test(message.token||''))throw Error('Geçersiz servis anahtarı.');
        await chrome.storage.session.set({vocalToken:message.token});
        try{await service('/health');return {ok:true};}catch(error){await chrome.storage.session.remove('vocalToken');throw error;}
      case 'service-disconnect':if(!ownPage(sender))throw Error('İzin yok.');await serializedVocal(cancelVocal);await chrome.storage.session.remove('vocalToken');return {ok:true};
      case 'cache-clear':if(!ownPage(sender))throw Error('İzin yok.');await service('/cache','DELETE');return {ok:true};
      case 'sites-refresh':if(!ownPage(sender))throw Error('İzin yok.');await registerSites();return {ok:true};
      default:return {ok:false,error:'Bilinmeyen işlem.'};
    }
  };
  handle().then(respond,error=>respond({ok:false,error:error.message}));return true;
});
chrome.tabs.onRemoved.addListener(tab=>{serializedVocal(async()=>{const {vocalJob}=await chrome.storage.session.get('vocalJob');if(vocalJob?.tab===tab)await cancelVocal();});});
chrome.tabs.onUpdated.addListener((tab,change)=>{
  if(change.status!=='loading'&&!change.url)return;
  serializedVocal(async()=>{const {vocalJob}=await chrome.storage.session.get('vocalJob');if(vocalJob?.tab===tab&&(change.status==='loading'||change.url&&videoId(change.url)!==vocalJob.videoId))await cancelVocal();}).catch(()=>{});
});
chrome.permissions.onRemoved.addListener(()=>{registerSites().catch(()=>{});});
chrome.runtime.onInstalled.addListener(async()=>{
  const {settings}=await chrome.storage.local.get('settings');await chrome.storage.local.set({settings:normalize(settings)});await registerSites();
});
chrome.runtime.onStartup.addListener(()=>registerSites().catch(()=>{}));
