const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function engine(fetch){
  let listener,blob;const audio={pause(){},removeAttribute(){},load(){}};
  const context=vm.createContext({chrome:{runtime:{id:'test',onMessage:{addListener:f=>listener=f}}},performance,setInterval(){},setTimeout,clearTimeout,AbortController,Blob,Audio:function(){return audio;},URL:{createObjectURL:b=>{blob=b;return 'blob:test';},revokeObjectURL(){}},fetch});
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
