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
function background(engineReply=()=>({ok:true}),options={}){
  const session={},local={settings:settings.defaults},listeners=[],calls=[],records=new Map((options.records||[]).map(record=>[record.videoId,structuredClone(record)]));
  const storage=data=>({get:async key=>structuredClone(typeof key==='string'?{[key]:data[key]}:{...key,...data}),set:async values=>Object.assign(data,structuredClone(values)),remove:async key=>{delete data[key];}});
  const events={};
  const chrome={runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,getManifest:()=>({version:'2.2.2'}),getContexts:async()=>[{}],onMessage:{addListener:f=>listeners.push(f)},sendMessage:async msg=>{calls.push(msg);return {ok:true};},onInstalled:{addListener(){}},onStartup:{addListener(){}}},storage:{session:storage(session),local:storage(local)},permissions:{contains:async({origins})=>origins.every(o=>o.includes('youtube.com')||o.includes('127.0.0.1')),onRemoved:{addListener(){}}},tabs:{onRemoved:{addListener:f=>events.removed=f},onUpdated:{addListener:f=>events.updated=f}},scripting:{getRegisteredContentScripts:async()=>[]}};
  chrome.runtime.sendMessage=async msg=>{calls.push(structuredClone(msg));return engineReply(msg);};
  const library={info:async id=>structuredClone(records.get(id)||null),list:async()=>structuredClone([...records.values()]),remove:async id=>records.delete(id),clear:async()=>records.clear()};
  const context=vm.createContext({chrome,PerdeSettings:settings,PerdeVocalLibrary:library,PerdeMusicLibrary:{list:async()=>options.music||[],info:async id=>(options.music||[]).find(item=>item.id===id),remove:async id=>{options.music=(options.music||[]).filter(item=>item.id!==id);}},importScripts(){},URL,AbortSignal,fetch:async(url,opts)=>{
    calls.push({url,opts});if(options.fetchReply)return options.fetchReply(url,opts);
    return {ok:true,json:async()=>url.endsWith('/health')?{ok:true}:url.includes('/cache/')?{available:false}:{id:'a'.repeat(32),state:'ready',totalSeconds:2300,audioLanguage:'tr',audioSelection:'turkish',saveVocal:false,saved:false}};
  },btoa,Map,console});
  vm.runInContext(fs.readFileSync(path.join(root,'background.js'),'utf8'),context);
  const send=(message,sender)=>new Promise(resolve=>{const kept=listeners[0](message,sender,resolve);if(!kept)resolve(undefined);});
  return {session,local,calls,send,records,events,idle:()=>vm.runInContext('vocalQueue',context)};
}
const page={id:'test',url:'chrome-extension://test/popup.html'};
const youtube={id:'test',url:'https://www.youtube.com/watch?v=abcdefghijk',tab:{id:7},frameId:0};
test('Service secrets cannot be set by a content script',async()=>{
  const b=background();const result=await b.send({type:'service-connect',token:'x'.repeat(43)},youtube);assert.equal(result.ok,false);assert.equal(b.session.vocalToken,undefined);
});

test('Service status is private and checks availability without exposing its token',async()=>{
  const b=background();
  assert.equal((await b.send({type:'service-status'},youtube)).ok,false);
  assert.equal((await b.send({type:'service-status'},page)).connected,false);assert.equal(b.calls.length,0);
  b.session.vocalToken='secret-'.repeat(8);
  const result=await b.send({type:'service-status'},page);
  assert.equal(result.connected,true);assert.equal(result.tokenPresent,true);
  assert.equal(JSON.stringify(result).includes(b.session.vocalToken),false);
  assert.equal(b.calls.filter(call=>call.url?.endsWith('/health')).length,1);
});

