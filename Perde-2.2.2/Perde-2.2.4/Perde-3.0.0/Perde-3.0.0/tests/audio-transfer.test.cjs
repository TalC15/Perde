const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function engine(fetch,library={get:async()=>null,put:async()=>{}}){
  let listener,blob;const audio={pause(){},removeAttribute(){},load(){}};
  const context=vm.createContext({chrome:{runtime:{id:'test',onMessage:{addListener:f=>listener=f}}},performance,setInterval(){},setTimeout,clearTimeout,AbortController,Blob,PerdeVocalLibrary:library,Audio:function(){return audio;},URL:{createObjectURL:b=>{blob=b;return 'blob:test';},revokeObjectURL(){}},fetch});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../eklenti/audio-engine.js'),'utf8'),context);
  const send=(fields={})=>new Promise(resolve=>listener({target:'perde-audio',type:'audio-load',job:'a'.repeat(32),token:'secret',...fields},{id:'test'},resolve));
  return {send,blob:()=>blob};
}
function part(data,start,end){end=Math.min(end,data.length-1);return new Response(data.subarray(start,end+1),{status:206,headers:{'Content-Range':`bytes ${start}-${end}/${data.length}`}});}
test('Failed range resumes at same offset without downloading earlier chunks or separating again',async()=>{
  const data=Buffer.alloc(2500000,93),ranges=[];let failing=true;
  const e=engine(async(url,options)=>{const [start,end]=options.headers.Range.slice(6).split('-').map(Number);ranges.push(start);if(start===1048576&&failing)throw Error('Failed to fetch');return part(data,start,end);});
  assert.equal((await e.send()).state,'loading');await tick();
  const error=await e.send();assert.equal(error.state,'error');assert.equal(error.retryable,true);
  assert.deepEqual(ranges,[0,1048576,1048576,1048576]);
  failing=false;assert.equal((await e.send({retry:true})).state,'loading');await tick();
  assert.equal((await e.send()).state,'ready');assert.equal(ranges.filter(x=>x===0).length,1);
  assert.deepEqual(Buffer.from(await e.blob().arrayBuffer()),data);
});
test('A long transfer answers status immediately and cancellation aborts its fetch',async()=>{
  let signal;const e=engine(async(url,options)=>{signal=options.signal;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted'))));});
  assert.equal((await e.send()).state,'loading');assert.equal((await e.send()).state,'loading');
  await e.send({type:'audio-release'});await tick();assert.equal(signal.aborted,true);assert.equal(e.blob(),undefined);
});
test('Truncated and oversized ranged responses never become playable',async()=>{
  for(const response of [()=>new Response(new Uint8Array(9),{status:206,headers:{'Content-Range':'bytes 0-99/100'}}),()=>new Response(new Uint8Array(101),{status:206,headers:{'Content-Range':'bytes 0-99/100'}}),()=>new Response(new Uint8Array(1),{status:206,headers:{'Content-Range':'bytes 0-0/100000001'}})]){
    const e=engine(async()=>response());await e.send();await tick();assert.equal((await e.send()).state,'error');assert.equal(e.blob(),undefined);
  }
});
test('Completed audio is saved once and remains available in a fresh offscreen document without service access',async()=>{
  const records=new Map(),data=Buffer.alloc(1200000,67);let writes=0;
  const library={async get(id){return records.get(id)||null;},async put(record){writes++;records.set(record.videoId,record);}};
  const e=engine(async(url,options)=>{const [start,end]=options.headers.Range.slice(6).split('-').map(Number);return part(data,start,end);},library);
  await e.send({saveVocal:true,videoId:'AbCdEfG_123',title:'A saved video',totalSeconds:2200});await tick();
  const ready=await e.send();assert.equal(ready.state,'ready');assert.equal(ready.saved,true);assert.equal(writes,1);
  await e.send();assert.equal(writes,1);
  await e.send({type:'audio-release'});
  const reopened=engine(async()=>{throw Error('The service must not be used');},library);
  await reopened.send({type:'audio-load-saved',videoId:'AbCdEfG_123'});await tick();
  const loaded=await reopened.send({type:'audio-load-saved',videoId:'AbCdEfG_123'});
  assert.equal(loaded.state,'ready');assert.equal(loaded.saved,true);
  assert.deepEqual(Buffer.from(await reopened.blob().arrayBuffer()),data);
});
test('Retention can be enabled after playback is ready, and disabling it preserves the saved copy',async()=>{
  let saved;const e=engine(async()=>part(Buffer.from('audio'),0,99),{put:async record=>{saved=record;}});
  await e.send({videoId:'AbCdEfG_123',totalSeconds:30});await tick();assert.equal((await e.send()).saved,false);assert.equal(saved,undefined);
  assert.equal((await e.send({type:'audio-retain',saveVocal:true})).saved,true);
  assert.equal(saved.videoId,'AbCdEfG_123');assert.equal(await saved.blob.text(),'audio');
  const disabled=await e.send({type:'audio-retain',saveVocal:false});assert.equal(disabled.saved,true);assert.equal(disabled.saveVocal,false);assert.ok(saved);
});
test('Quota failures keep the completed audio playable and allow saving to be retried',async()=>{
  let full=true;const e=engine(async()=>part(Buffer.from('audio'),0,99),{put:async()=>{if(full){const error=Error('Full');error.name='QuotaExceededError';throw error;}}});
  await e.send({saveVocal:true,videoId:'AbCdEfG_123',totalSeconds:40});await tick();
  const status=await e.send();assert.equal(status.ok,true);assert.equal(status.state,'ready');assert.equal(status.saved,false);assert.match(status.cacheWarning,/boş yer/);assert.ok(e.blob());
  full=false;const retry=await e.send({type:'audio-retain',saveVocal:true});assert.equal(retry.saved,true);assert.equal(retry.cacheWarning,null);
});
test('Navigation aborts a pending save and a late cache read cannot replace the new audio',async()=>{
  let signal,resolveRead;
  const e=engine(async()=>part(Buffer.from('new audio'),0,99),{get:()=>new Promise(resolve=>{resolveRead=resolve;}),put:(record,options)=>{signal=options.signal;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted'))));}});
  await e.send({type:'audio-load-saved',videoId:'AbCdEfG_123'});
  await e.send({saveVocal:true,videoId:'XyZaBcD_456',totalSeconds:30});await tick();assert.ok(signal);assert.equal(await e.blob().text(),'new audio');
  resolveRead({videoId:'AbCdEfG_123',blob:new Blob(['old audio'])});await tick();assert.equal(await e.blob().text(),'new audio');
  await e.send({type:'audio-release'});assert.equal(signal.aborted,true);
});
test('Opting out before transfer completion prevents a library write',async()=>{
  let finish,writes=0;const e=engine(()=>new Promise(resolve=>{finish=resolve;}),{put:async()=>{writes++;}});
  await e.send({saveVocal:true,videoId:'AbCdEfG_123',totalSeconds:30});await e.send({type:'audio-retain',saveVocal:false});
  finish(part(Buffer.from('audio'),0,99));await tick();assert.equal((await e.send()).state,'ready');assert.equal(writes,0);
});
test('Forgetting the active recording preserves playback and permits saving the same blob again',async()=>{
  const records=new Map();let writes=0;
  const e=engine(async()=>part(Buffer.from('audio'),0,99),{put:async record=>{writes++;records.set(record.videoId,record);}});
  await e.send({saveVocal:true,videoId:'AbCdEfG_123',totalSeconds:30});await tick();assert.equal((await e.send()).saved,true);
  await e.send({type:'audio-forget',videoId:'Different_1'});assert.equal((await e.send()).saved,true);
  await e.send({type:'audio-forget',videoId:'AbCdEfG_123'});records.delete('AbCdEfG_123');
  const forgotten=await e.send();assert.equal(forgotten.state,'ready');assert.equal(forgotten.saved,false);assert.equal(forgotten.saveVocal,false);assert.equal(await e.blob().text(),'audio');
  assert.equal((await e.send({type:'audio-retain',saveVocal:true})).saved,true);assert.equal(writes,2);assert.equal(await records.get('AbCdEfG_123').blob.text(),'audio');
});
test('Forgetting waits for an aborted pending write before allowing the library to be deleted',async()=>{
  let writeFinished=false,signal;
  const e=engine(async()=>part(Buffer.from('audio'),0,99),{put:(record,options)=>{signal=options.signal;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>setImmediate(()=>{writeFinished=true;reject(Error('aborted'));})));}});
  await e.send({saveVocal:true,videoId:'AbCdEfG_123',totalSeconds:30});await tick();assert.ok(signal);
  await e.send({type:'audio-forget'});assert.equal(signal.aborted,true);assert.equal(writeFinished,true);
  const forgotten=await e.send();assert.equal(forgotten.state,'ready');assert.equal(forgotten.saved,false);assert.equal(forgotten.saveVocal,false);assert.equal(forgotten.cacheWarning,null);assert.equal(await e.blob().text(),'audio');
});
test('A cache read finishing after deletion cannot restore the saved flag',async()=>{
  let finish;const e=engine(async()=>{throw Error('No HTTP expected');},{get:()=>new Promise(resolve=>{finish=resolve;})});
  await e.send({type:'audio-load-saved',videoId:'AbCdEfG_123'});await e.send({type:'audio-forget'});
  finish({videoId:'AbCdEfG_123',totalSeconds:30,blob:new Blob(['audio'])});await tick();
  const status=await e.send({type:'audio-load-saved',videoId:'AbCdEfG_123'});assert.equal(status.state,'ready');assert.equal(status.saved,false);assert.equal(status.saveVocal,false);
});
