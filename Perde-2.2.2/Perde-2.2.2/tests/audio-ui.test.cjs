const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const settings=require('../eklenti/settings.js');
async function panel(respond){
  const nodes={},calls=[];let tick,clock=1000;
  class Element{
    constructor(){this.hidden=false;this.checked=false;this.isConnected=true;this.listeners={};}
    set id(value){this._id=value;nodes[value]=this;}get id(){return this._id;}
    set innerHTML(value){for(const [,id] of value.matchAll(/id="([^"]+)"/g)){const e=new Element();e.id=id;}}
    attachShadow(){return new Element();}getElementById(id){return nodes[id];}
    setAttribute(){}removeAttribute(){}append(){}before(){}after(){}
    addEventListener(name,fn){this.listeners[name]=fn;}removeEventListener(name){delete this.listeners[name];}
  }
  const video=new Element();Object.assign(video,{duration:2400,paused:false,muted:false,currentTime:0,playbackRate:1,volume:1,readyState:4});
  video.pause=()=>{video.paused=true;};video.play=async()=>{video.paused=false;};
  const document={createElement:()=>new Element(),createTextNode:text=>({text}),documentElement:new Element(),querySelector:s=>s.startsWith('video')?video:null,addEventListener(){}};
  const window={addEventListener(){}};window.top=window;
  const chrome={runtime:{sendMessage:async m=>{calls.push(m);return await respond(m)||{ok:true};}},storage:{local:{get:async()=>({settings:settings.defaults})},onChanged:{addListener(){}}}};
  const context=vm.createContext({window,document,chrome,location:{hostname:'www.youtube.com',href:'https://www.youtube.com/watch?v=abcdefghijk'},PerdeSettings:settings,performance:{now:()=>clock},MutationObserver:class{observe(){}},setInterval:f=>tick=f});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../eklenti/audio-content.js'),'utf8'),context);
  await Promise.resolve();
  const step=async()=>{clock+=2000;await tick();};await step();
  return {nodes,calls,video,step};
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
  assert.equal(p.video.muted,false);assert.equal(p.nodes['save-vocal'].checked,false);assert.equal(p.nodes.start.hidden,false);
});
