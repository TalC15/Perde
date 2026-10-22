(() => {
  'use strict';
  if(globalThis.__perdeVisual)return;globalThis.__perdeVisual=true;
  const DEFAULTS=PerdeSettings.normalize();
  let settings={...DEFAULTS},generation=0,siteDisabled=false;
  const records=new Map(),parents=new WeakMap();const diagnostics=[];
  const intersections=new IntersectionObserver(entries=>{for(const entry of entries){const record=records.get(entry.target);if(record){record.inView=entry.isIntersecting;if(!record.inView)record.layer.style.display='none';}}},{rootMargin:'160px'});
  const status={version:'3.1.0',model:'hazırlanıyor',frames:0,images:0,people:0,covered:0,visible:0,ms:0,genderReady:false,error:null};
  let inferenceBusy=false,scheduled=false;
  const {Tracker,contentRect,expanded,settle}=PerdeTracking;
  // Blob masks are painted from a tiny copy of the region: no detail survives.
  const BLOB_W=6,BLOB_H=8,MASK_W=24,MASK_H=32,LEAVE_MS=260,CUT_DIFFERENCE=38;
  const tiny=document.createElement('canvas');tiny.width=BLOB_W;tiny.height=BLOB_H;
  const tinyContext=tiny.getContext('2d');
  const debug=()=>document.documentElement.dataset.perdeDebug==='true';
  const rpc=async message=>{
    const result=await chrome.runtime.sendMessage(message);
    if(!result?.ok)throw Error(result?.error||'Yerel analiz bölümünden cevap alınamadı.');
    return result;
  };
  function report(error){status.error=String(error?.message||error).slice(0,350);diagnostics.push(status.error);if(diagnostics.length>15)diagnostics.shift();}
  function isControlImage(element){
    return element.tagName==='IMG'&&Boolean(element.closest('button,[role="button"],[role="slider"],[role="menuitem"],[role="switch"],[role="checkbox"],[role="tab"],[role="toolbar"],.ytp-chrome-bottom,.ytp-chrome-top,.ytp-settings-menu,.vjs-control-bar,.plyr__controls,.jw-controlbar'));
  }
  function releaseParent(parent){
    const state=parents.get(parent);if(!state)return;
    if(--state.count===0){if(state.changed&&parent.style.position==='relative')parent.style.position=state.original;parents.delete(parent);}
  }
  function clearAnalysis(record){
    record.epoch++;record.tracker.reset();record.staticBoxes=[];record.history=[];record.motionBoxes=null;
    record.processed=false;record.error=null;record.retryAt=0;record.time=-1;
  }
  function attach(element){
    if(records.has(element))return;
    if(element.closest('#perde-vocal-panel')||isControlImage(element))return;
    const type=element.tagName==='VIDEO'?'video':'image';
    const layer=document.createElement('div');layer.setAttribute('data-perde-layer',type);layer.setAttribute('aria-hidden','true');
    const label=document.createElement('span');label.setAttribute('data-perde-label','');layer.append(label);
    const record={element,type,layer,label,tracker:new Tracker(),masks:new Map(),notes:new Map(),source:null,time:-1,last:0,observedAt:0,epoch:0,processed:false,error:null,retryAt:0,cleanups:[],history:[],motionBoxes:null,motionAt:0,sequence:0,drawnAt:0};
    records.set(element,record);
    record.inView=false;intersections.observe(element);
    const reset=()=>{clearAnalysis(record);record.last=0;
      if(settings.enabled&&type==='video')element.setAttribute('data-perde-starting','true');};
    if(type==='video'){
      for(const name of ['seeking','emptied','loadstart','loadedmetadata']){element.addEventListener(name,reset);record.cleanups.push(()=>element.removeEventListener(name,reset));}
      record.originalPip=element.disablePictureInPicture;element.disablePictureInPicture=settings.enabled||record.originalPip;
      if(settings.enabled)element.setAttribute('data-perde-starting','true');
    }else if(settings.enabled)element.setAttribute('data-perde-pending','true');
    locate(record);
  }
  function locate(record){
    const {element,layer}=record;const parent=element.parentElement;if(!parent)return;
    if(layer.parentElement!==parent){
      if(record.parent)releaseParent(record.parent);
      record.parent=parent;
      let state=parents.get(parent);
      if(!state){state={count:0,original:parent.style.position,changed:getComputedStyle(parent).position==='static'};parents.set(parent,state);if(state.changed)parent.style.position='relative';}
      state.count++;
      element.after(layer);
    }
    // Keep the media's stacking order, without lowering any player controls or
    // raising a mask over sibling menus. Adjacent placement preserves DOM order.
    if(element.nextElementSibling!==layer)element.after(layer);
    const mediaStyle=getComputedStyle(element);
    layer.style.setProperty('--perde-stack',mediaStyle.zIndex==='auto'?'0':mediaStyle.zIndex);
    const rect=element.getBoundingClientRect(),base=parent.getBoundingClientRect();
    const scaleX=parent.offsetWidth?base.width/parent.offsetWidth:1,scaleY=parent.offsetHeight?base.height/parent.offsetHeight:1;
    const sx=scaleX||1,sy=scaleY||1,width=rect.width/sx,height=rect.height/sy;
    layer.style.left=`${(rect.left-base.left)/sx+parent.scrollLeft-parent.clientLeft}px`;
    layer.style.top=`${(rect.top-base.top)/sy+parent.scrollTop-parent.clientTop}px`;
    layer.style.width=`${width}px`;layer.style.height=`${height}px`;
    return {...rect,width,height};
  }
  function remove(element,record){
    intersections.unobserve(element);
    record.epoch++;for(const cleanup of record.cleanups)cleanup();record.layer.remove();
    element.removeAttribute('data-perde-pending');element.removeAttribute('data-perde-starting');
    if(record.type==='video')element.disablePictureInPicture=record.originalPip;
    if(record.parent)releaseParent(record.parent);
    records.delete(element);
  }
  function scan(){
    scheduled=false;
    for(const element of document.querySelectorAll('video,img'))attach(element);
    for(const [element,record]of records)if(!element.isConnected||isControlImage(element))remove(element,record);
  }
  const observer=new MutationObserver(()=>{if(!scheduled){scheduled=true;requestAnimationFrame(scan);}});
  observer.observe(document,{childList:true,subtree:true});
  function visible(rect){return rect.width>=16&&rect.height>=16&&rect.bottom>0&&rect.top<innerHeight&&rect.right>0&&rect.left<innerWidth;}
  function mediaVisible(element,rect){
    if(!visible(rect))return false;
    const style=getComputedStyle(element);
    if(style.visibility!=='visible'||style.display==='none'||Number(style.opacity)===0)return false;
    return !element.checkVisibility||element.checkVisibility({checkOpacity:true,checkVisibilityCSS:true});
  }
  const covers=item=>settings.target==='all'||!item.male;
  function paint(record,mask,box,now){
    // Soft colour field taken from the covered region itself; repainted ~4 times/s.
    if(settings.maskStyle!=='blur'){if(mask.painted){mask.getContext('2d').clearRect(0,0,MASK_W,MASK_H);mask.painted=false;}return;}
    if(now-(mask.paintedAt||0)<240)return;
    mask.paintedAt=now;
    const element=record.element,motion=record.type==='video'&&record.motionReady;
    const source=motion?record.motionCanvas:element;
    const sw=motion?source.width:record.type==='video'?element.videoWidth:element.naturalWidth;
    const sh=motion?source.height:record.type==='video'?element.videoHeight:element.naturalHeight;
    if(!sw||!sh)return;
    const x=Math.max(0,box[0]*sw),y=Math.max(0,box[1]*sh),w=Math.min(sw-x,box[2]*sw),h=Math.min(sh-y,box[3]*sh);
    if(w<1||h<1)return;
    try{
      tinyContext.clearRect(0,0,BLOB_W,BLOB_H);tinyContext.drawImage(source,x,y,w,h,0,0,BLOB_W,BLOB_H);
      const context=mask.getContext('2d');context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';
      context.clearRect(0,0,MASK_W,MASK_H);context.drawImage(tiny,0,0,BLOB_W,BLOB_H,0,0,MASK_W,MASK_H);
      context.fillStyle='rgba(9,14,21,.34)';context.fillRect(0,0,MASK_W,MASK_H);
      mask.painted=true;
    }catch{/* An unreadable frame leaves the opaque mask background visible. */}
  }
  function note(record,item,box,frame,covered){
    let tag=record.notes.get(item.id);
    if(!tag){tag=document.createElement('span');tag.setAttribute('data-perde-note','');record.layer.append(tag);record.notes.set(item.id,tag);}
    const score=Number.isFinite(item.score)?Math.round(item.score*100):null;
    tag.textContent=!covered?`Erkek · açık${score===null?'':` %${score}`}`:score===null?'Belirsiz · örtülü':score<50?`Kadın · %${100-score}`:`Doğrulanıyor · erkek %${score}`;
    tag.dataset.covered=String(covered);
    tag.style.left=`${frame.left+box[0]*frame.width}px`;tag.style.top=`${frame.top+box[1]*frame.height}px`;
    tag.style.width=`${box[2]*frame.width}px`;tag.style.height=`${box[3]*frame.height}px`;
  }
  function draw(record,now){
    const viewport=record.element.getBoundingClientRect();
    if(!mediaVisible(record.element,viewport)){record.layer.style.display='none';return;}
    const rect=locate(record);if(!rect)return;
    record.layer.style.display=settings.enabled?'block':'none';
    if(!settings.enabled)return;
    if(record.layer.getAttribute('data-perde-style')!==settings.maskStyle)record.layer.setAttribute('data-perde-style',settings.maskStyle);
    const element=record.element;
    const currentSource=record.type==='video'?element.currentSrc:(element.currentSrc||element.src);
    if(record.source!==null&&record.source!==currentSource){
      record.source=currentSource;clearAnalysis(record);
      if(record.type==='image')element.setAttribute('data-perde-pending','true');
      else element.setAttribute('data-perde-starting','true');
    }
    const width=record.type==='video'?element.videoWidth:element.naturalWidth;
    const height=record.type==='video'?element.videoHeight:element.naturalHeight;
    const style=getComputedStyle(element),fit=style.objectFit||'contain';
    const frame=contentRect({left:0,top:0,width:rect.width,height:rect.height},width,height,fit,style.objectPosition);
    // A paused frame must stay censored. A slow inference must not erase a mask.
    const sampleTime=Math.min(now,record.observedAt+(element.paused?220:1000));
    const items=record.type==='image'?record.staticBoxes||[]:record.motionBoxes?.map(item=>({...item,box:expanded(item.box,settings.padding)}))||record.tracker.sample(sampleTime,settings.padding);
    const dt=Math.min(100,now-(record.drawnAt||now));record.drawnAt=now;
    const used=new Set(),noted=new Set();let covered=0;
    for(const item of items){
      const show=covers(item);
      if(debug()){noted.add(item.id);note(record,item,item.box,frame,show);}
      if(!show)continue;
      covered++;used.add(item.id);let mask=record.masks.get(item.id);
      if(!mask){
        mask=document.createElement('canvas');mask.width=MASK_W;mask.height=MASK_H;mask.setAttribute('data-perde-mask','');
        record.layer.append(mask);record.masks.set(item.id,mask);
      }
      if(mask.leaving){clearTimeout(mask.leaving);mask.leaving=0;mask.removeAttribute('data-leaving');}
      const target=[frame.left+item.box[0]*frame.width,frame.top+item.box[1]*frame.height,item.box[2]*frame.width,item.box[3]*frame.height];
      mask.shown=settle(mask.shown,target,dt);
      const [x,y,w,h]=mask.shown;
      mask.style.transform=`translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
      mask.style.width=`${w.toFixed(1)}px`;mask.style.height=`${h.toFixed(1)}px`;
      mask.style.setProperty('--perde-radius',`${Math.round(Math.min(26,Math.max(6,Math.min(w,h)*.16)))}px`);
      paint(record,mask,item.box,now);
    }
    for(const [id,mask]of record.masks)if(!used.has(id)&&!mask.leaving){
      // Leaving masks fade; appearing masks are immediate so nothing flashes uncovered.
      mask.setAttribute('data-leaving','');
      mask.leaving=setTimeout(()=>{if(record.masks.get(id)===mask){mask.remove();record.masks.delete(id);}},LEAVE_MS);
    }
    for(const [id,tag]of record.notes)if(!noted.has(id)){tag.remove();record.notes.delete(id);}
    if(record.type==='video'&&record.processed){status.covered=covered;status.visible=items.length-covered;}
    const label=record.error?'Analiz hatası · eklenti simgesini aç':record.type==='video'&&!record.processed?'Koruma hazırlanıyor…':'';
    if(record.label.textContent!==label)record.label.textContent=label;
    record.label.style.display=record.label.textContent?'block':'none';
  }
  function sceneCut(record,now){
    // A new shot may show different people at the same place: decisions restart.
    record.tracker.resetGender();
    if(record.motionBoxes)record.motionBoxes=record.motionBoxes.map(item=>({...item,male:false}));
    record.last=0;record.time=-1;record.urgent=true;
    if(settings.cutBlur)record.element.setAttribute('data-perde-starting','true');
    queueMicrotask(tick);
  }
  function motionFrame(record,now,force=false){
    const element=record.element;
    if(record.type!=='video'||!settings.enabled||document.hidden||element.readyState<2||!element.videoWidth||element.seeking||!mediaVisible(element,element.getBoundingClientRect()))return;
    if(!force&&(element.paused||now-record.motionAt<60))return;
    record.motionAt=now;
    if(!record.motionCanvas){record.motionCanvas=document.createElement('canvas');record.motionCanvas.width=160;record.motionCanvas.height=90;}
    try{
      const context=record.motionCanvas.getContext('2d',{willReadFrequently:true});context.drawImage(element,0,0,160,90);
      record.motionReady=true;
      const frame={...PerdeMotion.gray(context.getImageData(0,0,160,90).data,160,90),at:now,sequence:++record.sequence};
      const previous=record.history.at(-1);
      if(previous&&now-previous.at<300&&PerdeMotion.difference(previous,frame)>CUT_DIFFERENCE)sceneCut(record,now);
      else if(record.motionBoxes&&previous)record.motionBoxes=PerdeMotion.advance(record.motionBoxes,previous,frame);
      record.history.push(frame);while(record.history.length>70||record.history[0].at<now-4500)record.history.shift();
    }catch{record.motionBoxes=null;}
  }
  function animation(now){if(!settings.enabled||document.hidden){requestAnimationFrame(animation);return;}for(const record of records.values())if(record.inView){motionFrame(record,now);draw(record,now);}requestAnimationFrame(animation);}
  function dataUrl(blob){
    return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});
  }
  async function snapshot(element,width,height){
    const factor=Math.min(1,settings.frame/Math.max(width,height));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(width*factor));canvas.height=Math.max(1,Math.round(height*factor));
    // A CPU canvas keeps the GPU free for video; JPEG encoding runs off the main thread.
    canvas.getContext('2d',{willReadFrequently:true}).drawImage(element,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.82));
    if(!blob)throw Error('Kare kodlanamadı.');
    return dataUrl(blob);
  }
  async function analyze(record){
    const {element,type}=record;
    const now=performance.now(),rect=element.getBoundingClientRect();
    if(!settings.enabled||document.hidden||!mediaVisible(element,rect)||now<record.retryAt)return;
    if(type==='video'&&(element.readyState<2||!element.videoWidth||element.seeking))return;
    if(type==='image'&&(!element.complete||!element.naturalWidth))return;
    const source=type==='video'?element.currentSrc:(element.currentSrc||element.src);
    if(record.source!==source){record.source=source;clearAnalysis(record);}
    if(type==='image'&&record.processed)return;
    // Analysis pace follows the measured engine time so the GPU never runs flat
    // out; a new shot or a seek is analysed at once.
    // A paused frame gets a second look only when someone is one look away from being shown.
    const again=record.time===element.currentTime&&element.paused&&record.looks<2&&record.tracker.tracks.some(t=>t.gender&&!t.gender.male&&t.gender.mean>=settings.maleThreshold);
    if(type==='video'&&(record.time===element.currentTime&&!again||!record.urgent&&!again&&now-record.last<(record.interval||160)))return;
    const epoch=record.epoch,version=generation;
    const mediaTime=element.currentTime;
    record.last=now;record.urgent=false;
    try{
      let data;
      if(type==='video'){motionFrame(record,performance.now(),true);data=await snapshot(element,element.videoWidth,element.videoHeight);}
      else{
        try{data=await snapshot(element,element.naturalWidth,element.naturalHeight);}
        catch{data=(await rpc({type:'image-read',url:source})).image;}
      }
      const captureSequence=record.history.at(-1)?.sequence;
      // People already settled as women stay covered; their faces need no new look.
      const skip=settings.target==='women'?record.tracker.tracks.filter(t=>t.gender?.obs.length>=2&&t.gender.mean<.3).map(t=>t.box):[];
      const result=await rpc({type:'detect',image:data,confidence:settings.confidence,detail:settings.detail,frame:settings.frame,genderLimit:settings.genderLimit,genders:settings.target==='women',skip});
      if(epoch!==record.epoch||version!==generation||!element.isConnected||source!==(type==='video'?element.currentSrc:(element.currentSrc||element.src)))return;
      const timestamp=performance.now();
      const evidence=Array.isArray(result.evidence)?result.evidence:[];
      if(type==='video'){
        const boxes=PerdeMotion.replay(result.boxes,record.history,captureSequence);
        record.tracker.update(boxes,timestamp,evidence,settings.maleThreshold);
        record.motionBoxes=record.tracker.tracks.map(t=>({id:t.id,box:[...t.box],male:t.gender?.male===true,score:t.gender?.mean??null}));
      }else{
        // A still image is judged once, so it needs a stricter single-look decision.
        record.staticBoxes=result.boxes.map((box,id)=>{const e=evidence[id];return {id,box:expanded(PerdeTracking.clip(box),settings.padding),male:!!e&&e.weight>=.6&&e.male>=Math.min(.97,settings.maleThreshold+.05),score:e?.male??null};});
      }
      record.observedAt=timestamp;record.interval=Math.min(1200,Math.max(250,(Number(result.ms)||timestamp-now)/settings.gpuShare));
      record.processed=true;record.error=null;record.retryAt=0;
      record.looks=record.time===mediaTime?(record.looks||1)+1:1;
      record.time=mediaTime;status.model=result.backend;status.ms=result.ms;status.people=result.boxes.length;status.genderReady=result.genderReady===true;
      if(type==='video'){status.frames++;element.removeAttribute('data-perde-starting');}
      else{status.images++;element.removeAttribute('data-perde-pending');}
      status.error=null;draw(record,timestamp);
    }catch(error){
      if(epoch!==record.epoch||version!==generation)return;
      record.error=error.message;record.retryAt=performance.now()+5000;report(error);
      // Do not turn the entire page or video black. Pause only an unreadable video.
      if(type==='video'&&settings.pauseOnError){element.pause();element.setAttribute('data-perde-starting','true');}
      if(type==='image')element.setAttribute('data-perde-pending','true');
      draw(record,performance.now());
    }
  }
  async function tick(){
    if(inferenceBusy||!settings.enabled)return;
    inferenceBusy=true;
    try{
      // Video first; process at most one thumbnail per cycle so the video keeps updating.
      for(const record of records.values())if(record.type==='video')await analyze(record);
      for(const record of records.values())if(record.type==='image'&&record.inView&&!record.processed&&performance.now()>=record.retryAt){
        if(visible(record.element.getBoundingClientRect())){await analyze(record);break;}
      }
    }finally{inferenceBusy=false;}
  }
  function apply(raw={}){
    const next=PerdeSettings.normalize(raw);if(siteDisabled)next.enabled=false;
    // Target and mask style only change how existing decisions are drawn.
    if(generation&&['enabled','confidence','padding','detail','frame','maleThreshold','pauseOnError'].every(key=>settings[key]===next[key])){settings=next;return;}
    settings=next;
    generation++;
    for(const record of records.values()){
      clearAnalysis(record);
      record.element.removeAttribute('data-perde-starting');record.element.removeAttribute('data-perde-pending');
      if(settings.enabled)record.element.setAttribute(record.type==='video'?'data-perde-starting':'data-perde-pending','true');
      record.layer.style.display=settings.enabled?'block':'none';
      if(record.type==='video')record.element.disablePictureInPicture=settings.enabled||record.originalPip;
    }
    tick();
  }
  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if(message.type==='site-disable'){siteDisabled=true;apply({...settings,enabled:false});respond({ok:true});}
    if(message.type==='status')respond({...status,ok:true,enabled:settings.enabled,target:settings.target,diagnostics,videoCount:[...records.values()].filter(r=>r.type==='video').length});
    if(message.type==='retry'){for(const r of records.values()){r.retryAt=0;r.error=null;r.processed=false;r.time=-1;r.last=0;}tick();respond({ok:true});}
  });
  chrome.storage.local.get({settings:DEFAULTS}).then(({settings})=>{
    apply(settings);
    // Start loading the local models while the page and any ad are still loading.
    if(window.top===window&&settings?.enabled!==false)chrome.runtime.sendMessage({type:'model-check'}).catch(()=>{});
  }).catch(error=>{report(error);tick();});
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.settings)apply(changes.settings.newValue);});
  document.addEventListener('yt-navigate-finish',()=>{scan();for(const r of records.values()){r.epoch++;r.tracker.reset();r.history=[];r.motionBoxes=null;r.source=null;r.processed=false;}});
  document.addEventListener('enterpictureinpicture',()=>{if(settings.enabled){document.exitPictureInPicture?.().catch(()=>{});report('Görüntü içinde görüntü penceresi sansür katmanını taşımadığı için kapatıldı.');}},true);
  document.addEventListener('fullscreenchange',()=>{
    if(settings.enabled&&document.fullscreenElement?.tagName==='VIDEO'){
      document.fullscreenElement.pause();document.exitFullscreen?.().catch(()=>{});
      report('Doğrudan video tam ekranı sansür katmanını taşımaz. YouTube oynatıcısının tam ekran düğmesini kullan.');
    }
  });
  scan();requestAnimationFrame(animation);setInterval(tick,120);
})();
