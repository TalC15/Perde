'use strict';
// Audio stays in the extension's offscreen document, outside the page's scripts.
let vocalAudio=null,vocalBlob=null,audioGeneration=0,lastSync=0;
let transfer=null;
const CHUNK_BYTES=1024*1024,MAX_AUDIO_BYTES=100000000;
setInterval(()=>{if(vocalAudio&&performance.now()-lastSync>1200)vocalAudio.pause();},300);
function releaseAudio(){audioGeneration++;transfer?.controller?.abort();transfer=null;if(vocalAudio){vocalAudio.pause();vocalAudio.removeAttribute('src');vocalAudio.load();vocalAudio=null;}if(vocalBlob){URL.revokeObjectURL(vocalBlob);vocalBlob=null;}}
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
    vocalBlob=URL.createObjectURL(new Blob(task.chunks,{type:'audio/mpeg'}));
    vocalAudio=new Audio(vocalBlob);vocalAudio.preload='auto';
    task.chunks=[];task.state='ready';
  }catch{
    if(generation===audioGeneration){task.state='error';task.error='Hazır vokalin aktarımı kesildi. Aktarımı yeniden dene; ses tekrar ayrılmayacak.';}
  }
}
async function audioCommand(message){
  if(message.type==='audio-release'){releaseAudio();return {ok:true};}
  if(message.type==='audio-load'){
    if(!/^[a-f0-9]{32}$/.test(message.job)||typeof message.token!=='string')throw Error('Geçersiz ses isteği.');
    if(!transfer||transfer.job!==message.job||transfer.token!==message.token){
      releaseAudio();transfer={job:message.job,token:message.token,chunks:[],offset:0,total:null,progress:0,state:'loading'};
      void downloadAudio(transfer,audioGeneration);
    }else if(transfer.state==='error'&&message.retry){transfer.state='loading';transfer.error=null;void downloadAudio(transfer,audioGeneration);}
    return {ok:transfer.state!=='error',state:transfer.state,progress:transfer.progress,error:transfer.error,retryable:transfer.state==='error'};
  }
  if(message.type==='audio-sync'){
    if(!vocalAudio)return {ok:false,reload:true,error:'Vokal sesi yeniden yüklenmeli.'};
    lastSync=performance.now();
    const {time,rate,volume,playing}=message;
    if(!Number.isFinite(time)||time<0||!Number.isFinite(rate)||rate<.25||rate>4||!Number.isFinite(volume))throw Error('Geçersiz ses zamanlaması.');
    if(!playing)vocalAudio.pause();
    if(Math.abs(vocalAudio.currentTime-time)>.12)vocalAudio.currentTime=time;
    vocalAudio.playbackRate=rate;vocalAudio.volume=Math.max(0,Math.min(1,volume));
    if(playing&&vocalAudio.paused)await vocalAudio.play();
    return {ok:true};
  }
  throw Error('Bilinmeyen ses işlemi.');
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender.id!==chrome.runtime.id||sender.tab||message?.target!=='perde-audio')return;
  audioCommand(message).then(respond,error=>respond({ok:false,error:error.message}));return true;
});
