'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'../eklenti');
const settings=require(path.join(root,'settings.js'));
const tracking=require(path.join(root,'tracking.js'));

test('Profiles migrate existing settings and constrain inputs',()=>{
  assert.equal(settings.normalize({confidence:.15}).profile,'high');
  assert.equal(settings.normalize({maxMinutes:999,profile:'__proto__'}).maxMinutes,40);
  assert.equal(settings.normalize({maxMinutes:40}).maxMinutes,40);
  assert.equal(settings.normalize({}).maxMinutes,40);
  assert.equal(settings.normalize({maxMinutes:25}).maxMinutes,25);
  assert.equal(settings.normalize({maxMinutes:15}).maxMinutes,15);
  assert.equal(settings.normalize({maxMinutes:10}).maxMinutes,10);
  assert.equal(settings.normalize(null).profile,'balanced');
  assert.equal(settings.normalize({profile:'high'}).detail,'high');
  assert.equal(settings.normalize({muteAds:false}).muteAds,false);
});
test('Only HTTPS YouTube IDs are accepted',()=>{
  assert.equal(settings.videoId('https://www.youtube.com/watch?v=abcdefghijk'),'abcdefghijk');
  assert.equal(settings.videoId('https://www.youtube.com/shorts/abcdefghijk'),'abcdefghijk');
  for(const url of ['https://youtube.com.evil.test/watch?v=abcdefghijk','http://youtube.com/watch?v=abcdefghijk','https://youtube.com/watch?v=bad'])assert.equal(settings.videoId(url),null);
});
test('Masks cover tracked regions and reject nonfinite boxes',()=>{
  const tracker=new tracking.Tracker();tracker.update([[.2,.2,.2,.4]],0);tracker.update([[.22,.2,.2,.4]],100);
  const box=tracker.sample(150,.15)[0].box;assert.ok(box[0]<.22);assert.ok(box[2]>.2);
  assert.throws(()=>tracker.update([[NaN,0,1,1]],200));
});
function background(engineReply=()=>({ok:true})){
  const session={},local={settings:settings.defaults},listeners=[],calls=[];
  const storage=data=>({get:async key=>typeof key==='string'?{[key]:data[key]}:{...key,...data},set:async values=>Object.assign(data,values),remove:async key=>{delete data[key];}});
  const chrome={runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,getManifest:()=>({version:'2.2.0'}),getContexts:async()=>[{}],onMessage:{addListener:f=>listeners.push(f)},sendMessage:async msg=>{calls.push(msg);return {ok:true};},onInstalled:{addListener(){}},onStartup:{addListener(){}}},storage:{session:storage(session),local:storage(local)},permissions:{contains:async({origins})=>origins.every(o=>o.includes('youtube.com')||o.includes('127.0.0.1')),onRemoved:{addListener(){}}},tabs:{onRemoved:{addListener(){}},onUpdated:{addListener(){}}},scripting:{getRegisteredContentScripts:async()=>[]}};
  chrome.runtime.sendMessage=async msg=>{calls.push(msg);return engineReply(msg);};
  const context=vm.createContext({chrome,PerdeSettings:settings,importScripts(){},URL,AbortSignal,fetch:async(url,opts)=>{calls.push({url,opts});return {ok:true,json:async()=>url.endsWith('/health')?{ok:true}:{id:'a'.repeat(32),state:'ready',audioLanguage:'tr',audioSelection:'turkish'}};},btoa,Map,console});
  vm.runInContext(fs.readFileSync(path.join(root,'background.js'),'utf8'),context);
  const send=(message,sender)=>new Promise(resolve=>{const kept=listeners[0](message,sender,resolve);if(!kept)resolve(undefined);});
  return {session,local,calls,send};
}
const page={id:'test',url:'chrome-extension://test/popup.html'};
const youtube={id:'test',url:'https://www.youtube.com/watch?v=abcdefghijk',tab:{id:7},frameId:0};
test('Service secrets cannot be set by a content script',async()=>{
  const b=background();const result=await b.send({type:'service-connect',token:'x'.repeat(43)},youtube);assert.equal(result.ok,false);assert.equal(b.session.vocalToken,undefined);
});
test('Vocal owner binding, one job limit, ready load, and cancellation',async()=>{
  const b=background();assert.equal((await b.send({type:'service-connect',token:'x'.repeat(43)},page)).ok,true);
  assert.equal((await b.send({type:'vocal-start',videoId:'abcdefghijk'},youtube)).ok,true);
  assert.equal((await b.send({type:'vocal-start',videoId:'abcdefghijk'},youtube)).ok,false);
  assert.equal((await b.send({type:'vocal-status'},{...youtube,tab:{id:8}})).ok,false);
  const status=await b.send({type:'vocal-status'},youtube);assert.equal(status.state,'ready');assert.equal(status.audioLanguage,'tr');assert.equal(status.audioSelection,'turkish');
  assert.ok(b.calls.some(c=>c.type==='audio-load'));
  assert.equal((await b.send({type:'vocal-cancel'},youtube)).ok,true);assert.equal(b.session.vocalJob,undefined);
  assert.ok(b.calls.some(c=>c.opts?.method==='DELETE'));
});
test('Navigation cancels the prior vocal session',async()=>{
  const b=background();b.session.vocalToken='x'.repeat(43);await b.send({type:'vocal-start',videoId:'abcdefghijk'},youtube);
  const result=await b.send({type:'vocal-sync'},{...youtube,url:'https://www.youtube.com/watch?v=zyxwvutsrqp'});assert.equal(result.ok,false);assert.equal(b.session.vocalJob,undefined);
});
test('Remote unpermitted pages cannot use privileged fetch',async()=>{
  const b=background();const result=await b.send({type:'image-read',url:'http://127.0.0.1/private'},{id:'test',tab:{id:8},url:'https://evil.test'});assert.equal(result.ok,false);assert.equal(b.calls.length,0);
});
test('Offscreen rejects direct page instructions and silences an expired playback lease',async()=>{
  let listener,timer,clock=0;const audio={paused:true,currentTime:0,playbackRate:1,volume:1,pause(){this.paused=true;},async play(){this.paused=false;},removeAttribute(){},load(){}};
  const context=vm.createContext({chrome:{runtime:{id:'test',onMessage:{addListener:f=>listener=f}}},performance:{now:()=>clock},setInterval:f=>timer=f,setTimeout,clearTimeout,AbortController,Blob,Audio:function(){return audio;},URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},AbortSignal,fetch:async()=>new Response(new Uint8Array(100),{status:206,headers:{'Content-Range':'bytes 0-99/100'}})});
  vm.runInContext(fs.readFileSync(path.join(root,'audio-engine.js'),'utf8'),context);
  const send=(msg,sender={id:'test'})=>new Promise(resolve=>{if(!listener({...msg,target:'perde-audio'},sender,resolve))resolve(undefined);});
  assert.equal(await send({type:'audio-load',job:'a'.repeat(32),token:'x'},youtube),undefined);
  await send({type:'audio-load',job:'a'.repeat(32),token:'x'});
  await new Promise(resolve=>setImmediate(resolve));
  await send({type:'audio-sync',time:42,rate:1.5,volume:.4,playing:true});assert.equal(audio.currentTime,42);assert.equal(audio.paused,false);
  await send({type:'audio-sync',time:42,rate:1.5,volume:.4,playing:false});assert.equal(audio.paused,true);
  await send({type:'audio-sync',time:45,rate:1,volume:.4,playing:true});clock=1500;timer();assert.equal(audio.paused,true);
});

