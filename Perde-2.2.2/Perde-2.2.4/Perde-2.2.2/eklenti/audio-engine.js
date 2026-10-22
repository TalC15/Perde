'use strict';
// Audio stays in the extension's offscreen document, outside the page's scripts.
let vocalAudio=null,vocalBlob=null,vocalStream=null,audioGeneration=0,lastSync=0;
let transfer=null;
// Playback may begin once this much separated vocal has arrived.
const CHUNK_BYTES=1024*1024,MAX_AUDIO_BYTES=100000000,START_SECONDS=12;
setInterval(()=>{if(vocalAudio&&performance.now()-lastSync>1200){vocalAudio.pause();globalThis.PerdeMusicPlayer?.pause();}},300);
function releaseAudio(){globalThis.PerdeMusicPlayer?.clear();audioGeneration++;transfer?.controller?.abort();transfer?.saveController?.abort();transfer=null;vocalStream?.close();vocalStream=null;if(vocalAudio){vocalAudio.pause();vocalAudio.removeAttribute('src');vocalAudio.load();vocalAudio=null;}if(vocalBlob){URL.revokeObjectURL(vocalBlob);vocalBlob=null;}}
// A growing recording is playable before the transfer ends; complete says whether more follows.
function audioStatus(task){const state=task.state==='error'?'error':task.playable?'ready':task.state;return {ok:state!=='error',state,progress:task.progress,error:task.error,retryable:task.state==='error',complete:task.state==='ready',saved:task.saved===true,saveVocal:task.saveVocal===true,cacheWarning:task.cacheWarning||null};}
function metadata(task,message){for(const key of ['videoId','title','totalSeconds','audioLanguage','audioSelection'])if(message[key]!==undefined)task[key]=message[key];}
async function persistAudio(task,generation){
  if(task.savePromise)return task.savePromise;
  if(generation!==audioGeneration||!task.data||!task.saveVocal||task.saved)return;
  const controller=new AbortController();task.saveController=controller;task.cacheWarning=null;
  task.savePromise=(async()=>{
    try{
      await PerdeVocalLibrary.put({videoId:task.videoId,title:task.title,totalSeconds:task.totalSeconds,audioLanguage:task.audioLanguage,audioSelection:task.audioSelection,blob:task.data},{signal:controller.signal});
      if(generation===audioGeneration&&!controller.signal.aborted)task.saved=true;
    }catch(error){
      if(generation===audioGeneration&&!controller.signal.aborted)task.cacheWarning=error?.name==='QuotaExceededError'?'Tarayıcıda boş yer kalmadığı için vokal kaydedilemedi. Arşivden bir kayıt silip yeniden kaydet.':'Vokal oynatılabilir, ancak tarayıcı arşivine kaydedilemedi. Kaydetmeyi yeniden dene.';
    }finally{task.savePromise=null;task.saveController=null;}
  })();
  return task.savePromise;
}
function attachAudio(task){vocalBlob=URL.createObjectURL(task.data);vocalAudio=new Audio(vocalBlob);vocalAudio.preload='auto';vocalAudio.addEventListener?.('ended',()=>globalThis.PerdeMusicPlayer?.pause());task.playable=true;}
function attachStream(task){vocalAudio=new Audio();vocalAudio.preload='auto';vocalAudio.addEventListener('ended',()=>globalThis.PerdeMusicPlayer?.pause());vocalStream=new PerdeVocalStream.VocalStream(vocalAudio,task.index,task.totalSeconds);task.playable=true;}
const streaming=()=>!!globalThis.PerdeVocalStream?.VocalStream.supported();
async function loadSavedAudio(task,generation){
  try{
    const record=await PerdeVocalLibrary.get(task.videoId);
    if(generation!==audioGeneration)return;
    if(!record||!(record.blob instanceof Blob)||record.blob.size<=0||record.blob.size>MAX_AUDIO_BYTES)throw Error('Kayıtlı vokal bulunamadı.');
    metadata(task,record);task.data=record.blob;task.saved=!task.forgotten;task.progress=100;attachAudio(task);
    await persistAudio(task,generation);
    if(generation===audioGeneration)task.state='ready';
  }catch(error){if(generation===audioGeneration){task.state='error';task.error=error?.message||'Kayıtlı vokal açılamadı.';}}
}
async function downloadAudio(task,generation){
  try{
    while(task.total===null||task.offset<task.total){
      let chunk,pending=false;
      for(let attempt=0;attempt<3;attempt++){
        if(generation!==audioGeneration)return;
        const controller=new AbortController();task.controller=controller;
        const timeout=setTimeout(()=>controller.abort(),20000);
        try{
          const end=Math.min(task.offset+CHUNK_BYTES,task.total??MAX_AUDIO_BYTES)-1;
          const response=await fetch(`http://127.0.0.1:8765/jobs/${task.job}/audio`,{headers:{Authorization:`Bearer ${task.token}`,Range:`bytes=${task.offset}-${end}`},credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal});
          // 204: the service has not encoded the next part yet.
          if(response.status===204){pending=true;break;}
          if(response.status===409){const data=await response.json().catch(()=>({}));const error=Error(data.error||'Ses ayrılamadı.');error.final=true;throw error;}
          if(response.status!==206)throw Error('Ses aktarımı için yerel servisi güncelleyip yeniden başlat.');
          const range=/^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(response.headers.get('Content-Range')||'');
          const total=range&&range[3]!=='*'?+range[3]:null;
          if(!range||+range[1]!==task.offset||+range[2]<task.offset||+range[2]>end)throw Error('Geçersiz ses parçası.');
          if(total!==null&&(+range[2]!==Math.min(end,total-1)||total>MAX_AUDIO_BYTES||total<=0||(task.total!==null&&task.total!==total)))throw Error('Geçersiz ses parçası.');
          const size=+range[2]-task.offset+1;
          // Read with a bound even if a response lies about its Content-Length.
          const reader=response.body.getReader(),parts=[];let received=0;
          while(true){const {value,done}=await reader.read();if(done)break;received+=value.byteLength;if(received>size){await reader.cancel();throw Error('Ses parçası sınırı aşıldı.');}parts.push(value);}
          if(received!==size)throw Error('Ses parçası eksik geldi.');
          chunk=new Uint8Array(size);let at=0;for(const part of parts){chunk.set(part,at);at+=part.byteLength;}
          if(total!==null)task.total=total;break;
        }catch(error){if(generation!==audioGeneration)return;if(error.final||attempt===2)throw error;}
        finally{clearTimeout(timeout);}
      }
      if(generation!==audioGeneration)return;
      if(pending){await new Promise(resolve=>setTimeout(resolve,1000));continue;}
      task.index.push(chunk);task.offset+=chunk.length;
      task.progress=task.total?Math.round(100*task.offset/task.total):task.totalSeconds>0?Math.min(99,Math.round(100*task.index.seconds/task.totalSeconds)):null;
      if(!vocalAudio&&streaming()&&task.index.seconds>=Math.min(START_SECONDS,task.totalSeconds||START_SECONDS))attachStream(task);
    }
    if(generation!==audioGeneration)return;
    task.data=task.index.blob();
    if(vocalStream)vocalStream.finish();else{task.index=null;if(!vocalAudio)attachAudio(task);}
    await persistAudio(task,generation);
    if(generation===audioGeneration)task.state='ready';
  }catch(error){
    if(generation===audioGeneration){task.state='error';task.error=error?.final?error.message:'Hazır vokalin aktarımı kesildi. Aktarımı yeniden dene; ses tekrar ayrılmayacak.';task.final=error?.final===true;}
  }
}
async function audioCommand(message){
  if(message.type==='audio-music-clear'){globalThis.PerdeMusicPlayer?.clear();return {ok:true};}
  if(message.type==='audio-release'){releaseAudio();return {ok:true};}
  if(message.type==='audio-forget'){
    const task=transfer;
    if(!task||(message.videoId&&task.videoId!==message.videoId))return {ok:true};
    task.forgotten=true;task.saveVocal=false;task.saveController?.abort();
    if(task.savePromise)await task.savePromise;
    task.saved=false;task.cacheWarning=null;
    return {ok:true};
  }
  if(message.type==='audio-load'){
    if(!/^[a-f0-9]{32}$/.test(message.job)||typeof message.token!=='string')throw Error('Geçersiz ses isteği.');
    if(!transfer||transfer.source!=='service'||transfer.job!==message.job||transfer.token!==message.token){
      releaseAudio();transfer={source:'service',job:message.job,token:message.token,index:new PerdeVocalStream.FrameIndex(),offset:0,total:null,progress:0,state:'loading',saveVocal:message.saveVocal===true,saved:false};metadata(transfer,message);
      void downloadAudio(transfer,audioGeneration);
    }else if(transfer.state==='error'&&!transfer.final&&(message.retry||transfer.playable)){transfer.state='loading';transfer.error=null;void downloadAudio(transfer,audioGeneration);}
    return audioStatus(transfer);
  }
  if(message.type==='audio-load-saved'){
    if(typeof message.videoId!=='string'||!/^[-\w]{11}$/.test(message.videoId))throw Error('Geçersiz video kaydı.');
    if(!transfer||transfer.source!=='library'||transfer.videoId!==message.videoId){
      releaseAudio();transfer={source:'library',videoId:message.videoId,progress:0,state:'loading',saveVocal:true,saved:false};void loadSavedAudio(transfer,audioGeneration);
    }else if(transfer.state==='error'&&message.retry){transfer.state='loading';transfer.error=null;void loadSavedAudio(transfer,audioGeneration);}
    return audioStatus(transfer);
  }
  if(message.type==='audio-retain'){
    if(!transfer)return {ok:false,error:'Kaydedilecek etkin vokal yok.'};
    if(message.videoId&&transfer.videoId&&message.videoId!==transfer.videoId)throw Error('Vokal başka bir videoya ait.');
    const task=transfer,generation=audioGeneration;metadata(task,message);task.saveVocal=message.saveVocal===true;
    if(!task.saveVocal){task.saveController?.abort();task.cacheWarning=null;}
    else{
      await persistAudio(task,generation);
      // A previous write may have just been aborted by an unchecked checkbox.
      if(task.saveVocal&&!task.saved&&!task.cacheWarning)await persistAudio(task,generation);
    }
    if(generation!==audioGeneration)return {ok:false,error:'Etkin video değişti.'};
    return audioStatus(task);
  }
  if(message.type==='audio-sync'){
    if(transfer?.state==='error')return {ok:false,reload:!transfer.final,error:transfer.error};
    if(!vocalAudio)return {ok:false,reload:true,error:'Vokal sesi yeniden yüklenmeli.'};
    lastSync=performance.now();
    const {time,rate,volume,playing}=message;
    if(!Number.isFinite(time)||time<0||!Number.isFinite(rate)||rate<.25||rate>4||!Number.isFinite(volume))throw Error('Geçersiz ses zamanlaması.');
    // While separation continues, the vocal never plays past the part that exists.
    const complete=transfer?.state!=='loading',availableUntil=complete?null:transfer.index.seconds;
    const shouldPlay=playing&&(complete||time<availableUntil-.25)&&(!Number.isFinite(vocalAudio.duration)||time<vocalAudio.duration);
    if(!shouldPlay)vocalAudio.pause();
    if(Math.abs(vocalAudio.currentTime-time)>.12)vocalAudio.currentTime=time;
    vocalAudio.playbackRate=rate;vocalAudio.volume=Math.max(0,Math.min(1,volume));
    if(shouldPlay&&vocalAudio.paused)await vocalAudio.play();
    const music=globalThis.PerdeMusicPlayer?.sync({id:message.musicId,time,rate,volume,mix:message.musicVolume,playing:shouldPlay&&!vocalAudio.paused&&!vocalAudio.ended});
    return {ok:true,...music,complete,availableUntil,progress:transfer?.progress??100};
  }
  throw Error('Bilinmeyen ses işlemi.');
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender.id!==chrome.runtime.id||sender.tab||message?.target!=='perde-audio')return;
  audioCommand(message).then(respond,error=>respond({ok:false,error:error.message}));return true;
});
