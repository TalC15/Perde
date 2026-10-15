'use strict';
// Audio stays in the extension's offscreen document, outside the page's scripts.
let vocalAudio=null,vocalBlob=null,audioGeneration=0,lastSync=0;
let transfer=null;
const CHUNK_BYTES=1024*1024,MAX_AUDIO_BYTES=100000000;
setInterval(()=>{if(vocalAudio&&performance.now()-lastSync>1200){vocalAudio.pause();globalThis.PerdeMusicPlayer?.pause();}},300);
function releaseAudio(){globalThis.PerdeMusicPlayer?.clear();audioGeneration++;transfer?.controller?.abort();transfer?.saveController?.abort();transfer=null;if(vocalAudio){vocalAudio.pause();vocalAudio.removeAttribute('src');vocalAudio.load();vocalAudio=null;}if(vocalBlob){URL.revokeObjectURL(vocalBlob);vocalBlob=null;}}
function audioStatus(task){return {ok:task.state!=='error',state:task.state,progress:task.progress,error:task.error,retryable:task.state==='error',saved:task.saved===true,saveVocal:task.saveVocal===true,cacheWarning:task.cacheWarning||null};}
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
function attachAudio(task){vocalBlob=URL.createObjectURL(task.data);vocalAudio=new Audio(vocalBlob);vocalAudio.preload='auto';vocalAudio.addEventListener?.('ended',()=>globalThis.PerdeMusicPlayer?.pause());}
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
      let chunk;
      for(let attempt=0;attempt<3;attempt++){
        if(generation!==audioGeneration)return;
        const controller=new AbortController();task.controller=controller;
        const timeout=setTimeout(()=>controller.abort(),20000);
        try{
          const end=Math.min(task.offset+CHUNK_BYTES,task.total??MAX_AUDIO_BYTES)-1;
          const response=await fetch(`http://127.0.0.1:8765/jobs/${task.job}/audio`,{headers:{Authorization:`Bearer ${task.token}`,Range:`bytes=${task.offset}-${end}`},credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal});
          if(response.status!==206)throw Error('Ses aktarımı için yerel servisi güncelleyip yeniden başlat.');
          const range=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('Content-Range')||'');
          if(!range||+range[1]!==task.offset||+range[2]<task.offset||+range[2]>end||+range[2]!==Math.min(end,+range[3]-1)||+range[3]>MAX_AUDIO_BYTES||+range[3]<=0||(task.total!==null&&task.total!==+range[3]))throw Error('Geçersiz ses parçası.');
          const size=+range[2]-task.offset+1;
          // Read with a bound even if a response lies about its Content-Length.
          const reader=response.body.getReader(),parts=[];let received=0;
          while(true){const {value,done}=await reader.read();if(done)break;received+=value.byteLength;if(received>size){await reader.cancel();throw Error('Ses parçası sınırı aşıldı.');}parts.push(value);}
          if(received!==size)throw Error('Ses parçası eksik geldi.');
          chunk=new Blob(parts,{type:'audio/mpeg'});task.total=+range[3];break;
        }catch(error){if(generation!==audioGeneration)return;if(attempt===2)throw error;}
        finally{clearTimeout(timeout);}
      }
      if(generation!==audioGeneration)return;
      task.chunks.push(chunk);task.offset+=chunk.size;task.progress=Math.round(100*task.offset/task.total);
    }
    if(generation!==audioGeneration)return;
    task.data=new Blob(task.chunks,{type:'audio/mpeg'});task.chunks=[];attachAudio(task);
    await persistAudio(task,generation);
    if(generation===audioGeneration)task.state='ready';
  }catch{
    if(generation===audioGeneration){task.state='error';task.error='Hazır vokalin aktarımı kesildi. Aktarımı yeniden dene; ses tekrar ayrılmayacak.';}
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
      releaseAudio();transfer={source:'service',job:message.job,token:message.token,chunks:[],offset:0,total:null,progress:0,state:'loading',saveVocal:message.saveVocal===true,saved:false};metadata(transfer,message);
      void downloadAudio(transfer,audioGeneration);
    }else if(transfer.state==='error'&&message.retry){transfer.state='loading';transfer.error=null;void downloadAudio(transfer,audioGeneration);}
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
    if(!vocalAudio)return {ok:false,reload:true,error:'Vokal sesi yeniden yüklenmeli.'};
    lastSync=performance.now();
    const {time,rate,volume,playing}=message;
    if(!Number.isFinite(time)||time<0||!Number.isFinite(rate)||rate<.25||rate>4||!Number.isFinite(volume))throw Error('Geçersiz ses zamanlaması.');
    const shouldPlay=playing&&(!Number.isFinite(vocalAudio.duration)||time<vocalAudio.duration);
    if(!shouldPlay)vocalAudio.pause();
    if(Math.abs(vocalAudio.currentTime-time)>.12)vocalAudio.currentTime=time;
    vocalAudio.playbackRate=rate;vocalAudio.volume=Math.max(0,Math.min(1,volume));
    if(shouldPlay&&vocalAudio.paused)await vocalAudio.play();
    const music=globalThis.PerdeMusicPlayer?.sync({id:message.musicId,time,rate,volume,mix:message.musicVolume,playing:shouldPlay&&!vocalAudio.paused&&!vocalAudio.ended});
    return {ok:true,...music};
  }
  throw Error('Bilinmeyen ses işlemi.');
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender.id!==chrome.runtime.id||sender.tab||message?.target!=='perde-audio')return;
  audioCommand(message).then(respond,error=>respond({ok:false,error:error.message}));return true;
});