test('An active vocal heartbeat renews only its own job without reloading audio',async()=>{
  const b=background();b.session.vocalToken='x'.repeat(43);
  await b.send({type:'vocal-start',videoId:'abcdefghijk'},youtube);
  await b.send({type:'vocal-status'},youtube);b.calls.length=0;
  assert.equal((await b.send({type:'vocal-heartbeat'},youtube)).ok,true);
  assert.ok(b.calls.some(c=>c.url?.endsWith('/jobs/'+'a'.repeat(32))));
  assert.ok(!b.calls.some(c=>c.type==='audio-load'));
  b.calls.length=0;
  assert.equal((await b.send({type:'vocal-heartbeat'},{...youtube,tab:{id:999}})).ok,false);
  assert.equal(b.calls.length,0);
});

test('Transfer polling stays responsive, retains opt-in, and retry uses the existing job',async()=>{
  let state='loading';const b=background(msg=>msg.type==='audio-load'?{ok:state!=='error',state,progress:40,error:state==='error'?'interrupted':null}:{ok:true});
  b.session.vocalToken='x'.repeat(43);
  await b.send({type:'vocal-start',videoId:'abcdefghijk',saveVocal:true},youtube);
  assert.equal(JSON.parse(b.calls.find(c=>c.opts?.method==='POST').opts.body).saveVocal,true);
  assert.equal((await b.send({type:'vocal-status'},youtube)).state,'transferring');
  assert.equal(b.session.vocalJob.loaded,undefined);
  state='error';assert.equal((await b.send({type:'vocal-status'},youtube)).state,'transfer-error');
  state='ready';assert.equal((await b.send({type:'vocal-status',retry:true},youtube)).state,'ready');
  assert.ok(b.calls.some(c=>c.type==='audio-load'&&c.retry));
  assert.equal(b.calls.filter(c=>c.url?.endsWith('/jobs')&&c.opts.method==='POST').length,1);
  assert.equal(b.session.vocalJob.loaded,true);
  assert.equal((await b.send({type:'cache-clear'},youtube)).ok,false);
  assert.equal((await b.send({type:'vocal-retain',saveVocal:true},{...youtube,tab:{id:8}})).ok,false);
  assert.equal((await b.send({type:'vocal-retain',saveVocal:false},youtube)).ok,true);
  assert.equal((await b.send({type:'cache-clear'},page)).ok,true);
});
