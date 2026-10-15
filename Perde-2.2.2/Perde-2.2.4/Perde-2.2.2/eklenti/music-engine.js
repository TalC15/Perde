'use strict';
globalThis.PerdeMusicPlayer=(()=>{
  let audio=null,url=null,id=null,generation=0,last=null,warning=null,metadataTimer=null;
  function clear(){generation++;clearTimeout(metadataTimer);metadataTimer=null;if(audio){audio.pause();audio.removeAttribute('src');audio.load();}audio=null;if(url)URL.revokeObjectURL(url);url=null;id=null;warning=null;}
  function pause(){if(audio)audio.pause();if(last)last={...last,playing:false};}
  function apply(){
    if(!audio||!last||!Number.isFinite(audio.duration)||audio.duration<=0)return;
    const target=last.time%audio.duration;
    if(Math.abs(audio.currentTime-target)>.25)audio.currentTime=target;
    audio.playbackRate=last.rate;audio.volume=Math.max(0,Math.min(1,last.volume*last.mix));
    if(!last.playing||performance.now()-last.at>1200){audio.pause();return;}
    if(audio.paused){const active=audio,version=generation;active.play().catch(()=>{if(version===generation)warning='Arka plan MP3 başlatılamadı. Parçayı yeniden seç.';});}
  }
  async function load(trackId,version){
    try{
      const record=await PerdeMusicLibrary.get(trackId);
      if(version!==generation)return;
      if(!record)throw Error('Seçilen MP3 silinmiş. Başka bir parça seç.');
      url=URL.createObjectURL(record.blob);audio=new Audio(url);audio.loop=true;audio.preload='auto';
      audio.addEventListener('loadedmetadata',()=>{if(version===generation){clearTimeout(metadataTimer);apply();}},{once:true});
      audio.addEventListener('error',()=>{if(version===generation){clearTimeout(metadataTimer);warning='MP3 okunamadı. Parçayı silip yeniden ekle.';pause();}},{once:true});
      metadataTimer=setTimeout(()=>{if(version===generation){warning='MP3 açılması zaman aşımına uğradı. Parçayı yeniden seç.';pause();}},15000);
      if(Number.isFinite(audio.duration)&&audio.duration>0){clearTimeout(metadataTimer);apply();}
    }catch(error){if(version===generation)warning=error.message;}
  }
  return Object.freeze({
    clear,pause,
    sync(state){
      const wanted=typeof state.id==='string'&&/^[a-f0-9]{64}$/.test(state.id)?state.id:null;
      if(id!==wanted){clear();id=wanted;if(wanted)void load(wanted,generation);}
      last={...state,mix:Number.isFinite(state.mix)?Math.max(0,Math.min(1,state.mix)):.15,at:performance.now()};
      if(audio)apply();return {musicWarning:warning};
    }
  });
})();
