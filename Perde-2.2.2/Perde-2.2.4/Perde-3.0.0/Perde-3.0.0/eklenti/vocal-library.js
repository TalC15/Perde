'use strict';
// Blobs never travel through runtime messaging or chrome.storage. Metadata and
// audio commit together, while listing the library reads only the small index.
globalThis.PerdeVocalLibrary=(()=>{
  const DB_NAME='perde-vocal-library',VERSION=1,MAX_BYTES=100000000;
  let opening=null;
  function validId(videoId){if(typeof videoId!=='string'||!/^[-\w]{11}$/.test(videoId))throw Error('Geçersiz video kaydı.');return videoId;}
  function open(){
    if(opening)return opening;
    opening=new Promise((resolve,reject)=>{
      const request=indexedDB.open(DB_NAME,VERSION);let failed=false;
      request.onupgradeneeded=()=>{const db=request.result;for(const name of ['metadata','audio'])if(!db.objectStoreNames.contains(name))db.createObjectStore(name,{keyPath:'videoId'});};
      request.onerror=()=>{failed=true;opening=null;reject(request.error||Error('Vokal arşivi açılamadı.'));};
      request.onblocked=()=>{failed=true;opening=null;reject(Error('Vokal arşivi başka bir eklenti penceresinde meşgul.'));};
      request.onsuccess=()=>{
        const db=request.result;if(failed){db.close();return;}
        db.onversionchange=()=>{db.close();opening=null;};resolve(db);
      };
    });
    return opening;
  }
  async function transact(stores,mode,work,signal){
    const db=await open();
    if(signal?.aborted)throw new DOMException('Kayıt iptal edildi.','AbortError');
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(stores,mode);let result,error;
      const abort=()=>{try{tx.abort();}catch{}};
      const finish=()=>signal?.removeEventListener('abort',abort);
      tx.oncomplete=()=>{finish();try{resolve(typeof result==='function'?result():result);}catch(cause){reject(cause);}};
      tx.onerror=()=>{error=tx.error;};
      tx.onabort=()=>{finish();reject(error||tx.error||new DOMException('Kayıt iptal edildi.','AbortError'));};
      signal?.addEventListener('abort',abort,{once:true});
      try{result=work(tx);}catch(cause){error=cause;abort();}
    });
  }
  const cleanText=(value,limit)=>typeof value==='string'?value.slice(0,limit):'';
  return Object.freeze({
    async list(){return transact(['metadata'],'readonly',tx=>{const request=tx.objectStore('metadata').getAll();return()=>request.result.sort((a,b)=>b.savedAt-a.savedAt);});},
    async info(videoId){validId(videoId);return transact(['metadata'],'readonly',tx=>{const request=tx.objectStore('metadata').get(videoId);return()=>request.result||null;});},
    async get(videoId){
      validId(videoId);return transact(['metadata','audio'],'readonly',tx=>{
        const metadata=tx.objectStore('metadata').get(videoId),audio=tx.objectStore('audio').get(videoId);
        return()=>metadata.result&&audio.result?.blob?{...metadata.result,blob:audio.result.blob}:null;
      });
    },
    async put(record,{signal}={}){
      validId(record?.videoId);
      if(!(record.blob instanceof Blob)||record.blob.size<=0||record.blob.size>MAX_BYTES)throw Error('Kaydedilecek vokal dosyası geçersiz.');
      if(!Number.isFinite(record.totalSeconds)||record.totalSeconds<=0)throw Error('Vokal süresi geçersiz.');
      const metadata={videoId:record.videoId,title:cleanText(record.title,300)||record.videoId,totalSeconds:record.totalSeconds,bytes:record.blob.size,savedAt:Date.now(),audioLanguage:cleanText(record.audioLanguage,40),audioSelection:cleanText(record.audioSelection,120)};
      return transact(['metadata','audio'],'readwrite',tx=>{
        tx.objectStore('audio').put({videoId:record.videoId,blob:record.blob});
        tx.objectStore('metadata').put(metadata);return metadata;
      },signal);
    },
    async remove(videoId){validId(videoId);return transact(['metadata','audio'],'readwrite',tx=>{for(const name of ['metadata','audio'])tx.objectStore(name).delete(videoId);return true;});},
    async clear(){return transact(['metadata','audio'],'readwrite',tx=>{for(const name of ['metadata','audio'])tx.objectStore(name).clear();return true;});}
  });
})();
