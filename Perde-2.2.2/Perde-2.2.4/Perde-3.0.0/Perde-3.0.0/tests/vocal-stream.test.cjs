const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=name=>fs.readFileSync(path.join(__dirname,'../eklenti',name),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
// 192 kbit/s, 44.1 kHz MPEG-1 Layer III frames: 626 bytes, 627 with padding.
function frames(count){
  const parts=[];for(let i=0;i<count;i++){const pad=i%3===0?1:0,frame=Buffer.alloc(626+pad,i%251);frame[0]=0xFF;frame[1]=0xFB;frame[2]=0xB0|(pad<<1);frame[3]=0x44;parts.push(frame);}
  return Buffer.concat(parts);
}
function streamContext(extra={}){
  const context=vm.createContext({Blob,Uint8Array,Uint32Array,Math,URL:{createObjectURL:()=>'blob:media',revokeObjectURL(){}},setInterval:()=>0,clearInterval(){},...extra});
  vm.runInContext(source('vocal-stream.js'),context);
  return context;
}
test('Frame index counts only complete frames, whatever the chunk boundaries',()=>{
  const {PerdeVocalStream:{FrameIndex,FRAME_SECONDS}}=streamContext();
  const data=frames(500),index=new FrameIndex();
  for(let at=0;at<data.length-300;at+=777)index.push(data.subarray(at,Math.min(at+777,data.length-300)));
  assert.equal(index.count,499);
  index.push(data.subarray(index.length));
  assert.equal(index.count,500);assert.ok(Math.abs(index.seconds-500*FRAME_SECONDS)<1e-9);
  assert.deepEqual(Buffer.from(index.slice(10,12)),data.subarray(index.offsets[10],index.offsets[12]));
  assert.equal(index.frameAt(1e9),500);
});
function fakeMedia(appended){
  class SourceBuffer{constructor(){this.updating=false;this.mode='segments';this.timestampOffset=0;this.buffered={length:0};this.listeners={};}
    addEventListener(name,f){this.listeners[name]=f;}appendBuffer(data){appended.push({offset:this.timestampOffset,bytes:data.length});}remove(){}}
  class MediaSource{static isTypeSupported(type){return type==='audio/mpeg';}
    constructor(){this.readyState='open';this.duration=NaN;}
    addEventListener(name,f){if(name==='sourceopen')setImmediate(f);}
    addSourceBuffer(){return new SourceBuffer();}endOfStream(){this.readyState='ended';}}
  return MediaSource;
}
function engine(fetch){
  let listener;const appended=[];
  const audio={paused:true,currentTime:0,duration:NaN,playbackRate:1,volume:1,src:'',pause(){this.paused=true;},async play(){this.paused=false;},removeAttribute(){},load(){},addEventListener(){},removeEventListener(){}};
  const context=streamContext({chrome:{runtime:{id:'test',onMessage:{addListener:f=>listener=f}}},performance,setTimeout:(f,ms)=>setTimeout(f,Math.min(ms,5)),clearTimeout,AbortController,PerdeVocalLibrary:{get:async()=>null,put:async()=>{}},Audio:function(){return audio;},MediaSource:fakeMedia(appended),fetch});
  vm.runInContext(source('audio-engine.js'),context);
  const send=(fields={})=>new Promise(resolve=>listener({target:'perde-audio',type:'audio-load',job:'a'.repeat(32),token:'secret',totalSeconds:60,...fields},{id:'test'},resolve));
  return {send,audio,appended,sync:time=>send({type:'audio-sync',time,rate:1,volume:1,playing:true})};
}
test('A recording that is still being separated plays its first part and reports how far it goes',async()=>{
  const data=frames(2300),requests=[];let available=frames(0).length,ready=false,failed=false;
  const e=engine(async(url,options)=>{
    const [start,end]=options.headers.Range.slice(6).split('-').map(Number);requests.push(start);
    if(failed)return new Response(JSON.stringify({error:'Bellek yetersiz kaldı.'}),{status:409});
    if(start>=available)return new Response(null,{status:204});
    const last=Math.min(end,available-1);
    return new Response(data.subarray(start,last+1),{status:206,headers:{'Content-Range':`bytes ${start}-${last}/${ready?data.length:'*'}`}});
  });
  assert.equal((await e.send()).state,'loading');
  available=627*600;for(let i=0;i<20;i++)await tick();
  await new Promise(resolve=>setTimeout(resolve,20));
  const first=await e.send();assert.equal(first.state,'ready');assert.equal(first.complete,false);
  const sync=await e.sync(1);assert.equal(sync.complete,false);assert.ok(sync.availableUntil>15&&sync.availableUntil<16);
  // The vocal never plays beyond the separated part.
  assert.equal(e.audio.paused,false);await e.sync(sync.availableUntil-.1);assert.equal(e.audio.paused,true);
  assert.ok(requests.filter(x=>x>0).length>=1);
  available=data.length;ready=true;
  for(let i=0;i<40;i++){await tick();await new Promise(resolve=>setTimeout(resolve,2));}
  const done=await e.send();assert.equal(done.complete,true);
  const final=await e.sync(10);assert.equal(final.complete,true);assert.equal(final.availableUntil,null);
  assert.ok(e.appended.length>0);assert.equal(e.appended[0].offset,0);
  await e.send({type:'audio-release'});
});
test('A separation failure during streaming ends the session with its reason instead of retrying',async()=>{
  let fail=false;const data=frames(800);await new Promise(resolve=>setTimeout(resolve,0));
  const e=engine(async(url,options)=>{const [start,end]=options.headers.Range.slice(6).split('-').map(Number);
    if(fail)return new Response(JSON.stringify({error:'Bellek yetersiz kaldı.'}),{status:409});
    if(start>=data.length)return new Response(null,{status:204});
    const last=Math.min(end,data.length-1);return new Response(data.subarray(start,last+1),{status:206,headers:{'Content-Range':`bytes ${start}-${last}/*`}});});
  await e.send();for(let i=0;i<20;i++)await tick();
  assert.equal((await e.send()).state,'ready');
  fail=true;await new Promise(resolve=>setTimeout(resolve,30));
  const result=await e.sync(1);assert.equal(result.ok,false);assert.equal(result.reload,false);assert.match(result.error,/Bellek/);
  await e.send({type:'audio-release'});
});
