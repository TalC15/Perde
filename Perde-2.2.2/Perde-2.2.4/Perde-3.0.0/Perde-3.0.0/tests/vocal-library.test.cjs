const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
// A transactional IndexedDB double: writes become visible only at commit and
// a failed request rolls back both stores. No browser process or server needed.
function database(){
  const stores=new Map(),reads=[];let failStore=null;
  const db={
    objectStoreNames:{contains:name=>stores.has(name)},createObjectStore:name=>stores.set(name,new Map()),close(){},
    transaction(names,mode){
      const pending=new Map(names.map(name=>[name,new Map(stores.get(name))])),queue=[];let ended=false;
      const tx={error:null,abort(){if(ended)return;ended=true;setImmediate(()=>tx.onabort?.());},objectStore(name){
        assert.ok(names.includes(name));
        const request=(operation)=>{const req={};queue.push(()=>{req.result=operation();});return req;};
        const write=(operation)=>request(()=>{if(failStore===name){const error=Error('Storage full');error.name='QuotaExceededError';throw error;}operation();});
        return {
          get:key=>request(()=>{reads.push(name);return pending.get(name).get(key);}),
          getAll:()=>request(()=>{reads.push(name);return [...pending.get(name).values()];}),
          put:value=>write(()=>pending.get(name).set(value.videoId,value)),
          delete:key=>write(()=>pending.get(name).delete(key)),clear:()=>write(()=>pending.get(name).clear())
        };
      }};
      setImmediate(()=>{
        if(ended)return;
        try{for(const operation of queue)operation();if(mode==='readwrite')for(const [name,values] of pending)stores.set(name,values);ended=true;tx.oncomplete?.();}
        catch(error){tx.error=error;tx.onerror?.();tx.abort();}
      });return tx;
    }
  };
  return {reads,stores,fail(name){failStore=name;},open(){const request={result:db};setImmediate(()=>{if(!stores.size)request.onupgradeneeded?.();request.onsuccess?.();});return request;}};
}
function library(indexedDB){const context=vm.createContext({indexedDB,Blob,DOMException,AbortController});vm.runInContext(fs.readFileSync(path.join(__dirname,'../eklenti/vocal-library.js'),'utf8'),context);return context.PerdeVocalLibrary;}
const record=(videoId='AbCdEfG_123')=>({videoId,title:'A saved video',totalSeconds:2400,blob:new Blob(['vocal'],{type:'audio/mpeg'})});
test('Library survives a fresh extension context and listing does not read stored audio blobs',async()=>{
  const db=database(),first=library(db);await first.put(record());
  const second=library(db),listing=await second.list();assert.equal(listing.length,1);assert.equal(listing[0].videoId,'AbCdEfG_123');assert.equal(listing[0].bytes,5);assert.equal(listing[0].totalSeconds,2400);assert.equal('blob' in listing[0],false);assert.deepEqual(db.reads,['metadata']);
  const restored=await second.get('AbCdEfG_123');assert.equal(await restored.blob.text(),'vocal');assert.equal((await second.info('AbCdEfG_123')).title,'A saved video');
});
test('Quota failure cannot leave an unlisted audio blob or overwrite the previous recording',async()=>{
  const db=database(),lib=library(db);await lib.put(record());db.fail('metadata');
  await assert.rejects(lib.put({...record(),blob:new Blob(['replacement'])}),{name:'QuotaExceededError'});
  assert.equal(await (await lib.get('AbCdEfG_123')).blob.text(),'vocal');assert.equal((await lib.info('AbCdEfG_123')).bytes,5);
  await assert.rejects(lib.put(record('XyZaBcD_456')),{name:'QuotaExceededError'});assert.equal(await lib.get('XyZaBcD_456'),null);assert.equal(db.stores.get('audio').has('XyZaBcD_456'),false);
});
test('Removing and clearing recordings delete both metadata and blobs',async()=>{
  const db=database(),lib=library(db);await lib.put(record());await lib.put(record('XyZaBcD_456'));
  await lib.remove('AbCdEfG_123');assert.equal(await lib.info('AbCdEfG_123'),null);assert.equal(db.stores.get('audio').has('AbCdEfG_123'),false);assert.equal((await lib.list()).length,1);
  await lib.clear();assert.equal((await lib.list()).length,0);assert.equal(db.stores.get('audio').size,0);
});
test('Invalid records and aborted saves never create library entries',async()=>{
  const db=database(),lib=library(db);
  await assert.rejects(lib.put(record('bad')));await assert.rejects(lib.put({...record(),totalSeconds:NaN}));await assert.rejects(lib.put({...record(),blob:new Blob([])}));
  const controller=new AbortController();controller.abort();await assert.rejects(lib.put(record(),{signal:controller.signal}),{name:'AbortError'});
  assert.equal((await lib.list()).length,0);
});
