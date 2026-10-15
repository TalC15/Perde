'use strict';
globalThis.PerdeMusicLibrary=(()=>{
  const MAX_TRACKS=10,MAX_BYTES=25*1024*1024;
  let opening;
  const valid=id=>{if(!/^[a-f0-9]{64}$/.test(id||''))throw Error('Geçersiz MP3 kaydı.');};
  function open(){
    if(opening)return opening;
    opening=new Promise((resolve,reject)=>{
      const request=indexedDB.open('perde-music-library',1);let failed=false;
      request.onupgradeneeded=()=>{for(const name of ['metadata','audio'])request.result.createObjectStore(name,{keyPath:'id'});};
      request.onerror=request.onblocked=()=>{failed=true;opening=null;reject(request.error||Error('MP3 kitaplığı açılamadı.'));};
      request.onsuccess=()=>{const db=request.result;if(failed){db.close();return;}db.onversionchange=()=>{db.close();opening=null;};resolve(db);};
    });return opening;
  }
  async function transaction(stores,mode,work){
    const db=await open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(stores,mode);let value,error;
      const fail=cause=>{error=cause;try{tx.abort();}catch{reject(cause);}};
      tx.oncomplete=()=>resolve(typeof value==='function'?value():value);
      tx.onabort=()=>reject(error||tx.error||Error('MP3 işlemi tamamlanamadı.'));
      tx.onerror=()=>{error=error||tx.error;};
      try{value=work(tx,fail);}catch(cause){fail(cause);}
    });
  }
  return Object.freeze({MAX_TRACKS,MAX_BYTES,
    async list(){return transaction(['metadata'],'readonly',tx=>{const r=tx.objectStore('metadata').getAll();return()=>r.result.sort((a,b)=>b.savedAt-a.savedAt);});},
    async info(id){valid(id);return transaction(['metadata'],'readonly',tx=>{const r=tx.objectStore('metadata').get(id);return()=>r.result||null;});},
    async get(id){valid(id);return transaction(['metadata','audio'],'readonly',tx=>{const m=tx.objectStore('metadata').get(id),a=tx.objectStore('audio').get(id);return()=>m.result&&a.result?{...m.result,blob:a.result.blob}:null;});},
    async put({title,blob,totalSeconds}){
      if(!(blob instanceof Blob)||!blob.size||blob.size>MAX_BYTES||!['audio/mpeg','audio/mp3'].includes(blob.type))throw Error('En fazla 25 MB boyutunda bir MP3 seç.');
      if(!Number.isFinite(totalSeconds)||totalSeconds<=0)throw Error('MP3 süresi okunamadı.');
      const hash=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());
      const id=Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
      const item={id,title:String(title||'MP3').slice(0,200),bytes:blob.size,totalSeconds,savedAt:Date.now()};
      return transaction(['metadata','audio'],'readwrite',(tx,fail)=>{
        const meta=tx.objectStore('metadata'),request=meta.getAll();
        request.onsuccess=()=>{
          if(!request.result.some(track=>track.id===id)&&request.result.length>=MAX_TRACKS){fail(Error('Kitaplık dolu. En fazla 10 MP3 saklanabilir; önce bir parça sil.'));return;}
          meta.put(item);tx.objectStore('audio').put({id,blob});
        };return item;
      });
    },
    async remove(id){valid(id);return transaction(['metadata','audio'],'readwrite',tx=>{tx.objectStore('metadata').delete(id);tx.objectStore('audio').delete(id);});}
  });
})();