test('An unavailable service is shown as disconnected even if a session token remains',async()=>{
  const b=background(undefined,{fetchReply:async()=>{throw Error('offline');}});b.session.vocalToken='x'.repeat(43);
  const result=await b.send({type:'service-status'},page);
  assert.equal(result.ok,true);assert.equal(result.connected,false);assert.equal(result.tokenPresent,true);
  assert.match(result.error,/ulaşılamadı/);
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
  const context=vm.createContext({chrome:{runtime:{id:'test',onMessage:{addListener:f=>listener=f}},storage:{local:{set:async()=>{}}}},PerdeVocalLibrary:{info:async()=>null},performance:{now:()=>clock},setInterval:f=>timer=f,setTimeout,clearTimeout,AbortController,Blob,Audio:function(){return audio;},URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},AbortSignal,fetch:async()=>new Response(new Uint8Array(100),{status:206,headers:{'Content-Range':'bytes 0-99/100'}})});
  vm.runInContext(fs.readFileSync(path.join(root,'vocal-stream.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(root,'audio-engine.js'),'utf8'),context);
  const send=(msg,sender={id:'test'})=>new Promise(resolve=>{if(!listener({...msg,target:'perde-audio'},sender,resolve))resolve(undefined);});
  assert.equal(await send({type:'audio-load',job:'a'.repeat(32),token:'x'},youtube),undefined);
  await send({type:'audio-load',job:'a'.repeat(32),token:'x'});
  await new Promise(resolve=>setImmediate(resolve));
  await send({type:'audio-sync',time:42,rate:1.5,volume:.4,playing:true});assert.equal(audio.currentTime,42);assert.equal(audio.paused,false);
  await send({type:'audio-sync',time:42,rate:1.5,volume:.4,playing:false});assert.equal(audio.paused,true);
  await send({type:'audio-sync',time:45,rate:1,volume:.4,playing:true});clock=1500;timer();assert.equal(audio.paused,true);
});

test('Loaded vocal heartbeat does not depend on the service or reload audio',async()=>{
  const b=background();b.session.vocalToken='x'.repeat(43);
  await b.send({type:'vocal-start',videoId:'abcdefghijk'},youtube);
  await b.send({type:'vocal-status'},youtube);b.calls.length=0;
  assert.equal((await b.send({type:'vocal-heartbeat'},youtube)).ok,true);
  assert.equal(b.calls.length,0);
  b.calls.length=0;
  assert.equal((await b.send({type:'vocal-heartbeat'},{...youtube,tab:{id:999}})).ok,false);
  assert.equal(b.calls.length,0);
});

test('Transfer polling stays responsive, retains opt-in, and retry uses the existing job',async()=>{
  let state='loading';const b=background(msg=>msg.type==='audio-load'?{ok:state!=='error',state,progress:40,error:state==='error'?'interrupted':null}:{ok:true});
  b.session.vocalToken='x'.repeat(43);
  await b.send({type:'vocal-start',videoId:'abcdefghijk',saveVocal:true},youtube);
  assert.equal(JSON.parse(b.calls.find(c=>c.opts?.method==='POST').opts.body).saveVocal,false);
  assert.equal((await b.send({type:'vocal-status'},youtube)).state,'transferring');
  assert.ok(b.calls.some(c=>c.type==='audio-load'&&c.saveVocal===true&&c.videoId==='abcdefghijk'&&c.totalSeconds===2300));
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

const recording={videoId:'abcdefghijk',title:'Kaydedilmiş video',totalSeconds:2300,bytes:50000000,savedAt:123456,audioLanguage:'tr',audioSelection:'turkish'};
const savedReply=message=>({ok:true,...(['audio-load','audio-load-saved'].includes(message.type)?{state:'ready',saved:true}:{})});

test('Saved video lookup, playback, heartbeat, and cancellation need no token or network',async()=>{
  const b=background(savedReply,{records:[recording],fetchReply:()=>{throw Error('Unexpected network access');}});
  const found=await b.send({type:'vocal-lookup',videoId:recording.videoId},youtube);
  assert.equal(found.available,true);assert.equal(found.source,'browser');assert.equal(found.title,recording.title);
  assert.equal((await b.send({type:'vocal-use-saved',videoId:recording.videoId},youtube)).ok,true);
  assert.equal(b.session.vocalJob.source,'browser');assert.equal(b.session.vocalToken,undefined);
  const status=await b.send({type:'vocal-status'},youtube);
  assert.equal(status.state,'ready');assert.equal(status.saved,true);assert.equal(status.cached,true);
  assert.equal((await b.send({type:'vocal-sync',time:20,rate:1,volume:.5,playing:true},youtube)).ok,true);
  assert.equal((await b.send({type:'vocal-heartbeat'},youtube)).saved,true);
  assert.equal((await b.send({type:'vocal-cancel'},youtube)).ok,true);
  assert.equal(b.session.vocalJob,undefined);
  assert.equal(b.calls.filter(call=>call.url).length,0);
  assert.deepEqual(b.calls.filter(call=>call.type==='audio-load-saved').map(call=>call.videoId),[recording.videoId]);
  assert.ok(!b.calls.some(call=>call.type==='audio-load'));
});

test('Creating vocals for a known browser recording reuses it without starting separation',async()=>{
  const b=background(savedReply,{records:[recording]});
  assert.equal((await b.send({type:'vocal-start',videoId:recording.videoId},youtube)).cached,true);
  await b.send({type:'vocal-status'},youtube);
  assert.equal(b.session.vocalJob.loaded,true);
  assert.equal(b.calls.filter(call=>call.url).length,0);
});

test('Vocal lookup validates the sender video and does not expose another video record',async()=>{
  const b=background(savedReply,{records:[recording]});
  assert.equal((await b.send({type:'vocal-lookup',videoId:recording.videoId},{...youtube,url:'https://www.youtube.com/watch?v=zyxwvutsrqp'})).ok,false);
  assert.equal((await b.send({type:'vocal-lookup',videoId:recording.videoId},page)).ok,false);
  assert.equal(b.calls.length,0);
});

test('Only extension pages can list, remove, and clear saved recordings',async()=>{
  const other={...recording,videoId:'zyxwvutsrqp'};
  const b=background(savedReply,{records:[recording,other]});
  for(const type of ['vocal-library-list','vocal-library-remove','vocal-library-clear']){
    assert.equal((await b.send({type,videoId:recording.videoId},youtube)).ok,false);
    assert.equal((await b.send({type,videoId:recording.videoId},{...page,id:'another-extension'})).ok,false);
  }
  assert.equal(b.records.size,2);
  const list=await b.send({type:'vocal-library-list'},page);
  assert.equal(list.ok,true);assert.equal(list.items.length,2);assert.equal(list.items[0].title,recording.title);
  assert.equal((await b.send({type:'vocal-library-remove',videoId:recording.videoId},page)).ok,true);
  assert.equal(b.records.has(recording.videoId),false);assert.equal(b.records.has(other.videoId),true);
  assert.equal(typeof b.local.vocalLibraryChanged,'number');
  assert.equal((await b.send({type:'vocal-library-clear'},page)).ok,true);
  assert.equal(b.records.size,0);assert.equal(b.calls.length,0);
});

test('Removing an active saved recording disables resaving and keeps current playback usable',async()=>{
  const b=background(savedReply,{records:[recording]});
  await b.send({type:'vocal-use-saved',videoId:recording.videoId,saveVocal:true},youtube);
  await b.send({type:'vocal-status'},youtube);b.calls.length=0;
  assert.equal((await b.send({type:'vocal-library-remove',videoId:recording.videoId},page)).ok,true);
  assert.equal(b.records.size,0);assert.equal(b.session.vocalJob.saveVocal,false);assert.equal(b.session.vocalJob.saved,false);
  assert.ok(b.calls.some(call=>call.type==='audio-forget'&&call.videoId===recording.videoId));
  assert.ok(!b.calls.some(call=>call.type==='audio-release'));
  assert.equal((await b.send({type:'vocal-sync',time:40,rate:1,volume:.5,playing:true},youtube)).ok,true);
  assert.equal((await b.send({type:'vocal-heartbeat'},youtube)).saved,false);
});

test('Reloaded page owns the recording and delayed old-page cancellation cannot stop it',async()=>{
  const b=background(savedReply,{records:[recording]});
  const oldPage={...youtube,documentId:'old-document'},newPage={...youtube,documentId:'new-document'};
  await b.send({type:'vocal-use-saved',videoId:recording.videoId,clientId:'old-client'},oldPage);
  await b.send({type:'vocal-status',clientId:'old-client'},oldPage);
  b.events.updated(youtube.tab.id,{status:'loading'});await b.idle();
  assert.equal(b.session.vocalJob.documentId,'old-document');
  assert.equal((await b.send({type:'vocal-use-saved',videoId:recording.videoId,clientId:'new-client'},newPage)).ok,true);
  await b.send({type:'vocal-status',clientId:'new-client'},newPage);b.calls.length=0;
  for(const [sender,clientId] of [[oldPage,'old-client'],[newPage,'old-client'],[oldPage,'new-client']]){
    assert.equal((await b.send({type:'vocal-cancel',clientId},sender)).ok,false);
  }
  assert.equal(b.calls.length,0);assert.equal(b.session.vocalJob.documentId,'new-document');assert.equal(b.session.vocalJob.clientId,'new-client');
  assert.equal((await b.send({type:'vocal-sync',clientId:'new-client',time:40,rate:1,volume:.5,playing:true},newPage)).ok,true);
  assert.equal((await b.send({type:'vocal-cancel',clientId:'new-client'},newPage)).ok,true);
});

test('Another tab cannot replace an active saved recording',async()=>{
  const b=background(savedReply,{records:[recording]});
  await b.send({type:'vocal-use-saved',videoId:recording.videoId,clientId:'owner'},youtube);
  await b.send({type:'vocal-status',clientId:'owner'},youtube);b.calls.length=0;
  assert.equal((await b.send({type:'vocal-use-saved',videoId:recording.videoId,clientId:'other'},{...youtube,tab:{id:8}})).ok,false);
  assert.equal(b.session.vocalJob.tab,7);assert.equal(b.session.vocalJob.clientId,'owner');assert.equal(b.calls.length,0);
});

test('Legacy disk lookup imports through cache-only loading with browser retention',async()=>{
  const b=background(savedReply,{fetchReply:async(url,opts)=>({ok:true,json:async()=>url.includes('/cache/')?{available:true,totalSeconds:2300,audioLanguage:'tr',audioSelection:'turkish'}:{id:'a'.repeat(32),state:'ready',cached:true,totalSeconds:2300,audioLanguage:'tr',audioSelection:'turkish',saveVocal:false,saved:true}})});
  b.session.vocalToken='x'.repeat(43);
  const found=await b.send({type:'vocal-lookup',videoId:recording.videoId},youtube);
  assert.equal(found.source,'disk');assert.equal(found.available,true);
  assert.equal((await b.send({type:'vocal-use-saved',videoId:recording.videoId,title:'Eski kayıt'},youtube)).ok,true);
  const posted=JSON.parse(b.calls.find(call=>call.url?.endsWith('/jobs')&&call.opts.method==='POST').opts.body);
  assert.equal(posted.cacheOnly,true);assert.equal(posted.saveVocal,false);
  assert.equal((await b.send({type:'vocal-status'},youtube)).saved,true);
  assert.ok(b.calls.some(call=>call.type==='audio-load'&&call.saveVocal===true&&call.title==='Eski kayıt'));
});

test('Saved service audio restores from browser storage after offscreen restart',async()=>{
  const b=background(msg=>msg.type==='audio-sync'?{ok:false,reload:true}:savedReply(msg));
  b.session.vocalToken='x'.repeat(43);
  await b.send({type:'vocal-start',videoId:recording.videoId,saveVocal:true},youtube);
  await b.send({type:'vocal-status'},youtube);
  b.records.set(recording.videoId,recording);delete b.session.vocalToken;b.calls.length=0;
  assert.equal((await b.send({type:'vocal-sync',time:40,rate:1,volume:1,playing:true},youtube)).reload,true);
  assert.equal(b.session.vocalJob.source,'browser');assert.equal(b.session.vocalJob.loaded,false);
  assert.equal((await b.send({type:'vocal-status'},youtube)).state,'ready');
  assert.ok(b.calls.some(call=>call.type==='audio-load-saved'));
  assert.equal(b.calls.filter(call=>call.url).length,0);
});

test('Preparing heartbeat preserves browser save preference instead of the service disk flag',async()=>{
  const b=background(message=>message.type==='audio-load'?{ok:true,state:'loading',progress:50,saved:false}:{ok:true});
  b.session.vocalToken='x'.repeat(43);
  await b.send({type:'vocal-start',videoId:recording.videoId,saveVocal:true},youtube);
  assert.equal((await b.send({type:'vocal-status'},youtube)).state,'transferring');b.calls.length=0;
  const heartbeat=await b.send({type:'vocal-heartbeat'},youtube);
  assert.equal(heartbeat.ok,true);assert.equal(heartbeat.saveVocal,true);assert.equal(heartbeat.saved,false);
  assert.ok(b.calls.some(call=>call.url?.endsWith('/jobs/'+'a'.repeat(32))));
  assert.ok(!b.calls.some(call=>call.type==='audio-retain'||call.type==='audio-load'));
  assert.equal(b.session.vocalJob.saveVocal,true);
});

test('Disconnecting the service preserves browser recording playback even while loading',async()=>{
  const b=background(savedReply,{records:[recording]});b.session.vocalToken='x'.repeat(43);
  await b.send({type:'vocal-use-saved',videoId:recording.videoId},youtube);
  assert.equal(b.session.vocalJob.loaded,undefined);b.calls.length=0;
  assert.equal((await b.send({type:'service-disconnect'},page)).ok,true);
  assert.equal(b.session.vocalToken,undefined);assert.equal(b.session.vocalJob.source,'browser');assert.equal(b.calls.length,0);
  assert.equal((await b.send({type:'vocal-status'},youtube)).state,'ready');
  assert.equal((await b.send({type:'vocal-sync',time:40,rate:1,volume:1,playing:true},youtube)).ok,true);
  assert.equal(b.calls.filter(call=>call.url).length,0);
});

test('Disconnecting the service preserves already downloaded audio and its heartbeat',async()=>{
  const b=background(savedReply);b.session.vocalToken='x'.repeat(43);
  await b.send({type:'vocal-start',videoId:recording.videoId,saveVocal:true},youtube);
  await b.send({type:'vocal-status'},youtube);b.calls.length=0;
  assert.equal((await b.send({type:'service-disconnect'},page)).ok,true);
  assert.equal(b.session.vocalToken,undefined);assert.equal(b.session.vocalJob.loaded,true);assert.equal(b.calls.length,0);
  assert.equal((await b.send({type:'vocal-sync',time:40,rate:1,volume:1,playing:true},youtube)).ok,true);
  assert.equal((await b.send({type:'vocal-heartbeat'},youtube)).ok,true);
  assert.equal(b.calls.filter(call=>call.url).length,0);
});

test('Disconnecting the service still cancels an unfinished service transfer',async()=>{
  const b=background();b.session.vocalToken='x'.repeat(43);
  await b.send({type:'vocal-start',videoId:recording.videoId},youtube);b.calls.length=0;
  assert.equal((await b.send({type:'service-disconnect'},page)).ok,true);
  assert.equal(b.session.vocalToken,undefined);assert.equal(b.session.vocalJob,undefined);
  assert.ok(b.calls.some(call=>call.type==='audio-release'));
  assert.ok(b.calls.some(call=>call.url?.endsWith('/jobs/'+'a'.repeat(32))&&call.opts.method==='DELETE'));
});

test('A recording reopens after upgrade despite a legacy session without client ownership',async()=>{
  const b=background(savedReply,{records:[recording]});
  b.session.vocalJob={id:'a'.repeat(32),videoId:recording.videoId,tab:youtube.tab.id,frame:0,loaded:true};
  const currentPage={...youtube,documentId:'current-document'};
  const opened=await b.send({type:'vocal-use-saved',videoId:recording.videoId,clientId:'current-client'},currentPage);
  assert.equal(opened.ok,true);assert.equal(opened.cached,true);
  assert.equal(b.session.vocalJob.source,'browser');assert.equal(b.session.vocalJob.clientId,'current-client');
  assert.equal(b.session.vocalJob.documentId,'current-document');
  assert.equal((await b.send({type:'vocal-status',clientId:'current-client'},currentPage)).state,'ready');
  assert.equal((await b.send({type:'vocal-cancel'},youtube)).ok,false);
});

test('Invalid new keys cannot overwrite a working connection, and concurrent connects serialize',async()=>{
  let release;const hold=new Promise(resolve=>release=resolve),good='g'.repeat(43),bad='b'.repeat(43);
  const b=background(undefined,{fetchReply:async(url,opts)=>{if(opts.headers.Authorization===`Bearer ${bad}`){await hold;return {ok:false,status:401,json:async()=>({error:'bad key'})};}return {ok:true,json:async()=>({})};}});
  b.session.vocalToken=good;
  const failed=b.send({type:'service-connect',token:bad},page),success=b.send({type:'service-connect',token:good},page);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(b.session.vocalToken,good);
  release();assert.equal((await failed).ok,false);assert.equal((await success).connected,true);assert.equal(b.session.vocalToken,good);assert.equal(b.local.serviceReady.reset,false);
});
test('Reconnect reuses the stored key and clears only an unfinished missing service job',async()=>{
  for(const loaded of [false,true]){
    const b=background(undefined,{fetchReply:async url=>url.endsWith('/health')?{ok:true,json:async()=>({})}:{ok:false,status:404,json:async()=>({error:'missing'})}});
    b.session.vocalToken='x'.repeat(43);b.session.vocalJob={id:'a'.repeat(32),source:'service',loaded};
    assert.equal((await b.send({type:'service-reconnect'},page)).ok,true);
    assert.equal(b.local.serviceReady.reset,!loaded);assert.equal(!!b.session.vocalJob,loaded);
  }
});
test('Music selection reaches vocal sync; deleting the selected track immediately stops it',async()=>{
  const id='a'.repeat(64),b=background(undefined,{music:[{id,title:'Test'}]});
  assert.equal((await b.send({type:'music-select',id},youtube)).ok,true);
  b.session.vocalJob={tab:7,frame:0,videoId:'abcdefghijk',source:'browser',loaded:true};
  await b.send({type:'music-volume',volume:.25},youtube);
  await b.send({type:'vocal-sync',time:45,rate:1,volume:.8,playing:true},youtube);
  const sync=b.calls.find(c=>c.type==='audio-sync');assert.equal(sync.musicId,id);assert.equal(sync.musicVolume,.25);
  assert.equal((await b.send({type:'music-remove',id},youtube)).ok,false);
  assert.equal((await b.send({type:'music-remove',id},page)).ok,true);assert.equal(b.local.backgroundTrackId,null);assert(b.calls.some(c=>c.type==='audio-music-clear'));
  assert.equal((await b.send({type:'music-select',id},youtube)).ok,false);
});
