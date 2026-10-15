(() => {
  'use strict';
  if(globalThis.__perdeVisual)return;globalThis.__perdeVisual=true;
  const DEFAULTS=PerdeSettings.normalize();
  let settings={...DEFAULTS},generation=0,siteDisabled=false;
  const records=new Map(),parents=new WeakMap();const diagnostics=[];
  const intersections=new IntersectionObserver(entries=>{for(const entry of entries){const record=records.get(entry.target);if(record){record.inView=entry.isIntersecting;if(!record.inView)record.layer.style.display='none';}}},{rootMargin:'160px'});
  const status={version:'2.2.2',model:'hazırlanıyor',frames:0,images:0,people:0,ms:0,error:null};
  let inferenceBusy=false,scheduled=false;
  let labeling=false;
  const {Tracker,contentRect,expanded}=PerdeTracking;
  const rpc=async message=>{
    const result=await chrome.runtime.sendMessage(message);
    if(!result?.ok)throw Error(result?.error||'Yerel analiz bölümünden cevap alınamadı.');
    return result;
  };
  function report(error){status.error=String(error?.message||error).slice(0,350);diagnostics.push(status.error);if(diagnostics.length>15)diagnostics.shift();}
  function videoId(){try{const u=new URL(location.href);return u.searchParams.get('v')||u.pathname.match(/^\/shorts\/([\w-]{11})/)?.[1]||null;}catch{return null;}}
  function releaseParent(parent){
    const state=parents.get(parent);if(!state)return;
    if(--state.count===0){if(state.changed&&parent.style.position==='relative')parent.style.position=state.original;parents.delete(parent);}
  }
  function attach(element){
    if(records.has(element))return;
    if(element.closest('#perde-vocal-panel'))return;
    const type=element.tagName==='VIDEO'?'video':'image';
    const layer=document.createElement('div');layer.setAttribute('data-perde-layer',type);
    const label=document.createElement('span');label.setAttribute('data-perde-label','');layer.append(label);
    const record={element,type,layer,label,tracker:new Tracker(),masks:new Map(),source:null,time:-1,last:0,observedAt:0,epoch:0,processed:false,error:null,retryAt:0,cleanups:[],history:[],motionBoxes:null,motionAt:0,sequence:0};
    record.personLabels=new Map();
    const done=document.createElement('button');done.setAttribute('data-perde-done','');done.textContent='Etiketlemeyi bitir';done.hidden=true;
    done.onclick=event=>{event.preventDefault();event.stopPropagation();labeling=false;};layer.append(done);record.done=done;
    records.set(element,record);
    record.inView=false;intersections.observe(element);
    const reset=()=>{labeling=false;record.personLabels.clear();record.epoch++;record.tracker.reset();record.history=[];record.motionBoxes=null;record.processed=false;record.error=null;record.retryAt=0;record.time=-1;record.last=0;
      if(settings.enabled&&type==='video')element.setAttribute('data-perde-starting','true');};
    if(type==='video'){
      const onPlay=()=>{labeling=false;};element.addEventListener('play',onPlay);record.cleanups.push(()=>element.removeEventListener('play',onPlay));
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
      parent.append(layer);
    }
    const rect=element.getBoundingClientRect(),base=parent.getBoundingClientRect();
    layer.style.left=`${rect.left-base.left+parent.scrollLeft-parent.clientLeft}px`;
    layer.style.top=`${rect.top-base.top+parent.scrollTop-parent.clientTop}px`;
    layer.style.width=`${rect.width}px`;layer.style.height=`${rect.height}px`;
    return rect;
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
    for(const [element,record]of records)if(!element.isConnected)remove(element,record);
  }
  const observer=new MutationObserver(()=>{if(!scheduled){scheduled=true;requestAnimationFrame(scan);}});
  observer.observe(document,{childList:true,subtree:true});
  function visible(rect){return rect.width>=16&&rect.height>=16&&rect.bottom>0&&rect.top<innerHeight&&rect.right>0&&rect.left<innerWidth;}
  function draw(record,now){
    const viewport=record.element.getBoundingClientRect();
    if(!visible(viewport)){record.layer.style.display='none';return;}
    const rect=locate(record);if(!rect)return;
    record.layer.style.display=settings.enabled?'block':'none';
    if(!settings.enabled)return;
    record.done.hidden=!labeling;
    const element=record.element;
    const currentSource=record.type==='video'?element.currentSrc:(element.currentSrc||element.src);
    if(record.source!==null&&record.source!==currentSource){
      labeling=false;record.personLabels.clear();
      record.source=currentSource;record.epoch++;record.tracker.reset();record.staticBoxes=[];record.history=[];record.motionBoxes=null;
      record.processed=false;record.error=null;record.retryAt=0;record.time=-1;
      if(record.type==='image')element.setAttribute('data-perde-pending','true');
      else element.setAttribute('data-perde-starting','true');
    }
    const width=record.type==='video'?element.videoWidth:element.naturalWidth;
    const height=record.type==='video'?element.videoHeight:element.naturalHeight;
    const style=getComputedStyle(element),fit=style.objectFit||'contain';
    const box=contentRect({left:0,top:0,width:rect.width,height:rect.height},width,height,fit,style.objectPosition);
    // A paused frame must stay censored. A slow inference must not erase a mask.
    const sampleTime=Math.min(now,record.observedAt+(element.paused?220:1000));
    const boxes=record.type==='image'?record.staticBoxes||[]:record.motionBoxes?.map(item=>({...item,box:expanded(item.box,settings.padding)}))||record.tracker.sample(sampleTime,settings.padding);
    const used=new Set();
    for(const item of boxes){
      const id=item.id;used.add(id);let mask=record.masks.get(id);
      if(!mask){
        mask=document.createElement('span');mask.setAttribute('data-perde-mask','');
        const select=document.createElement('select');select.setAttribute('data-perde-person-label','');select.setAttribute('aria-label',`Kişi ${id} etiketi`);
        for(const [value,text] of [['unknown','Etiketsiz'],['male','Erkek'],['nonmale','Erkek olmayan']]){const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);}
        select.onchange=event=>{event.stopPropagation();record.personLabels.set(id,select.value);};
        select.onclick=event=>event.stopPropagation();mask.append(select);record.layer.append(mask);record.masks.set(id,mask);
      }
      const personLabel=record.personLabels.get(id)||'unknown';
      const censored=PerdeTracking.shouldCensor(settings.censorTarget,personLabel);
      mask.setAttribute('data-perde-visible',String(censored));mask.setAttribute('data-perde-editing',String(labeling));
      mask.firstElementChild.hidden=!labeling;mask.firstElementChild.value=personLabel;
      const [x,y,w,h]=item.box;mask.style.left=`${box.left+x*box.width}px`;mask.style.top=`${box.top+y*box.height}px`;
      mask.style.width=`${w*box.width}px`;mask.style.height=`${h*box.height}px`;
    }
    for(const [id,mask]of record.masks)if(!used.has(id)){mask.remove();record.masks.delete(id);record.personLabels.delete(id);}
    const label=record.error?'Analiz hatası · eklenti simgesini aç':record.type==='video'&&!record.processed?'İnsan algılama hazırlanıyor…':'';
    if(record.label.textContent!==label)record.label.textContent=label;
    record.label.style.display=record.label.textContent?'block':'none';
  }
  function motionFrame(record,now,force=false){
    const element=record.element;
    if(record.type!=='video'||!settings.enabled||document.hidden||element.readyState<2||!element.videoWidth||element.seeking||!visible(element.getBoundingClientRect()))return;
    if(!force&&(element.paused||now-record.motionAt<60))return;
    record.motionAt=now;
    if(!record.motionCanvas){record.motionCanvas=document.createElement('canvas');record.motionCanvas.width=160;record.motionCanvas.height=90;}
    try{
      const context=record.motionCanvas.getContext('2d',{willReadFrequently:true});context.drawImage(element,0,0,160,90);
      const frame={...PerdeMotion.gray(context.getImageData(0,0,160,90).data,160,90),at:now,sequence:++record.sequence};
      const previous=record.history.at(-1);
      if(previous&&PerdeTracking.sceneChanged(previous.data,frame.data))record.personLabels.clear();
      if(record.motionBoxes&&previous)record.motionBoxes=PerdeMotion.advance(record.motionBoxes,previous,frame);
      record.history.push(frame);while(record.history.length>70||record.history[0].at<now-4500)record.history.shift();
    }catch{record.motionBoxes=null;}
  }
  function animation(now){if(!settings.enabled||document.hidden){requestAnimationFrame(animation);return;}for(const record of records.values())if(record.inView){motionFrame(record,now);draw(record,now);}requestAnimationFrame(animation);}
  function snapshot(element,width,height){
    const canvas=document.createElement('canvas');const factor=Math.min(1,(settings.detail==='high'?960:640)/Math.max(width,height));
    canvas.width=Math.max(1,Math.round(width*factor));canvas.height=Math.max(1,Math.round(height*factor));
    const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(element,0,0,canvas.width,canvas.height);
    return canvas.toDataURL('image/jpeg',.8);
  }
  async function analyze(record){
    const {element,type}=record;
    const now=performance.now(),rect=element.getBoundingClientRect();
    if(!settings.enabled||document.hidden||!visible(rect)||now<record.retryAt)return;
    if(type==='video'&&(element.readyState<2||!element.videoWidth||element.seeking))return;
    if(type==='image'&&(!element.complete||!element.naturalWidth))return;
    const source=type==='video'?element.currentSrc:(element.currentSrc||element.src);
    if(record.source!==source){record.source=source;record.epoch++;record.tracker.reset();record.processed=false;record.staticBoxes=[];record.history=[];record.motionBoxes=null;record.error=null;record.time=-1;record.retryAt=0;}
    if(type==='image'&&record.processed)return;
    if(type==='video'&&(record.time===element.currentTime||now-record.last<160))return;
    const epoch=record.epoch,version=generation;
    const mediaTime=element.currentTime;
    record.last=now;
    try{
      let data;
      if(type==='video'){motionFrame(record,performance.now(),true);data=snapshot(element,element.videoWidth,element.videoHeight);}
      else{
        try{data=snapshot(element,element.naturalWidth,element.naturalHeight);}
        catch{data=(await rpc({type:'image-read',url:source})).image;}
      }
      const capture=performance.now();
      const captureSequence=record.history.at(-1)?.sequence;
      const result=await rpc({type:'detect',image:data,confidence:settings.confidence,detail:settings.detail});
      if(epoch!==record.epoch||version!==generation||!element.isConnected||source!==(type==='video'?element.currentSrc:(element.currentSrc||element.src)))return;
      const timestamp=performance.now();
      const boxes=type==='video'?PerdeMotion.replay(result.boxes,record.history,captureSequence):result.boxes;
      record.tracker.update(boxes,timestamp);
      record.observedAt=timestamp;
      if(type==='video')record.motionBoxes=record.tracker.tracks.map(t=>({id:t.id,box:[...t.box]}));
      if(type==='image')record.staticBoxes=record.tracker.sample(timestamp,settings.padding);
      record.processed=true;record.error=null;record.retryAt=0;
      record.time=mediaTime;status.model=result.backend;status.ms=result.ms;status.people=result.boxes.length;
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
    if(generation&&['enabled','confidence','padding','detail','pauseOnError'].every(key=>settings[key]===next[key])){settings=next;return;}
    settings=next;
    labeling=false;
    generation++;
    for(const record of records.values()){
      record.personLabels.clear();record.epoch++;record.processed=false;record.error=null;record.retryAt=0;record.tracker.reset();record.staticBoxes=[];record.history=[];record.motionBoxes=null;record.time=-1;
      record.element.removeAttribute('data-perde-starting');record.element.removeAttribute('data-perde-pending');
      if(settings.enabled)record.element.setAttribute(record.type==='video'?'data-perde-starting':'data-perde-pending','true');
      record.layer.style.display=settings.enabled?'block':'none';
      if(record.type==='video')record.element.disablePictureInPicture=settings.enabled||record.originalPip;
    }
    tick();
  }
  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if(message.type==='label-people'){
      if(!settings.enabled){respond({ok:false,error:'Önce insan bölgelerini ört seçeneğini aç.'});return;}
      labeling=true;for(const record of records.values())if(record.type==='video'&&record.inView)record.element.pause();
      respond({ok:true});
    }
    if(message.type==='site-disable'){siteDisabled=true;apply({...settings,enabled:false});respond({ok:true});}
    if(message.type==='status')respond({...status,ok:true,enabled:settings.enabled,diagnostics,videoCount:[...records.values()].filter(r=>r.type==='video').length});
    if(message.type==='retry'){for(const r of records.values()){r.retryAt=0;r.error=null;r.processed=false;r.time=-1;r.last=0;}tick();respond({ok:true});}
  });
  chrome.storage.local.get({settings:DEFAULTS}).then(({settings})=>apply(settings)).catch(error=>{report(error);tick();});
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.settings)apply(changes.settings.newValue);});
  document.addEventListener('yt-navigate-finish',()=>{labeling=false;scan();for(const r of records.values()){r.personLabels.clear();r.epoch++;r.tracker.reset();r.history=[];r.motionBoxes=null;r.source=null;r.processed=false;}});
  document.addEventListener('enterpictureinpicture',()=>{if(settings.enabled){document.exitPictureInPicture?.().catch(()=>{});report('Görüntü içinde görüntü penceresi sansür katmanını taşımadığı için kapatıldı.');}},true);
  document.addEventListener('fullscreenchange',()=>{
    if(settings.enabled&&document.fullscreenElement?.tagName==='VIDEO'){
      document.fullscreenElement.pause();document.exitFullscreen?.().catch(()=>{});
      report('Doğrudan video tam ekranı sansür katmanını taşımaz. YouTube oynatıcısının tam ekran düğmesini kullan.');
    }
  });
  scan();requestAnimationFrame(animation);setInterval(tick,120);
})();
