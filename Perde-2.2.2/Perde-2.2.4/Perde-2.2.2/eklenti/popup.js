'use strict';
const $=id=>document.getElementById(id);
let settings=PerdeSettings.normalize(),activeTab=null,tabStatus=null;
const fields=['enabled','profile','target','maskStyle','faceless','pauseOnError','muteAds','blockGambling','vocalEnabled','maxMinutes'];
// Radio groups are addressed by name; other fields by id.
const radioGroups=new Set(['target','maskStyle','faceless']);
const inputs=key=>radioGroups.has(key)?[...document.querySelectorAll(`input[name="${key}"]`)]:[$(key)];
function fieldValue(key){const [first]=inputs(key);if(first.type==='radio')return inputs(key).find(x=>x.checked)?.value;return first.type==='checkbox'?first.checked:first.value;}
function setField(key,value){for(const input of inputs(key)){if(input.type==='radio')input.checked=input.value===value;else if(input.type==='checkbox')input.checked=value;else input.value=String(value);input.disabled=false;}}
for(const id of fields)for(const input of inputs(id))input.disabled=true;
async function rpc(message){const r=await chrome.runtime.sendMessage(message);if(!r?.ok)throw Error(r?.error||'İşlem tamamlanamadı.');return r;}
const sections=['protection','vocals','music','settings'];
function showSection(section,focus=false){
  for(const name of sections){
    const selected=name===section,tab=$(`tab-${name}`);
    tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;$(`panel-${name}`).hidden=!selected;
    if(selected&&focus)tab.focus();
  }
}
for(const [index,name] of sections.entries()){
  const tab=$(`tab-${name}`);tab.onclick=()=>showSection(name);
  tab.addEventListener('keydown',event=>{
    const next=event.key==='ArrowRight'?(index+1)%sections.length:event.key==='ArrowLeft'?(index+sections.length-1)%sections.length:event.key==='Home'?0:event.key==='End'?sections.length-1:-1;
    if(next>=0){event.preventDefault();showSection(sections[next],true);}
  });
}
showSection('protection');
let serviceBusy=false,serviceInfo=null,serviceRevision=0,serviceChecking=false;
function serviceControls(){
  const connected=serviceInfo?.connected===true;
  $('connect').disabled=serviceBusy||connected;
  $('disconnect').disabled=serviceBusy||!serviceInfo?.tokenPresent;
  $('clear-cache').disabled=serviceBusy||!connected;
  $('token').disabled=serviceBusy;$('service-credentials').hidden=connected;
  $('connect').textContent=connected?'Servise Bağlı':serviceBusy?'Bağlanıyor…':serviceInfo?.tokenPresent?'Yeniden bağlan':'Servise Bağlan';
  $('service-state').textContent=connected?'Servis bağlı':serviceInfo?.tokenPresent?'Servise ulaşılamıyor':'Bağlı değil';
  $('service-state').setAttribute('data-connected',String(connected));
  $('service-state').title=serviceInfo?.error||'';
}
async function refreshService(){
  if(serviceBusy||serviceChecking)return;
  const revision=serviceRevision;serviceChecking=true;
  try{const result=await rpc({type:'service-status'});if(revision===serviceRevision)serviceInfo=result;}
  catch{if(revision===serviceRevision)serviceInfo={connected:false,tokenPresent:serviceInfo?.tokenPresent};}
  finally{serviceChecking=false;serviceControls();}
}
let libraryItems=[],libraryBusy=false,libraryRefreshing=false,librarySignature='';
function vocalSize(bytes){return `${(Math.max(0,Number(bytes)||0)/1024/1024).toLocaleString('tr-TR',{maximumFractionDigits:1})} MB`;}
function vocalDuration(seconds){const total=Math.max(0,Math.round(Number(seconds)||0));return `${Math.floor(total/60)}:${String(total%60).padStart(2,'0')}`;}
function libraryControls(){
  $('vocal-library-list').setAttribute('aria-busy',String(libraryBusy||libraryRefreshing));
  $('refresh-library').disabled=libraryBusy||libraryRefreshing;
  $('clear-library').disabled=libraryBusy||libraryRefreshing||!libraryItems.length;
  $('confirm-clear-library').disabled=libraryBusy||libraryRefreshing||!libraryItems.length;
  $('cancel-clear-library').disabled=libraryBusy;
  for(const button of $('vocal-library-list').querySelectorAll('button'))button.disabled=libraryBusy||libraryRefreshing;
}
function renderLibrary(items){
  libraryItems=items.filter(item=>item&&/^[A-Za-z0-9_-]{11}$/.test(item.videoId)).sort((a,b)=>(Number(b.savedAt)||0)-(Number(a.savedAt)||0));
  $('library-count').textContent=libraryItems.length>99?'99+':String(libraryItems.length);
  if(!libraryItems.length)$('library-clear-confirm').hidden=true;
  $('library-summary').textContent=libraryItems.length?`${libraryItems.length} kayıt · ${vocalSize(libraryItems.reduce((sum,item)=>sum+Math.max(0,Number(item.bytes)||0),0))}`:'Henüz kayıt yok. Videodaki “Vokali tarayıcıda sakla” kutusunu açık bırak; hazır ses burada görünecek.';
  const signature=JSON.stringify(libraryItems);
  if(signature!==librarySignature){
    librarySignature=signature;$('vocal-library-list').replaceChildren();
    for(const item of libraryItems){
      const title=typeof item.title==='string'&&item.title.trim()?item.title.trim():`YouTube videosu · ${item.videoId}`;
      const li=document.createElement('li'),name=document.createElement('strong'),info=document.createElement('p'),actions=document.createElement('div'),open=document.createElement('button'),remove=document.createElement('button');
      name.textContent=title;name.title=title;info.textContent=`${vocalDuration(item.totalSeconds)} · ${vocalSize(item.bytes)}`;actions.className='library-actions';
      open.textContent='Videoyu aç';open.setAttribute('aria-label',`${title} videosunu aç`);
      open.onclick=async()=>{try{await chrome.tabs.create({url:`https://www.youtube.com/watch?v=${encodeURIComponent(item.videoId)}`});}catch(error){$('library-status').textContent=error.message;}};
      remove.textContent='Sil';remove.className='library-remove';remove.setAttribute('aria-label',`${title} için kayıtlı vokali sil`);
      remove.onclick=()=>changeLibrary({type:'vocal-library-remove',videoId:item.videoId},'Kayıtlı vokal silindi.');
      actions.append(open,remove);li.append(name,info,actions);$('vocal-library-list').append(li);
    }
  }
  libraryControls();
}
async function loadLibrary(){const result=await rpc({type:'vocal-library-list'});renderLibrary(Array.isArray(result.items)?result.items:[]);}
async function refreshLibrary(announce=false){
  if(libraryBusy||libraryRefreshing)return;
  libraryRefreshing=true;libraryControls();
  try{await loadLibrary();if(announce)$('library-status').textContent='Vokal listesi güncellendi.';}
  catch(error){if(!librarySignature)$('library-summary').textContent='Kayıtlar yüklenemedi. Yenile düğmesiyle tekrar deneyebilirsin.';$('library-status').textContent=error.message;}
  finally{libraryRefreshing=false;libraryControls();}
}
async function changeLibrary(message,success){
  if(libraryBusy||libraryRefreshing)return;
  libraryBusy=true;libraryControls();$('library-status').textContent='Kayıtlar güncelleniyor…';
  try{await rpc(message);await loadLibrary();$('library-status').textContent=success;}
  catch(error){$('library-status').textContent=error.message;}
  finally{libraryBusy=false;libraryControls();}
}
$('refresh-library').onclick=()=>refreshLibrary(true);
$('clear-library').onclick=()=>{if(libraryBusy||libraryRefreshing||!libraryItems.length)return;$('library-clear-confirm').hidden=false;$('cancel-clear-library').focus();};
$('cancel-clear-library').onclick=()=>{$('library-clear-confirm').hidden=true;$('clear-library').focus();};
$('confirm-clear-library').onclick=()=>changeLibrary({type:'vocal-library-clear'},'Tarayıcıya kaydedilmiş tüm vokaller silindi.');
async function refresh(){
  try{
    [activeTab]=await chrome.tabs.query({active:true,currentWindow:true});
    const currentUrl=activeTab?.url?new URL(activeTab.url):null;
    $('current-site').textContent=currentUrl&&['http:','https:'].includes(currentUrl.protocol)?currentUrl.hostname:'';
    tabStatus=await chrome.tabs.sendMessage(activeTab.id,{type:'status'},{frameId:0});
    $('status').textContent=tabStatus.error?'Analiz için yardım gerekiyor':tabStatus.enabled?'Görüntü koruması açık':'Görüntü koruması kapalı';
    $('protection-state').setAttribute('data-state',tabStatus.error?'error':tabStatus.enabled?'active':'inactive');
    $('detail').textContent=tabStatus.error||(tabStatus.enabled?(tabStatus.target==='all'?'Algılanan bütün kişiler örtülüyor.':tabStatus.frames&&!tabStatus.genderReady?'Cinsiyet modeli hazırlanıyor; bu sırada algılanan herkes örtülüyor.':(tabStatus.faceless==='show'?'Kadınlar ve kararsız kalınan kişiler örtülüyor; yüzü görünmeyenler ve erkekler açık.':'Kadınlar ve belirlenemeyen kişiler örtülüyor; erkekler açık kalır.')):'Kişileri örtmek için aşağıdaki anahtarı açabilirsin.');
    $('counts').textContent=`${tabStatus.frames} video karesi · ${tabStatus.images} görsel · son karede ${tabStatus.people} kişi (${tabStatus.covered??0} örtülü) · ${tabStatus.ms} ms`;
  }catch{$('status').textContent='Bu sayfada koruma etkin değil';$('protection-state').setAttribute('data-state','inactive');$('detail').textContent='YouTube’daysan sayfayı yenile. Başka bir site için aşağıdan izin verebilirsin.';$('counts').textContent='';tabStatus=null;}
}
let saveQueue=Promise.resolve();
function save(){
  const raw={};for(const key of fields)raw[key]=fieldValue(key);
  settings=PerdeSettings.normalize(raw);const value={...settings};
  saveQueue=saveQueue.then(()=>chrome.storage.local.set({settings:value})).then(()=>{$('save').textContent='Ayarlar kaydedildi';return refresh();}).catch(error=>{$('save').textContent=error.message;});
}
for(const id of fields)for(const input of inputs(id))input.addEventListener('change',save);
// The faceless choice only matters when women are the target.
const facelessField=()=>{$('faceless-field').hidden=fieldValue('target')==='all';};
for(const input of inputs('target'))input.addEventListener('change',facelessField);
$('retry').onclick=async()=>{try{await chrome.tabs.sendMessage(activeTab.id,{type:'retry'});$('save').textContent='Analiz yeniden başlatıldı';}catch{$('save').textContent='Önce korumanın açık olduğu sayfayı yenile.';}};
$('check').onclick=async()=>{$('save').textContent='Yerel modeller kontrol ediliyor…';try{const r=await rpc({type:'model-check'});$('save').textContent=r.warning||`İnsan${r.faceReady?' + yüz':''}${r.genderReady?' + cinsiyet':''} modelleri hazır (${r.backend})`;}catch(error){$('save').textContent=error.message;}};
$('test').onclick=()=>chrome.tabs.create({url:chrome.runtime.getURL('test.html')});
$('diagnostic').onclick=async()=>{
  try{await navigator.clipboard.writeText(JSON.stringify({version:chrome.runtime.getManifest().version,model:tabStatus?.model,frames:tabStatus?.frames,images:tabStatus?.images,error:tabStatus?.error},null,2));$('save').textContent='Hata bilgisi kopyalandı. Sayfa adresi ve video kimliği dahil edilmedi.';}
  catch(error){$('save').textContent=error.message;}
};
async function siteList(){
  const {siteOrigins=[]}=await chrome.storage.local.get('siteOrigins');$('sites').replaceChildren();
  for(const origin of siteOrigins){
    const li=document.createElement('li'),button=document.createElement('button');li.append(document.createTextNode(new URL(origin).host+' '));button.textContent='Kaldır';button.setAttribute('aria-label',`${new URL(origin).host} için site iznini kaldır`);
    button.onclick=async()=>{try{
      const tabs=await chrome.tabs.query({url:origin});
      for(const tab of tabs)await chrome.tabs.sendMessage(tab.id,{type:'site-disable'}).catch(()=>{});
      const latest=await chrome.storage.local.get('siteOrigins');
      await chrome.storage.local.set({siteOrigins:(latest.siteOrigins||[]).filter(o=>o!==origin)});
      await chrome.permissions.remove({origins:[origin]});await rpc({type:'sites-refresh'});await siteList();
      $('site-status').textContent='Site koruması kaldırıldı.';
    }catch(error){$('site-status').textContent=error.message;}};
    li.append(button);$('sites').append(li);
  }
}
$('allow-site').onclick=async()=>{
  try{
    const url=new URL(activeTab?.url);if(!['http:','https:'].includes(url.protocol))throw Error('Bu tarayıcı sayfasında eklenti çalışamaz.');
    if(/(^|\.)youtube(?:-nocookie)?\.com$/.test(url.hostname))throw Error('YouTube zaten destekleniyor; sayfayı yenile.');
    if(url.hostname==='127.0.0.1'||url.hostname==='localhost')throw Error('Yerel servis sayfasında görüntü koruması açılmaz.');
    const origin=url.origin+'/*';
    if(!await chrome.permissions.request({origins:[origin]}))throw Error('Site izni verilmedi.');
    const {siteOrigins=[]}=await chrome.storage.local.get('siteOrigins');
    await chrome.storage.local.set({siteOrigins:[...new Set([...siteOrigins,origin])]});await rpc({type:'sites-refresh'});
    await chrome.scripting.insertCSS({target:{tabId:activeTab.id,allFrames:true},files:['content.css']});
    await chrome.scripting.executeScript({target:{tabId:activeTab.id,allFrames:true},files:['settings.js','tracking.js','motion.js','content.js','panel-drag.js','audio-music-controls.js','audio-content.js','gambling.js']});
    $('site-status').textContent='İzin verildi. Önceden kaldırdıysan sayfayı yenile.';await siteList();await refresh();
  }catch(error){$('site-status').textContent=error.message;}
};
$('connect').onclick=async()=>{
  if(serviceBusy||serviceInfo?.connected)return;
  serviceBusy=true;serviceRevision++;serviceControls();$('vocal-status').textContent='Yerel servisle bağlantı kuruluyor…';
  try{
    const token=$('token').value.trim();
    if(!token&&!serviceInfo?.tokenPresent||token&&!/^[-\w]{32,128}$/.test(token))throw Error('Servisin gösterdiği anahtarı yapıştır.');
    if(!await chrome.permissions.request({origins:['http://127.0.0.1/*']}))throw Error('Yerel servis izni verilmedi.');
    await rpc(token?{type:'service-connect',token}:{type:'service-reconnect'});
    serviceInfo={connected:true,tokenPresent:true};$('token').value='';
    $('vocal-status').textContent='Bağlandı. Açık videodaki vokal paneli hazır; sayfayı yenilemene gerek yok.';
  }catch(error){$('vocal-status').textContent=error.message;}
  finally{serviceBusy=false;serviceControls();}
};
$('token').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();$('connect').onclick();}});
$('disconnect').onclick=async()=>{
  if(serviceBusy)return;
  serviceBusy=true;serviceRevision++;serviceControls();
  try{await rpc({type:'service-disconnect'});serviceInfo={connected:false,tokenPresent:false};$('vocal-status').textContent='Bağlantı kesildi. Kayıtların ve yüklenmiş vokal korundu; devam eden hazırlama veya aktarım iptal edildi.';}
  catch(error){$('vocal-status').textContent=error.message;}
  finally{serviceBusy=false;serviceControls();}
};
$('clear-cache').onclick=async()=>{
  $('clear-cache').disabled=true;
  try{await rpc({type:'cache-clear'});$('vocal-status').textContent='Servis klasöründeki eski vokaller silindi. Tarayıcıdaki kayıtların duruyor.';}
  catch(error){$('vocal-status').textContent=error.message;}
  finally{serviceControls();}
};
chrome.storage.local.get({settings:PerdeSettings.defaults}).then(r=>{
  settings=PerdeSettings.normalize(r.settings);for(const id of fields)setField(id,settings[id]);facelessField();refresh();siteList();
}).catch(()=>{$('save').textContent='Ayarlar yüklenemedi. Eklenti panelini kapatıp yeniden aç.';});refreshLibrary();refreshService();setInterval(()=>{if(!document.hidden)refresh();},2000);setInterval(()=>{if(!document.hidden)refreshLibrary();},10000);

setInterval(()=>{if(!document.hidden)refreshService();},5000);
