'use strict';
importScripts('settings.js','vocal-library.js','music-library.js');
const {defaults:DEFAULTS,normalize,videoId}=PerdeSettings;
let opening=null,positionReportedAt=0;
const LOCAL='http://127.0.0.1:8765',STREAM_START_SECONDS=15;
const SCRIPTS=['settings.js','tracking.js','motion.js','content.js','panel-drag.js','audio-music-controls.js','audio-content.js','gambling.js'];
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
async function service(path,method='GET',body,timeout=15000,tokenOverride){
  const vocalToken=tokenOverride||(await chrome.storage.session.get('vocalToken')).vocalToken;
  if(!vocalToken)throw Error('Eklenti panelinden yerel servis anahtarını bağla.');
  if(!await permitted(LOCAL))throw Error('Yerel servis izni verilmedi.');
  let response;try{response=await fetch(LOCAL+path,{method,headers:{Authorization:`Bearer ${vocalToken}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(timeout)});}catch{throw Error('Yerel vokal servisine ulaşılamadı. Servisi başlatıp yeniden dene.');}
  let data;try{data=await response.json();}catch{throw Error('Yerel vokal servisinden eksik yanıt alındı. Bağlantı yeniden denenecek.');}
  if(!response.ok){const error=Error(data.error||'Vokal servisi işlemi reddetti.');error.status=response.status;throw error;}return data;
}
async function cancelVocal(){
  const {vocalJob}=await chrome.storage.session.get('vocalJob');
  await chrome.storage.session.remove('vocalJob');
  await engine({type:'audio-release'},'perde-audio').catch(()=>{});
  if(vocalJob?.id)await service(`/jobs/${vocalJob.id}`,'DELETE').catch(()=>{});
}
let vocalQueue=Promise.resolve();
function serializedVocal(work){const task=vocalQueue.then(work);vocalQueue=task.catch(()=>{});return task;}
let connectionQueue=Promise.resolve();
function serializedConnection(work){const task=connectionQueue.then(work);connectionQueue=task.catch(()=>{});return task;}
async function connectService(token){
  if(!/^[-\w]{32,128}$/.test(token||''))throw Error('Servisin gösterdiği anahtarı yapıştır.');
  // Validate before replacing the last working key. Failed attempts cannot erase it.
  await service('/health','GET',undefined,8000,token);
  await chrome.storage.session.set({vocalToken:token});
  let reset=false;
  await serializedVocal(async()=>{
    const {vocalJob:job}=await chrome.storage.session.get('vocalJob');
    if(job?.id&&!job.loaded&&job.source!=='browser'){
      try{await service(`/jobs/${job.id}`,'GET',undefined,2000,token);}
      catch(error){if(error.status===404||error.status===401){await chrome.storage.session.remove('vocalJob');await engine({type:'audio-release'},'perde-audio');reset=true;}}
    }
  });
  await chrome.storage.local.set({serviceReady:{stamp:Date.now(),reset},vocalLibraryChanged:Date.now()});
  return {ok:true,connected:true,tokenPresent:true};
}
const ownsVocal=(job,sender,message)=>job&&job.tab===sender.tab?.id&&job.frame===(sender.frameId||0)&&(!job.documentId||job.documentId===sender.documentId)&&(!job.clientId||job.clientId===message.clientId);
async function vocalLookup(id){
  const record=await PerdeVocalLibrary.info(id);
  if(record)return {available:true,source:'browser',...record};
  const {vocalToken}=await chrome.storage.session.get('vocalToken');
  if(vocalToken){try{const result=await service(`/cache/${id}`,'GET',undefined,3000);if(result.available)return {...result,source:'disk'};}catch{}}
  return {available:false};
}
async function loadVocal(job,retry=false){
  const {vocalToken}=await chrome.storage.session.get('vocalToken');
  const result=await engine(job.source==='browser'?{type:'audio-load-saved',videoId:job.videoId,retry}:{type:'audio-load',job:job.id,token:vocalToken,retry,videoId:job.videoId,title:job.title,totalSeconds:job.totalSeconds,audioSelection:job.audioSelection,audioLanguage:job.audioLanguage,saveVocal:job.saveVocal},'perde-audio');
  if(!result?.ok)return {state:'transfer-error',error:result?.error||'Ses yüklenemedi.',retryable:true};
  job.saved=result.saved===true;job.cacheWarning=result.cacheWarning||null;
  if(result.state==='loading')return {...result,state:'transferring'};
  job.loaded=true;await chrome.storage.session.set({vocalJob:job});
  return {...result,state:'ready'};
}
async function vocal(message,sender){
  if(!sender.tab||!youtube(sender.url))throw Error('Vokal yalnızca YouTube içinde kullanılabilir.');
  const tab=sender.tab.id,frame=sender.frameId||0;
  if(message.type==='vocal-lookup'){
    const id=videoId(sender.url);if(!id||id!==message.videoId)throw Error('Geçersiz video.');
    return {ok:true,...await vocalLookup(id)};
  }
  if(message.type==='vocal-start'||message.type==='vocal-use-saved'){
    const id=videoId(sender.url);
    if(!id||id!==message.videoId)throw Error('Önce bir YouTube videosu aç.');
    const {settings}=await chrome.storage.local.get({settings:DEFAULTS}),s=normalize(settings);
    if(!s.vocalEnabled)throw Error('Vokal özelliği ayarlarda kapalı.');
    const existing=(await chrome.storage.session.get('vocalJob')).vocalJob;
    if(existing){
      if(existing.tab===tab&&existing.frame===frame&&(!ownsVocal(existing,sender,message)||!existing.clientId&&message.clientId))await cancelVocal();
      else throw Error('Önce açık vokal oturumunu kapat. Aynı anda bir video destekleniyor.');
    }
    const record=await PerdeVocalLibrary.info(id);
    const owner={tab,frame,documentId:sender.documentId,clientId:message.clientId,videoId:id,title:String(message.title||record?.title||id).slice(0,300),saveVocal:message.saveVocal===true};
    if(record){
      await chrome.storage.session.set({vocalJob:{...owner,source:'browser',totalSeconds:record.totalSeconds,audioSelection:record.audioSelection,audioLanguage:record.audioLanguage,saved:true,cached:true}});
      return {ok:true,cached:true};
    }
    // Persistence belongs to the browser. The service only supplies the completed audio.
    const job=await service('/jobs','POST',{videoId:id,maxMinutes:s.maxMinutes,saveVocal:false,cacheOnly:message.type==='vocal-use-saved'});
    if(!/^[a-f0-9]{32}$/.test(job.id||''))throw Error('Servis geçersiz iş kimliği döndürdü.');
    await chrome.storage.session.set({vocalJob:{...owner,id:job.id,source:'service',saveVocal:message.type==='vocal-use-saved'||owner.saveVocal,cached:job.cached===true||message.type==='vocal-use-saved'}});
    return {ok:true};
  }
  const {vocalJob:job}=await chrome.storage.session.get('vocalJob');
  if(!ownsVocal(job,sender,message))throw Error('Bu sayfanın etkin vokal oturumu yok.');
  if(message.type==='vocal-cancel'){await cancelVocal();return {ok:true};}
  if(videoId(sender.url)!==job.videoId){if(message.type!=='vocal-heartbeat')await cancelVocal();throw Error('Video değişti; önceki vokal kapatıldı.');}
  if(message.type==='vocal-heartbeat'){
    if(job.source==='browser'||job.loaded)return {ok:true,saved:!!await PerdeVocalLibrary.info(job.videoId),saveVocal:job.saveVocal,cacheWarning:job.cacheWarning};
    const result=await service(`/jobs/${job.id}`);
    if(result.state==='error')throw Error(result.error||'Vokal oturumu sona erdi.');
    return {ok:true,saved:job.saved===true,saveVocal:job.saveVocal,cacheWarning:job.cacheWarning};
  }
  if(message.type==='vocal-retain'){
    job.saveVocal=message.saveVocal===true;
    const result=await engine({type:'audio-retain',saveVocal:job.saveVocal,videoId:job.videoId,title:job.title,totalSeconds:job.totalSeconds},'perde-audio');
    job.saved=result?.saved===true;job.cacheWarning=result?.cacheWarning||null;
    await chrome.storage.session.set({vocalJob:job});
    return {ok:true,saved:job.saved,saveVocal:job.saveVocal,cacheWarning:job.cacheWarning};
  }
  if(message.type==='vocal-status'){
    if(job.loaded)return {ok:true,state:'ready',cached:job.cached,saved:job.saved,saveVocal:job.saveVocal,cacheWarning:job.cacheWarning,audioSelection:job.audioSelection};
    let result={state:'ready',cached:true};
    if(job.source!=='browser'){
      result=await service(`/jobs/${job.id}`);
      job.totalSeconds=result.totalSeconds;job.audioSelection=result.audioSelection;job.audioLanguage=result.audioLanguage;
      job.cached=job.cached||result.cached===true;
      await chrome.storage.session.set({vocalJob:job});
    }
    // The first part of the vocal can play while the rest is still separated.
    const playable=result.state==='ready'||result.streamable===true&&['separating','encoding'].includes(result.state)&&(result.processedSeconds>=STREAM_START_SECONDS||result.state==='encoding');
    if(playable){
      const loaded=await loadVocal(job,message.retry===true);
      if(loaded.state==='transferring'&&result.state!=='ready')return {...result,ok:true,saved:false,saveVocal:job.saveVocal};
      return {...result,...loaded,ok:true,cached:job.cached,saveVocal:job.saveVocal,audioSelection:job.audioSelection};
    }
    return {...result,ok:true,saved:false,saveVocal:job.saveVocal};
  }
  if(message.type==='vocal-sync'&&job.loaded){
    const {backgroundTrackId=null,musicVolume=.15}=await chrome.storage.local.get({backgroundTrackId:null,musicVolume:.15});
    const result=await engine({type:'audio-sync',time:message.time,rate:message.rate,volume:message.volume,playing:message.playing,musicId:backgroundTrackId,musicVolume},'perde-audio');
    // The service slows down when it is far ahead of the listener.
    if(result?.complete===false&&job.source==='service'&&Date.now()-positionReportedAt>5000){positionReportedAt=Date.now();service(`/jobs/${job.id}/position`,'POST',{position:message.time},3000).catch(()=>{});}
    if(result?.reload){job.loaded=false;if(await PerdeVocalLibrary.info(job.videoId))job.source='browser';await chrome.storage.session.set({vocalJob:job});}
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
    if(message?.type?.startsWith('vocal-library-')){
      if(!ownPage(sender))throw Error('İzin yok.');
      if(message.type==='vocal-library-list')return {ok:true,items:await PerdeVocalLibrary.list()};
      return serializedVocal(async()=>{
        const {vocalJob:job}=await chrome.storage.session.get('vocalJob');
        if(message.type!=='vocal-library-clear'&&message.type!=='vocal-library-remove')throw Error('Bilinmeyen işlem.');
        if(job&&(message.type==='vocal-library-clear'||job.videoId===message.videoId)){
          await engine({type:'audio-forget',videoId:job.videoId},'perde-audio');
          job.saveVocal=false;job.saved=false;await chrome.storage.session.set({vocalJob:job});
        }
        if(message.type==='vocal-library-clear')await PerdeVocalLibrary.clear();else await PerdeVocalLibrary.remove(message.videoId);
        await chrome.storage.local.set({vocalLibraryChanged:Date.now()});return {ok:true};
      });
    }
    if(message?.type==='vocal-lookup')return vocal(message,sender);
    if(message?.type?.startsWith('vocal-'))return serializedVocal(()=>vocal(message,sender));
    switch(message?.type){
      case 'detect':return engine({type:'engine-detect',image:message.image,confidence:message.confidence,detail:message.detail,frame:message.frame,genderLimit:message.genderLimit,genders:message.genders!==false,skip:message.skip,debug:message.debug===true});
      case 'image-read':return {ok:true,image:await readImage(message.url)};
      case 'model-check':return engine({type:'engine-status'});
      case 'diagnostics':return {ok:true,version:chrome.runtime.getManifest().version};
      case 'service-status':{
        if(!ownPage(sender))throw Error('İzin yok.');
        const {vocalToken}=await chrome.storage.session.get('vocalToken');
        if(!vocalToken)return {ok:true,connected:false,tokenPresent:false};
        try{await service('/health','GET',undefined,2000);return {ok:true,connected:true,tokenPresent:true};}
        catch(error){return {ok:true,connected:false,tokenPresent:true,error:error.message};}
      }
      case 'service-connect':
      case 'service-reconnect':
        if(!ownPage(sender))throw Error('İzin yok.');
        return serializedConnection(async()=>connectService(message.type==='service-reconnect'?(await chrome.storage.session.get('vocalToken')).vocalToken:message.token));
      case 'service-disconnect':
        if(!ownPage(sender))throw Error('İzin yok.');
        return serializedConnection(async()=>{await serializedVocal(async()=>{const {vocalJob}=await chrome.storage.session.get('vocalJob');if(vocalJob&&vocalJob.source!=='browser'&&!vocalJob.loaded)await cancelVocal();});await chrome.storage.session.remove('vocalToken');return {ok:true};});
      case 'music-list':
        if(!ownPage(sender)&&!youtube(sender.url))throw Error('İzin yok.');
        return {ok:true,items:await PerdeMusicLibrary.list(),...await chrome.storage.local.get({backgroundTrackId:null,musicVolume:.15})};
      case 'music-select':{
        if(!ownPage(sender)&&!youtube(sender.url))throw Error('İzin yok.');
        const id=message.id;
        if(id!==null&&!await PerdeMusicLibrary.info(id))throw Error('MP3 kitaplıkta bulunamadı.');
        await chrome.storage.local.set({backgroundTrackId:id});
        if(!id)await engine({type:'audio-music-clear'},'perde-audio');
        return {ok:true};
      }
      case 'music-volume':
        if(!ownPage(sender)&&!youtube(sender.url))throw Error('İzin yok.');
        if(!Number.isFinite(message.volume)||message.volume<0||message.volume>1)throw Error('Geçersiz ses düzeyi.');
        await chrome.storage.local.set({musicVolume:message.volume});return {ok:true};
      case 'music-remove':{
        if(!ownPage(sender))throw Error('İzin yok.');
        await PerdeMusicLibrary.remove(message.id);
        const {backgroundTrackId}=await chrome.storage.local.get('backgroundTrackId');
        if(backgroundTrackId===message.id){await chrome.storage.local.set({backgroundTrackId:null});await engine({type:'audio-music-clear'},'perde-audio');}
        await chrome.storage.local.set({musicLibraryChanged:Date.now()});return {ok:true};
      }
      case 'music-library-changed':
        if(!ownPage(sender))throw Error('İzin yok.');
        await chrome.storage.local.set({musicLibraryChanged:Date.now()});return {ok:true};
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
  serializedVocal(async()=>{const {vocalJob}=await chrome.storage.session.get('vocalJob');if(vocalJob?.tab===tab&&change.url&&videoId(change.url)!==vocalJob.videoId)await cancelVocal();}).catch(()=>{});
});
chrome.permissions.onRemoved.addListener(()=>{registerSites().catch(()=>{});});
chrome.runtime.onInstalled.addListener(async()=>{
  const {settings}=await chrome.storage.local.get('settings');await chrome.storage.local.set({settings:normalize(settings)});await registerSites();
});
chrome.runtime.onStartup.addListener(()=>registerSites().catch(()=>{}));
