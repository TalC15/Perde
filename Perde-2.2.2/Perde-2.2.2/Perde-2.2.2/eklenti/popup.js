'use strict';
const $=id=>document.getElementById(id);
let settings=PerdeSettings.normalize(),activeTab=null,tabStatus=null;
const fields=['enabled','profile','pauseOnError','muteAds','blockGambling','vocalEnabled','maxMinutes'];
async function rpc(message){const r=await chrome.runtime.sendMessage(message);if(!r?.ok)throw Error(r?.error||'İşlem tamamlanamadı.');return r;}
async function refresh(){
  try{
    [activeTab]=await chrome.tabs.query({active:true,currentWindow:true});
    tabStatus=await chrome.tabs.sendMessage(activeTab.id,{type:'status'},{frameId:0});
    $('status').textContent=tabStatus.error?'Görsel analizi sorunu var':tabStatus.enabled?'İnsan maskeleme etkin':'İnsan maskeleme kapalı';
    $('detail').textContent=tabStatus.error||'Algılanan bütün insan bölgeleri otomatik örtülür. Ses ayarları bağımsızdır.';
    $('counts').textContent=`${tabStatus.frames} video karesi · ${tabStatus.images} görsel · son karede ${tabStatus.people} insan · ${tabStatus.ms} ms`;
  }catch{$('status').textContent='Bu sayfada koruma çalışmıyor';$('detail').textContent='YouTube sayfasını yenile veya aşağıdan bu siteye izin ver.';$('counts').textContent='';tabStatus=null;}
}
let saveQueue=Promise.resolve();
function save(){
  const raw={};for(const key of fields)raw[key]=$(key).type==='checkbox'?$(key).checked:$(key).value;
  settings=PerdeSettings.normalize(raw);const value={...settings};
  saveQueue=saveQueue.then(()=>chrome.storage.local.set({settings:value})).then(()=>{$('save').textContent='Ayarlar kaydedildi';return refresh();}).catch(error=>{$('save').textContent=error.message;});
}
for(const id of fields)$(id).addEventListener('change',save);
$('retry').onclick=async()=>{try{await chrome.tabs.sendMessage(activeTab.id,{type:'retry'});$('save').textContent='Analiz yeniden başlatıldı';}catch{$('save').textContent='Önce korumanın açık olduğu sayfayı yenile.';}};
$('check').onclick=async()=>{$('save').textContent='Yerel modeller kontrol ediliyor…';try{const r=await rpc({type:'model-check'});$('save').textContent=r.warning||`İnsan${r.faceReady?' + yüz':''} modelleri hazır (${r.backend})`;}catch(error){$('save').textContent=error.message;}};
$('test').onclick=()=>chrome.tabs.create({url:chrome.runtime.getURL('test.html')});
$('diagnostic').onclick=async()=>{
  try{await navigator.clipboard.writeText(JSON.stringify({version:chrome.runtime.getManifest().version,model:tabStatus?.model,frames:tabStatus?.frames,images:tabStatus?.images,error:tabStatus?.error},null,2));$('save').textContent='Hata bilgisi kopyalandı. Sayfa adresi ve video kimliği dahil edilmedi.';}
  catch(error){$('save').textContent=error.message;}
};
async function siteList(){
  const {siteOrigins=[]}=await chrome.storage.local.get('siteOrigins');$('sites').replaceChildren();
  for(const origin of siteOrigins){
    const li=document.createElement('li'),button=document.createElement('button');li.append(document.createTextNode(new URL(origin).host+' '));button.textContent='Kaldır';
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
    await chrome.scripting.executeScript({target:{tabId:activeTab.id,allFrames:true},files:['settings.js','tracking.js','motion.js','content.js','audio-content.js','gambling.js']});
    $('site-status').textContent='İzin verildi. Önceden kaldırdıysan sayfayı yenile.';await siteList();await refresh();
  }catch(error){$('site-status').textContent=error.message;}
};
$('connect').onclick=async()=>{
  try{
    const token=$('token').value.trim();if(!/^[-\w]{32,128}$/.test(token))throw Error('Servisin gösterdiği anahtarı yapıştır.');
    if(!await chrome.permissions.request({origins:['http://127.0.0.1/*']}))throw Error('Yerel servis izni verilmedi.');
    await rpc({type:'service-connect',token});$('token').value='';$('vocal-status').textContent='Yerel servis bağlı. YouTube’daki Vokal kutusunu kullan.';
  }catch(error){$('vocal-status').textContent=error.message;}
};
$('disconnect').onclick=async()=>{try{await rpc({type:'service-disconnect'});$('vocal-status').textContent='Oturum anahtarı ve etkin ses temizlendi.';}catch(error){$('vocal-status').textContent=error.message;}};
$('clear-cache').onclick=async()=>{try{await rpc({type:'cache-clear'});$('vocal-status').textContent='Kaydedilmiş vokaller silindi. Etkin ses oturumu oynatılabilir.';}catch(error){$('vocal-status').textContent=error.message;}};
chrome.storage.local.get({settings:PerdeSettings.defaults}).then(r=>{
  settings=PerdeSettings.normalize(r.settings);for(const id of fields){if($(id).type==='checkbox')$(id).checked=settings[id];else $(id).value=String(settings[id]);}refresh();siteList();
});setInterval(refresh,2000);
