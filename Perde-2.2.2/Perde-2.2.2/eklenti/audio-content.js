(() => {
  'use strict';
  if(globalThis.__perdeAudio||window.top!==window||!/(^|\.)youtube\.com$/.test(location.hostname))return;
  globalThis.__perdeAudio=true;
  let settings=PerdeSettings.normalize(),current=null,mode='idle',jobVideo=null,jobElement=null,epoch=0,pollAt=0,busy=false,syncBusy=false,blocked=false,vocalMuted=false;
  let heartbeatAt=0,heartbeatBusy=false,progressValue=null;
  const muteStates=new Map();
  const rpc=async message=>{const r=await chrome.runtime.sendMessage(message);if(!r?.ok){const error=Error(r?.error||'Ses servisi yanıt vermedi.');error.reload=r?.reload;throw error;}return r;};
  const host=document.createElement('div');host.id='perde-vocal-panel';
  const shadow=host.attachShadow({mode:'closed'});
  shadow.innerHTML=`<style>:host{all:initial;position:fixed;right:18px;bottom:22px;z-index:2147483646;font:13px/1.5 system-ui;color:#ecf4f7}:host([hidden]){display:none!important}details{box-sizing:border-box;width:280px;background:#142530;border:1px solid #527566;border-radius:12px;box-shadow:0 4px 24px #0005}summary{cursor:pointer;padding:11px 14px;font-weight:700;color:#9be9c9}section{padding:0 14px 14px}p{margin:7px 0;font-size:12px}progress{width:100%;height:8px;accent-color:#9be9c9}button{font:600 12px system-ui;cursor:pointer;border:0;border-radius:6px;padding:9px;margin:4px 4px 0 0;background:#9be9c9;color:#142530}button:disabled{opacity:.5;cursor:wait}[hidden]{display:none!important}button:focus-visible,summary:focus-visible{outline:2px solid white;outline-offset:2px}.secondary{background:#304a58;color:#fff}</style><details><summary>Perde · Vokal</summary><section><p id="status" role="status">Müziği ayır, vokalle izle.</p><progress id="progress" max="100" aria-label="Vokal hazırlama ilerlemesi" hidden></progress><p id="help"></p><button id="start">Vokal oluştur</button><button id="play" hidden>Vokal ile oynat</button><button id="sound" hidden>Vokal sesini kapat</button><button id="cancel" class="secondary" hidden>İptal · asıl sese dön</button></section></details>`;
  const $=id=>shadow.getElementById(id);
  const saveLabel=document.createElement('label');
  const saveBox=document.createElement('input');saveBox.type='checkbox';saveBox.id='save-vocal';
  saveLabel.append(saveBox,document.createTextNode(' Vokali bu bilgisayarda sakla'));
  $('start').before(saveLabel);
  const savedNote=document.createElement('p');savedNote.setAttribute('role','status');saveLabel.after(savedNote);
  const retryButton=document.createElement('button');retryButton.id='retry-transfer';retryButton.textContent='Hazır sesi / bağlantıyı yeniden dene';retryButton.hidden=true;$('cancel').before(retryButton);
  let saved=false,cacheWarning=null,retryTransfer=false,statusFailures=0,retryAllowed=false;
  const language=document.createElement('p');language.id='language';language.setAttribute('role','status');$('help').before(language);
  let audioSelection=null;
  function ad(){return !!document.querySelector('.html5-video-player.ad-showing,.html5-video-player.ad-interrupting');}
  function forceMute(video,on){
    if(!video)return;
    if(on){
      if(!muteStates.has(video)){
        const state={original:video.muted};
        state.listener=()=>{if(muteStates.has(video)&&!video.muted)video.muted=true;};
        muteStates.set(video,state);video.addEventListener('volumechange',state.listener);
      }
      if(!video.muted)video.muted=true;
    }else{const state=muteStates.get(video);if(state){muteStates.delete(video);video.removeEventListener('volumechange',state.listener);video.muted=state.original;}}
  }
  function render(text){
    if(text)$('status').textContent=text;
    language.textContent=audioSelection==='turkish'?'Türkçe ses kullanılıyor.':audioSelection==='fallback'?'Türkçe ses parçasına ulaşılamadı; mevcut ses kullanılıyor.':'Türkçe ses varsa otomatik seçilir.';
    host.hidden=!settings.vocalEnabled||!PerdeSettings.videoId(location.href);
    $('help').textContent=`En fazla ${settings.maxMinutes} dakika. Video kimliği yerel servise gönderilir; servis sesi YouTube’dan indirir. Süre donanımına bağlıdır. Şarkı sözleri de vokalde kalabilir.`;
    $('start').hidden=mode!=='idle';$('play').hidden=mode!=='ready';$('sound').hidden=mode!=='ready';$('cancel').hidden=mode==='idle';
    $('cancel').disabled=busy;$('sound').textContent=vocalMuted?'Vokal sesini aç':'Vokal sesini kapat';
    retryButton.hidden=mode!=='error'||!retryAllowed;saveBox.disabled=busy;
    savedNote.textContent=cacheWarning||(saved?'Bu vokal bilgisayarında kayıtlı.':saveBox.checked?'Hazırlanınca kaydedilecek.':'Yeni vokal geçici tutulur. Varsa kayıtlı kopya kullanılır.');
    const meter=$('progress');meter.hidden=mode!=='preparing';
    if(Number.isFinite(progressValue))meter.value=progressValue;else meter.removeAttribute('value');
  }
  function keepAlive(){
    if(!['ready','error'].includes(mode)||heartbeatBusy||performance.now()<heartbeatAt)return;
    heartbeatAt=performance.now()+30000;heartbeatBusy=true;const version=epoch;
    rpc({type:'vocal-heartbeat'}).then(result=>{if(version!==epoch)return;if(typeof result.saved==='boolean')saved=result.saved;if(typeof result.saveVocal==='boolean')saveBox.checked=result.saveVocal;cacheWarning=result.cacheWarning||null;}).catch(error=>{if(version===epoch)fail(error);}).finally(()=>{heartbeatBusy=false;});
  }
  function fail(error){mode='error';jobElement?.pause();render(error.message+' Asıl sese dönmek için iptal et.');}
  async function cancel(){
    jobElement?.pause();epoch++;mode='idle';jobVideo=null;jobElement=null;pollAt=0;heartbeatAt=0;progressValue=null;audioSelection=null;saved=false;cacheWarning=null;retryTransfer=false;statusFailures=0;retryAllowed=false;saveBox.checked=false;
    // Stop separated audio before restoring the source's mute state.
    await rpc({type:'vocal-cancel'}).catch(()=>{});
    for(const video of muteStates.keys())if(!settings.muteAds||!ad()||video!==current)forceMute(video,false);
    render('Vokal kapalı. Video duraklatıldığı yerde kalır.');
  }
  async function synchronize(){
    if(mode!=='ready'||!jobElement||syncBusy)return;
    syncBusy=true;const version=epoch;
    try{
      const video=jobElement;
      await rpc({type:'vocal-sync',time:video.currentTime,rate:video.playbackRate,volume:vocalMuted?0:video.volume,playing:!video.paused&&!video.ended&&!video.seeking&&!blocked&&!ad()&&video.readyState>=3});
    }catch(error){if(version===epoch){if(error.reload){jobElement.pause();mode='preparing';pollAt=0;render('Vokal yeniden yükleniyor…');}else fail(error);}}
    finally{syncBusy=false;}
  }
  function onPlayback(event){
    blocked=event.type==='waiting'||event.type==='stalled'?true:event.type==='playing'||event.type==='canplay'?false:blocked;
    if(mode==='preparing'||mode==='error')current?.pause();
    synchronize();
  }
  function bind(video){
    if(current===video)return;
    if(current){for(const event of ['play','pause','seeking','seeked','ratechange','volumechange','waiting','stalled','playing','canplay','ended'])current.removeEventListener(event,onPlayback);forceMute(current,false);}
    current=video;blocked=false;
    if(current)for(const event of ['play','pause','seeking','seeked','ratechange','volumechange','waiting','stalled','playing','canplay','ended'])current.addEventListener(event,onPlayback);
  }
  $('start').onclick=async()=>{
    if(busy||mode!=='idle')return;
    const video=current,id=PerdeSettings.videoId(location.href);
    if(!video||!id||ad()){render('Önce videonun başlamasını ve reklamın bitmesini bekle.');return;}
    if(!Number.isFinite(video.duration)||video.duration<=0||video.duration>settings.maxMinutes*60){render(`Canlı yayınlar ve ${settings.maxMinutes} dakikadan uzun videolar desteklenmiyor.`);return;}
    busy=true;progressValue=null;const version=++epoch;jobElement=video;jobVideo=id;vocalMuted=video.muted;mode='preparing';video.pause();forceMute(video,true);render('Ses indiriliyor ve ayrılıyor. Video duraklatıldı…');
    try{await rpc({type:'vocal-start',videoId:id,saveVocal:saveBox.checked});if(version!==epoch)await rpc({type:'vocal-cancel'}).catch(()=>{});else retryAllowed=true;}
    catch(error){if(version===epoch)fail(error);}finally{busy=false;}
  };
  $('cancel').onclick=()=>{if(!busy)cancel();};
  retryButton.onclick=()=>{if(busy)return;mode='preparing';retryTransfer=true;statusFailures=0;pollAt=0;render('Mevcut vokal oturumuna yeniden bağlanılıyor…');};
  saveBox.onchange=async()=>{
    if(mode==='idle'){render();return;}
    const version=epoch;busy=true;
    try{const result=await rpc({type:'vocal-retain',saveVocal:saveBox.checked});if(version===epoch){saved=result.saved===true;cacheWarning=result.cacheWarning||null;}}
    catch(error){if(version===epoch)cacheWarning=error.message;}
    finally{busy=false;render();}
  };
  $('play').onclick=async()=>{try{if(jobElement.paused)await jobElement.play();else jobElement.pause();await synchronize();}catch(error){fail(error);}};
  $('sound').onclick=()=>{vocalMuted=!vocalMuted;render();synchronize();};
  async function tick(){
    if(!host.isConnected&&document.documentElement)document.documentElement.append(host);
    const video=document.querySelector('video.html5-main-video')||document.querySelector('video');
    const id=PerdeSettings.videoId(location.href);
    if(jobVideo&&(id!==jobVideo||video!==jobElement)){await cancel();}
    bind(video);
    for(const item of muteStates.keys())if(!item.isConnected)forceMute(item,false);
    forceMute(current,!!current&&(mode!=='idle'||settings.muteAds&&ad()));
    if(mode==='preparing'||mode==='error')current?.pause();
    render();
    if(mode==='error'&&retryAllowed)keepAlive();
    if(mode==='ready'){$('play').textContent=current?.paused?'Vokal ile oynat':'Duraklat';keepAlive();await synchronize();}
    if(mode==='preparing'&&!busy&&performance.now()>pollAt){
      busy=true;pollAt=performance.now()+1800;const version=epoch;
      try{const result=await rpc({type:'vocal-status',retry:retryTransfer});if(version!==epoch)return;
        retryTransfer=false;statusFailures=0;saved=result.saved===true;cacheWarning=result.cacheWarning||null;
        if(result.audioSelection==='turkish'||result.audioSelection==='fallback')audioSelection=result.audioSelection;
        if(result.state==='ready'){mode='ready';render(result.cached?'Kayıtlı vokal hazır; yeniden ses ayırma yapılmadı.':'Vokal hazır. Oynat düğmesine basarak devam et.');}
        else if(result.state==='error'||result.state==='transfer-error'){retryAllowed=result.state!=='error';fail(Error(result.error||'Ses ayrılamadı.'));}
        else{
          progressValue=Number.isFinite(result.progress)?result.progress:null;
          const percent=progressValue===null?'':` · %${Math.round(progressValue)}`;
          const remaining=result.state==='separating'&&result.remainingSeconds>0?` Yaklaşık ${Math.max(1,Math.ceil(result.remainingSeconds/60))} dakika kaldı.`:'';
          render((result.state==='separating'?'Müzik ayrılıyor':result.state==='encoding'?'Vokal oynatmaya hazırlanıyor':result.state==='transferring'?'Hazır vokal tarayıcıya aktarılıyor':'Ses indiriliyor')+percent+'.'+remaining+' Video duraklatıldı.');
        }
      }catch(error){if(version===epoch){if(++statusFailures<4)render('Bağlantı yeniden deneniyor; mevcut ses ayırma işlemi korunuyor…');else fail(error);}}finally{busy=false;}
    }
  }
  let previousAd=false;
  const observer=new MutationObserver(()=>{const showing=ad();forceMute(current,!!current&&(mode!=='idle'||settings.muteAds&&showing));if(showing!==previousAd){previousAd=showing;synchronize();}});
  observer.observe(document,{subtree:true,attributes:true,attributeFilter:['class']});
  chrome.storage.local.get({settings:PerdeSettings.defaults}).then(r=>{settings=PerdeSettings.normalize(r.settings);render();});
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.settings){settings=PerdeSettings.normalize(changes.settings.newValue);if(!settings.vocalEnabled&&mode!=='idle')cancel();render();}});
  document.addEventListener('yt-navigate-start',()=>{if(mode!=='idle')cancel();});
  window.addEventListener('pagehide',()=>{if(mode!=='idle')chrome.runtime.sendMessage({type:'vocal-cancel'}).catch(()=>{});});
  let ticking=false;setInterval(async()=>{if(ticking)return;ticking=true;try{await tick();}finally{ticking=false;}},250);
})();
