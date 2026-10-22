(() => {
  'use strict';
  if(globalThis.__perdeAudio||window.top!==window||!/(^|\.)youtube\.com$/.test(location.hostname))return;
  globalThis.__perdeAudio=true;
  let settings=PerdeSettings.normalize(),current=null,mode='idle',jobVideo=null,jobElement=null,epoch=0,pollAt=0,busy=false,syncBusy=false,blocked=false,vocalMuted=false;
  let heartbeatAt=0,heartbeatBusy=false,progressValue=null,checkedVideo=null,checking=false,available=false,suppressedVideo=null,resumeSaved=false,settingsReady=false,navigating=false;
  let serviceReady=null,failedStart=false,lastUseSaved=false;
  // partial: the vocal plays while the rest is still being separated; waiting:
  // the video was paused by us because it caught up with the separated part.
  let partial=false,waiting=false;
  const clientId=crypto.randomUUID();
  const muteStates=new Map();
  const rpc=async message=>{const r=await chrome.runtime.sendMessage({...message,clientId});if(!r?.ok){const error=Error(r?.error||'Ses servisi yanıt vermedi.');error.reload=r?.reload;throw error;}return r;};
  const host=document.createElement('div');host.id='perde-vocal-panel';
  const shadow=host.attachShadow({mode:'closed'});
  shadow.innerHTML=`<style>
    :host{all:initial;position:fixed;right:16px;top:84px;z-index:2147483646;font:13px/1.5 system-ui,sans-serif;color:#edf5f4;color-scheme:dark}
    :host([hidden]),[hidden]{display:none!important}*{box-sizing:border-box}
    details{width:304px;max-width:calc(100vw - 24px);max-height:var(--panel-height,calc(100vh - 108px));overflow:auto;background:#101f27;border:1px solid #334b54;border-radius:16px;box-shadow:0 14px 40px #0005;scrollbar-width:thin}
    summary{position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:10px;min-height:48px;cursor:pointer;padding:12px 14px;background:#101f27;font-weight:700;list-style:none}
    summary::-webkit-details-marker{display:none}summary::after{content:'⌄';margin-left:auto;color:#9cb5bd}details[open] summary::after{content:'⌃'}
    .mark{display:grid;place-items:center;width:27px;height:27px;border-radius:9px;background:#a2efd1;color:#15392d;font-weight:800}.summary-name{letter-spacing:.2px}.badge{font-size:10px;font-weight:650;padding:3px 7px;border-radius:6px;background:#243a43;color:#bed1d6;white-space:nowrap}
    :host([data-state=ready]) .badge{background:#193d32;color:#a2efd1}:host([data-state=error]) .badge{background:#4a3027;color:#ffbf9d}
    section{padding:0 14px 14px;border-top:1px solid #273c46}p{margin:10px 0;font-size:12px;color:#b7c9ce}#status{font-size:13px;color:#edf5f4;line-height:1.6}#help{font-size:11px;color:#94acb5}#language{font-size:11px}
    label{display:flex;align-items:center;gap:8px;margin:12px 0 3px;font-size:12px;cursor:pointer}input[type=checkbox]{width:16px;height:16px;accent-color:#a2efd1;margin:0}
    progress{display:block;width:100%;height:6px;border:0;border-radius:8px;accent-color:#a2efd1;margin:12px 0}
    button{font:650 12px system-ui;min-height:36px;cursor:pointer;border:1px solid transparent;border-radius:9px;padding:8px 11px;margin:5px 5px 0 0;background:#a2efd1;color:#13382b}
    #start,#play,#retry-transfer{width:100%;margin-right:0}#sound{background:#233a43;color:#e2eef0}#cancel{font-size:11px;background:transparent;border-color:#3b535d;color:#b7c9ce}button:hover{filter:brightness(1.08)}button:disabled{opacity:.45;cursor:wait}
    button:focus-visible,summary:focus-visible,input:focus-visible{outline:2px solid #a2efd1;outline-offset:3px}#saved-note{font-size:11px;line-height:1.5;margin-top:5px}.secondary{background:#233a43;color:#e2eef0}
    #drag-panel{padding:2px;margin:0;min-height:28px;width:24px;background:transparent;color:#9cb5bd;cursor:grab;touch-action:none;flex-shrink:0}#drag-panel:active{cursor:grabbing}#reset-panel{background:transparent;color:#9cb5bd;font-size:10px;padding:3px;min-height:24px;margin:0 0 8px}.music-heading{font-weight:650;color:#edf5f4}.music-section label{align-items:center}#background-tracks{max-height:140px;overflow:auto}#background-tracks span{overflow-wrap:anywhere}#music-volume{width:110px;accent-color:#a2efd1}#music-note{font-size:11px;color:#94acb5}
  </style><details id="panel-details"><summary aria-label="Perde vokal kontrollerini aç veya kapat"><button id="drag-panel" aria-label="Paneli sürükle; ok tuşlarıyla taşı" title="Sürükle · ok tuşlarıyla taşı">⠿</button><span class="summary-name">Vokal</span><span id="summary-state" class="badge">Hazır</span></summary><section><button id="reset-panel" title="Paneli otomatik konumuna döndür">Konumu sıfırla</button><p id="status" role="status">Müziği ayır, vokalle izle.</p><progress id="progress" max="100" aria-label="Vokal hazırlama ilerlemesi" hidden></progress><p id="help"></p><button id="start">Vokal oluştur</button><button id="play" hidden>Vokal ile oynat</button><button id="sound" hidden>Vokal sesini kapat</button><button id="cancel" class="secondary" hidden>İptal · asıl sese dön</button></section></details>`;
  const $=id=>shadow.getElementById(id);
  const dragController=globalThis.PerdePanelDrag?.install(host,$('drag-panel'),$('reset-panel'));
  const musicControls=globalThis.PerdeMusicControls?.install(shadow,rpc);
  const saveLabel=document.createElement('label');
  const saveBox=document.createElement('input');saveBox.type='checkbox';saveBox.id='save-vocal';saveBox.checked=true;
  saveLabel.append(saveBox,document.createTextNode(' Vokali tarayıcıda sakla'));
  $('start').before(saveLabel);
  const savedNote=document.createElement('p');savedNote.id='saved-note';savedNote.setAttribute('role','status');saveLabel.after(savedNote);
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
    $('help').textContent=mode==='ready'&&partial?'Kalan kısım sen izlerken hazırlanır; video hazırlanan yere yetişirse kısa süre bekler.':mode==='ready'?'Sarma, hız ve ses düzeyi video ile birlikte değişir.':`Yeni kayıtlar için süre sınırı ${settings.maxMinutes} dakika. Ses bilgisayarında hazırlanır; şarkı sözleri vokalde kalabilir.`;
    host.setAttribute('data-state',mode);
    $('summary-state').textContent=checking?'Kontrol':mode==='ready'&&(waiting||partial&&current?.paused)&&Number.isFinite(progressValue)?`%${Math.round(progressValue)}`:mode==='ready'?(current?.paused?'Duraklatıldı':'Etkin'):mode==='preparing'?(Number.isFinite(progressValue)?`%${Math.round(progressValue)}`:'Hazırlanıyor'):mode==='error'?'Tekrar dene':available?'Kayıtlı':'Müziği ayır';
    $('start').hidden=mode!=='idle'||checking||checkedVideo!==PerdeSettings.videoId(location.href);$('start').textContent=available?'Kayıtlı vokali kullan':'Vokal oluştur';$('play').hidden=mode!=='ready';$('sound').hidden=mode!=='ready';$('cancel').hidden=mode==='idle';
    $('cancel').disabled=busy;$('sound').textContent=vocalMuted?'Vokal sesini aç':'Vokal sesini kapat';
    retryButton.hidden=mode!=='error'||!retryAllowed;saveBox.disabled=busy;
    savedNote.textContent=cacheWarning||(saved?'Bu vokal tarayıcı kitaplığında kayıtlı.':saveBox.checked?'Hazırlanınca tarayıcıya kaydedilecek.':'Yeni vokal geçici tutulur. Varsa kayıtlı kopya kullanılır.');
    const meter=$('progress');meter.hidden=mode!=='preparing'&&!(mode==='ready'&&partial);
    if(Number.isFinite(progressValue))meter.value=progressValue;else meter.removeAttribute('value');
  }
  function keepAlive(){
    if(!['ready','error'].includes(mode)||heartbeatBusy||performance.now()<heartbeatAt)return;
    heartbeatAt=performance.now()+30000;heartbeatBusy=true;const version=epoch;
    rpc({type:'vocal-heartbeat'}).then(result=>{if(version!==epoch)return;if(typeof result.saved==='boolean')saved=result.saved;if(typeof result.saveVocal==='boolean')saveBox.checked=result.saveVocal;cacheWarning=result.cacheWarning||null;}).catch(error=>{if(version===epoch)fail(error);}).finally(()=>{heartbeatBusy=false;});
  }
  function fail(error){mode='error';jobElement?.pause();$('panel-details').open=true;render(error.message+' Asıl sese dönmek için iptal et.');}
  async function cancel(manual=false){
    if(saved)available=true;
    if(manual)suppressedVideo=PerdeSettings.videoId(location.href);
    failedStart=false;
    jobElement?.pause();epoch++;mode='idle';partial=false;waiting=false;jobVideo=null;jobElement=null;pollAt=0;heartbeatAt=0;progressValue=null;audioSelection=null;saved=false;cacheWarning=null;retryTransfer=false;statusFailures=0;retryAllowed=false;resumeSaved=false;
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
      const result=await rpc({type:'vocal-sync',time:video.currentTime,rate:video.playbackRate,volume:vocalMuted?0:video.volume,playing:!video.paused&&!video.ended&&!video.seeking&&!blocked&&!ad()&&video.readyState>=3});
      if(version!==epoch)return;
      musicControls?.warning(result.musicWarning);
      partial=result.complete===false;
      if(Number.isFinite(result.progress))progressValue=result.progress;
      // The video waits at the end of the separated part and continues once
      // enough is ready, so the vocal never falls silent mid-scene.
      const ahead=partial&&Number.isFinite(result.availableUntil)?result.availableUntil-video.currentTime:Infinity;
      if(ahead<1.5&&!video.paused&&!video.ended){waiting=true;video.pause();}
      else if(waiting&&(ahead>=10||!partial)){waiting=false;video.play().catch(()=>{});}
      if(waiting)render(`Vokalin bu kısmı hazırlanıyor${Number.isFinite(progressValue)?` · %${Math.round(progressValue)}`:''}. Video birkaç saniye içinde kendiliğinden devam eder.`);
      else if(partial&&!video.paused)render(`Vokal oynatılıyor; kalan kısım hazırlanıyor${Number.isFinite(progressValue)?` · %${Math.round(progressValue)}`:''}.`);
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
  const title=()=>String(document.querySelector('ytd-watch-metadata h1 yt-formatted-string')?.textContent||document.title||'YouTube videosu').replace(/ - YouTube$/,'').trim().slice(0,300);
  async function begin(useSaved=false,automatic=false){
    if(busy||mode!=='idle')return;
    const video=current,id=PerdeSettings.videoId(location.href);
    if(!video||!id||ad()){render('Önce videonun başlamasını ve reklamın bitmesini bekle.');return;}
    if(!useSaved&&(!Number.isFinite(video.duration)||video.duration<=0||video.duration>settings.maxMinutes*60)){render(`Canlı yayınlar ve ${settings.maxMinutes} dakikadan uzun videolar desteklenmiyor.`);return;}
    lastUseSaved=useSaved;failedStart=false;
    resumeSaved=automatic&&!video.paused;
    busy=true;progressValue=null;const version=++epoch;jobElement=video;jobVideo=id;vocalMuted=muteStates.get(video)?.original??video.muted;mode='preparing';if(!automatic)$('panel-details').open=true;video.pause();forceMute(video,true);render(useSaved?'Kayıtlı vokal açılıyor…':'Ses indiriliyor ve ayrılıyor. Video duraklatıldı…');
    try{await rpc({type:useSaved?'vocal-use-saved':'vocal-start',videoId:id,title:title(),saveVocal:saveBox.checked});if(version!==epoch)await rpc({type:'vocal-cancel'}).catch(()=>{});else retryAllowed=true;}
    catch(error){if(version===epoch){failedStart=true;fail(error);}}finally{busy=false;}
  }
  $('start').onclick=()=>begin(available);
  $('cancel').onclick=()=>{if(!busy)return cancel(true);};
  retryButton.onclick=()=>{if(busy)return;mode='preparing';retryTransfer=true;statusFailures=0;pollAt=0;render('Mevcut vokal oturumuna yeniden bağlanılıyor…');};
  saveBox.onchange=async()=>{
    try{await chrome.storage.local.set({saveVocals:saveBox.checked});}catch{cacheWarning='Kayıt tercihi saklanamadı. Yeniden dene.';render();return;}
    if(mode==='idle'){render();return;}
    const version=epoch;busy=true;
    try{const result=await rpc({type:'vocal-retain',saveVocal:saveBox.checked});if(version===epoch){saved=result.saved===true;cacheWarning=result.cacheWarning||null;}}
    catch(error){if(version===epoch)cacheWarning=error.message;}
    finally{busy=false;render();}
  };
  $('play').onclick=async()=>{try{if(jobElement.paused&&!waiting)await jobElement.play();else{waiting=false;jobElement.pause();}await synchronize();}catch(error){fail(error);}};
  $('sound').onclick=()=>{vocalMuted=!vocalMuted;render();synchronize();};
  function positionPanel(video){
    const target=document.fullscreenElement?.tagName!=='VIDEO'&&document.fullscreenElement||document.documentElement;
    if(target&&host.parentElement!==target)target.append(host);
    if(dragController?.apply())return;
    const rect=video?.getBoundingClientRect?.(),width=window.innerWidth,height=window.innerHeight;
    if(!rect||!width||!height||!host.style)return;
    const panelWidth=Math.min(304,width-24),gap=12,header=document.fullscreenElement?12:72;
    let left=Math.max(gap,width-panelWidth-gap),top=header,maxHeight=height-header-gap;
    if(rect.width>=240&&rect.height>=160&&rect.bottom>header&&rect.top<height){
      if(width-rect.right>=panelWidth+gap*2){left=rect.right+gap;top=Math.max(header,rect.top);maxHeight=height-top-gap;}
      else if(height-rect.bottom>=180){left=Math.max(gap,Math.min(width-panelWidth-gap,rect.right-panelWidth));top=rect.bottom+gap;maxHeight=height-top-gap;}
      else{left=Math.max(gap,Math.min(width-panelWidth-gap,rect.right-panelWidth-gap));top=Math.max(header,rect.top+gap);maxHeight=Math.min(height-top-gap,rect.bottom-96-top);}
    }
    // The video toolbar's bottom band remains outside our interactive panel.
    host.style.left=`${Math.round(left)}px`;host.style.right='auto';host.style.top=`${Math.round(top)}px`;host.style.bottom='auto';
    host.style.setProperty('--panel-height',`${Math.max(48,Math.round(maxHeight))}px`);
  }
  async function tick(){
    const video=document.querySelector('video.html5-main-video')||document.querySelector('video');
    positionPanel(video);
    const id=PerdeSettings.videoId(location.href);
    if(jobVideo&&(id!==jobVideo||video!==jobElement)){await cancel();checkedVideo=null;}
    bind(video);
    if(serviceReady&&!busy&&!navigating){
      const event=serviceReady;serviceReady=null;
      if(mode==='idle'){checkedVideo=null;}
      else if(settings.vocalEnabled&&jobVideo===id&&((mode==='error'&&failedStart)||event.reset&&mode!=='ready')){
        const useSaved=lastUseSaved;await cancel();await begin(useSaved);
      }else if(mode==='error'&&retryAllowed){mode='preparing';retryTransfer=true;statusFailures=0;pollAt=0;render('Servis bağlandı. Mevcut vokal oturumuna devam ediliyor…');}
    }
    if(checkedVideo!==id&&mode==='idle'&&!checking&&!navigating&&settingsReady&&settings.vocalEnabled&&video&&id&&!ad()){
      if(suppressedVideo!==id)suppressedVideo=null;
      checking=true;available=false;const version=epoch;
      forceMute(video,true);
      render('Kayıtlı vokal kontrol ediliyor…');
      try{
        const result=await rpc({type:'vocal-lookup',videoId:id});
        if(version!==epoch||id!==PerdeSettings.videoId(location.href))return;
        checkedVideo=id;available=result.available===true;checking=false;
        if(available&&suppressedVideo!==id)await begin(true,true);
        else render(available?'Kayıtlı vokal hazır. İstersen tekrar açabilirsin.':'Müziği ayır, vokalle izle.');
      }catch(error){if(version===epoch){checkedVideo=id;cacheWarning='Kayıtlar kontrol edilemedi: '+error.message;render();}}
      finally{checking=false;}
    }
    for(const item of muteStates.keys())if(!item.isConnected)forceMute(item,false);
    forceMute(current,!!current&&(mode!=='idle'||checking||settings.muteAds&&ad()));
    if(mode==='preparing'||mode==='error')current?.pause();
    render();
    if(mode==='error'&&retryAllowed)keepAlive();
    if(mode==='ready'){$('play').textContent=current?.paused?'Vokal ile oynat':'Duraklat';keepAlive();await synchronize();}
    if(mode==='preparing'&&!busy&&performance.now()>pollAt){
      busy=true;pollAt=performance.now()+1800;const version=epoch;
      try{const result=await rpc({type:'vocal-status',retry:retryTransfer});if(version!==epoch)return;
        retryTransfer=false;statusFailures=0;saved=result.saved===true;cacheWarning=result.cacheWarning||null;
        if(result.audioSelection==='turkish'||result.audioSelection==='fallback')audioSelection=result.audioSelection;
        if(result.state==='ready'){
          mode='ready';available=saved||available;partial=result.complete===false;
          render(result.cached?'Kayıtlı vokal hazır; yeniden ses ayırma yapılmadı.':partial?'Vokalin ilk bölümü hazır. Oynat’a bas; kalan kısım sen izlerken hazırlanır.':'Vokal hazır. Oynat düğmesine basarak devam et.');
          if(resumeSaved){resumeSaved=false;try{await jobElement.play();await synchronize();}catch{render('Kayıtlı vokal hazır. Devam etmek için Vokal ile oynat’a bas.');}}
        }
        else if(result.state==='error'||result.state==='transfer-error'){retryAllowed=result.state!=='error';fail(Error(result.error||'Ses ayrılamadı.'));}
        else{
          progressValue=Number.isFinite(result.progress)?result.progress:null;
          const percent=progressValue===null?'':` · %${Math.round(progressValue)}`;
          const remaining=result.state==='separating'&&result.remainingSeconds>0?` Yaklaşık ${Math.max(1,Math.ceil(result.remainingSeconds/60))} dakika kaldı.`+(result.device==='gpu'?' Ekran kartı kullanılıyor.':''):'';
          render((result.state==='separating'?'Müzik ayrılıyor':result.state==='encoding'?'Vokal oynatmaya hazırlanıyor':result.state==='transferring'?'Hazır vokal tarayıcıya aktarılıyor':'Ses indiriliyor')+percent+'.'+remaining+' Video duraklatıldı.');
        }
      }catch(error){if(version===epoch){if(++statusFailures<8)render('Bağlantı yeniden deneniyor; mevcut ses ayırma işlemi korunuyor…');else fail(error);}}finally{busy=false;}
    }
  }
  let previousAd=false;
  const observer=new MutationObserver(()=>{const showing=ad();forceMute(current,!!current&&(mode!=='idle'||checking||settings.muteAds&&showing));if(showing!==previousAd){previousAd=showing;synchronize();}});
  observer.observe(document,{subtree:true,attributes:true,attributeFilter:['class']});
  chrome.storage.local.get({settings:PerdeSettings.defaults,saveVocals:true}).then(r=>{settings=PerdeSettings.normalize(r.settings);saveBox.checked=r.saveVocals!==false;settingsReady=true;render();});
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area!=='local')return;
    if(changes.serviceReady)serviceReady=changes.serviceReady.newValue;
    if(changes.vocalLibraryChanged&&mode==='idle')checkedVideo=null;
    if(changes.settings){settings=PerdeSettings.normalize(changes.settings.newValue);if(!settings.vocalEnabled&&mode!=='idle')cancel();render();}
  });
  document.addEventListener('yt-navigate-start',()=>{navigating=true;checkedVideo=null;if(mode!=='idle')cancel();else epoch++;});
  document.addEventListener('yt-navigate-finish',()=>{navigating=false;});
  window.addEventListener('pagehide',()=>{if(mode!=='idle')rpc({type:'vocal-cancel'}).catch(()=>{});});
  let ticking=false;setInterval(async()=>{if(ticking)return;ticking=true;try{await tick();}finally{ticking=false;}},250);
})();
