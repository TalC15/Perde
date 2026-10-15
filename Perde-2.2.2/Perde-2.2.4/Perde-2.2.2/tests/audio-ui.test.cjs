const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const settings=require('../eklenti/settings.js');
async function panel(respond,options={}){
  const nodes={},calls=[],documentEvents={},storageData={saveVocals:true};let tick,storageChanged,clock=1000;
  class Element{
    constructor(){this.hidden=false;this.checked=false;this.isConnected=true;this.listeners={};this.style={setProperty(name,value){this[name]=value;}};}
    set id(value){this._id=value;nodes[value]=this;}get id(){return this._id;}
    set innerHTML(value){for(const [,id] of value.matchAll(/id="([^"]+)"/g)){const e=new Element();e.id=id;}}
    attachShadow(){return new Element();}getElementById(id){return nodes[id];}
    setAttribute(){}removeAttribute(){}append(...children){for(const child of children)child.parentElement=this;}before(){}after(){}
    addEventListener(name,fn){this.listeners[name]=fn;}removeEventListener(name){delete this.listeners[name];}
  }
  const video=new Element();Object.assign(video,{duration:2400,paused:options.paused===true,muted:false,currentTime:0,playbackRate:1,volume:1,readyState:4});
  video.pause=()=>{video.paused=true;};video.play=async()=>{video.paused=false;};
  if(options.rect)video.getBoundingClientRect=()=>options.rect;
  const document={title:'Örnek video - YouTube',createElement:()=>new Element(),createTextNode:text=>({text}),documentElement:new Element(),querySelector:s=>s.startsWith('video')?video:null,addEventListener(name,fn){documentEvents[name]=fn;}};
  if(options.fullscreen){document.fullscreenElement=new Element();document.fullscreenElement.tagName='DIV';}
  const window={innerWidth:options.width||1280,innerHeight:options.height||720,addEventListener(){}};window.top=window;
  const chrome={runtime:{sendMessage:async m=>{calls.push(m);return await respond(m)||{ok:true};}},storage:{local:{get:async()=>({settings:settings.defaults,...storageData}),set:async values=>Object.assign(storageData,values)},onChanged:{addListener(fn){storageChanged=fn;}}}};
  const location={hostname:'www.youtube.com',href:'https://www.youtube.com/watch?v=abcdefghijk'};
  const context=vm.createContext({window,document,chrome,location,crypto:require('node:crypto').webcrypto,PerdeSettings:settings,performance:{now:()=>clock},MutationObserver:class{observe(){}},setInterval:f=>tick=f});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../eklenti/audio-content.js'),'utf8'),context);
  await Promise.resolve();
  const step=async()=>{clock+=2000;await tick();};await step();
  return {storageChanged,nodes,calls,video,step,storageData,location,documentEvents,document};
}
test('Transfer retry reuses the active session and retains video mute/pause',async()=>{
  let failed=true;const p=await panel(m=>m.type==='vocal-status'?failed?{ok:true,state:'transfer-error',error:'transfer failed',saved:true}:{ok:true,state:'ready',cached:true,saved:true}:null);
  p.nodes['save-vocal'].checked=true;await p.nodes.start.onclick();await p.step();
  assert.equal(p.nodes['retry-transfer'].hidden,false);assert.equal(p.video.muted,true);assert.equal(p.video.paused,true);
  assert.equal(p.calls.find(m=>m.type==='vocal-start').saveVocal,true);
  failed=false;p.nodes['retry-transfer'].onclick();await p.step();
  assert.equal(p.calls.filter(m=>m.type==='vocal-start').length,1);
  assert.ok(p.calls.some(m=>m.type==='vocal-status'&&m.retry));assert.equal(p.nodes.play.hidden,false);
  assert.match(p.nodes.status.textContent,/yeniden ses ayırma yapılmadı/);
});
test('Temporary status errors retry automatically without starting a second job',async()=>{
  let attempts=0;const p=await panel(m=>{if(m.type==='vocal-status'){if(++attempts<4)throw Error('network unavailable');return {ok:true,state:'ready'};}});
  await p.nodes.start.onclick();for(let i=0;i<4;i++)await p.step();
  assert.equal(p.nodes.play.hidden,false);assert.equal(p.calls.filter(m=>m.type==='vocal-start').length,1);
});
test('A ready vocal can be saved and source audio restored on cancellation',async()=>{
  const p=await panel(m=>m.type==='vocal-status'?{ok:true,state:'ready'}:m.type==='vocal-retain'?{ok:true,saved:true}:null);
  await p.nodes.start.onclick();await p.step();p.nodes['save-vocal'].checked=true;await p.nodes['save-vocal'].onchange();
  assert.ok(p.calls.some(m=>m.type==='vocal-retain'&&m.saveVocal));
  await p.nodes.cancel.onclick();await Promise.resolve();await p.step();
  assert.equal(p.video.muted,false);assert.equal(p.nodes['save-vocal'].checked,true);assert.equal(p.nodes.start.hidden,false);
});

test('Saved vocals activate automatically after each page load without creating audio',async()=>{
  const reply=m=>m.type==='vocal-lookup'?{ok:true,available:true,source:'browser'}:m.type==='vocal-status'?{ok:true,state:'ready',cached:true,saved:true}:null;
  for(let reload=0;reload<2;reload++){
    const p=await panel(reply);
    assert.equal(p.calls.filter(m=>m.type==='vocal-use-saved').length,1);
    assert.equal(p.calls.filter(m=>m.type==='vocal-start').length,0);
    assert.equal(p.nodes.start.hidden,true);assert.equal(p.nodes.play.hidden,false);
    assert.equal(p.video.paused,false);assert.equal(p.video.muted,true);
    assert.ok(p.calls.some(m=>m.type==='vocal-sync'&&m.playing));
    assert.equal(p.calls.find(m=>m.type==='vocal-use-saved').title,'Örnek video');
  }
});

test('A paused video stays paused on automatic saved vocal activation',async()=>{
  const p=await panel(m=>m.type==='vocal-lookup'?{ok:true,available:true}:m.type==='vocal-status'?{ok:true,state:'ready',cached:true,saved:true}:null,{paused:true});
  assert.equal(p.video.paused,true);assert.equal(p.nodes.play.hidden,false);
});

test('Cancel suppresses automatic reactivation and offers the saved vocal instead of create',async()=>{
  const p=await panel(m=>m.type==='vocal-lookup'?{ok:true,available:true}:m.type==='vocal-status'?{ok:true,state:'ready',cached:true,saved:true}:null);
  await p.nodes.cancel.onclick();await p.step();await p.step();
  assert.equal(p.calls.filter(m=>m.type==='vocal-use-saved').length,1);
  assert.equal(p.nodes.start.textContent,'Kayıtlı vokali kullan');assert.equal(p.nodes.start.hidden,false);
  assert.equal(p.video.muted,false);
  await p.nodes.start.onclick();await p.step();
  assert.equal(p.calls.filter(m=>m.type==='vocal-use-saved').length,2);
  assert.equal(p.calls.filter(m=>m.type==='vocal-start').length,0);
});

test('Navigation checks the new video and does not carry the previous recording over',async()=>{
  const p=await panel(m=>m.type==='vocal-lookup'?{ok:true,available:m.videoId==='abcdefghijk'}:m.type==='vocal-status'?{ok:true,state:'ready',cached:true,saved:true}:null);
  p.documentEvents['yt-navigate-start']();await p.step();
  assert.equal(p.calls.filter(m=>m.type==='vocal-use-saved').length,1);
  p.location.href='https://www.youtube.com/watch?v=zyxwvutsrqp';p.documentEvents['yt-navigate-finish']();await p.step();
  assert.ok(p.calls.some(m=>m.type==='vocal-lookup'&&m.videoId==='zyxwvutsrqp'));
  assert.equal(p.nodes.start.textContent,'Vokal oluştur');assert.equal(p.video.muted,false);
});

test('Save preference is remembered and an unavailable recording leaves original playback alone',async()=>{
  const p=await panel(m=>m.type==='vocal-lookup'?{ok:true,available:false}:null);
  assert.equal(p.video.paused,false);assert.equal(p.video.muted,false);
  assert.equal(p.nodes['save-vocal'].checked,true);
  p.nodes['save-vocal'].checked=false;await p.nodes['save-vocal'].onchange();
  assert.equal(p.storageData.saveVocals,false);
  await p.nodes.start.onclick();assert.equal(p.calls.find(m=>m.type==='vocal-start').saveVocal,false);
});

test('The vocal panel docks beside the video when there is room and stays off the toolbar',async()=>{
  const rect={left:20,top:90,right:820,bottom:540,width:800,height:450};
  const p=await panel(()=>null,{rect,width:1280,height:720});
  assert.ok(parseFloat(p.nodes['perde-vocal-panel'].style.left)>rect.right);
  assert.equal(p.nodes['perde-vocal-panel'].parentElement,p.document.documentElement);
});

test('Fullscreen vocal panel lives inside the fullscreen player and leaves bottom controls clear',async()=>{
  const rect={left:0,top:0,right:1280,bottom:720,width:1280,height:720};
  const p=await panel(()=>null,{rect,fullscreen:true});
  const host=p.nodes['perde-vocal-panel'];
  assert.equal(host.parentElement,p.document.fullscreenElement);
  assert.ok(parseFloat(host.style.top)+parseFloat(host.style['--panel-height'])<=rect.bottom-96);
});

test('Preparing and error states open the panel and provide a compact status when collapsed',async()=>{
  const p=await panel(m=>m.type==='vocal-status'?{ok:true,state:'separating',progress:45}:null);
  await p.nodes.start.onclick();await p.step();
  assert.equal(p.nodes['panel-details'].open,true);assert.equal(p.nodes['summary-state'].textContent,'%45');
});

test('Connecting the service recovers a failed start without refreshing the page',async()=>{
  let connected=false;
  const p=await panel(m=>m.type==='vocal-start'&&!connected?{ok:false,error:'Servise bağlan'}:m.type==='vocal-status'?{ok:true,state:'ready'}:null);
  await p.nodes.start.onclick();assert.match(p.nodes.status.textContent,/Servise bağlan/);
  connected=true;p.storageChanged({serviceReady:{newValue:{stamp:1,reset:false}}},'local');await p.step();
  assert.equal(p.nodes.play.hidden,false);assert.equal(p.calls.filter(m=>m.type==='vocal-start').length,2);
  assert.equal(p.video.paused,true,'Connection must not start playback without user intent');
});
test('Reconnecting a surviving job retries it while a restarted service starts a replacement',async()=>{
  for(const reset of [false,true]){
    let offline=true;const p=await panel(m=>m.type==='vocal-status'?offline?{ok:false,error:'offline'}:{ok:true,state:'ready'}:null);
    await p.nodes.start.onclick();for(let i=0;i<4;i++)await p.step();
    offline=false;p.storageChanged({serviceReady:{newValue:{stamp:1,reset}}},'local');await p.step();
    assert.equal(p.nodes.play.hidden,false);assert.equal(p.calls.filter(m=>m.type==='vocal-start').length,reset?2:1);
  }
});
test('A connection notification never starts a cancelled request',async()=>{
  const p=await panel(m=>m.type==='vocal-start'?{ok:false,error:'offline'}:null);
  await p.nodes.start.onclick();await p.nodes.cancel.onclick();
  p.storageChanged({serviceReady:{newValue:{stamp:1,reset:true}}},'local');await p.step();
  assert.equal(p.calls.filter(m=>m.type==='vocal-start').length,1);assert.equal(p.nodes.start.hidden,false);
});
