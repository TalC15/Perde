'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
async function player(get){
  const audios=[],revoked=[],timers=[];let clock=0;
  class Audio{constructor(){this.currentTime=0;this.duration=10;this.paused=true;this.events={};audios.push(this);}addEventListener(name,fn){this.events[name]=fn;}pause(){this.paused=true;}async play(){this.paused=false;}removeAttribute(){}load(){}}
  const context=vm.createContext({Audio,PerdeMusicLibrary:{get:get|| (async()=>({blob:new Blob(['sound'])}))},Blob,URL:{createObjectURL:()=>`blob:${audios.length}`,revokeObjectURL:u=>revoked.push(u)},performance:{now:()=>clock},setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../eklenti/music-engine.js'),'utf8'),context);
  return {engine:context.PerdeMusicPlayer,audios,revoked,timers,advance:n=>clock+=n};
}
const state={id:'a'.repeat(64),time:27,rate:1.5,volume:.8,mix:.25,playing:true};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('Background loops at the video offset with volume/rate and follows pause, seek, and deselection',async()=>{
  const p=await player();p.engine.sync(state);await flush();const a=p.audios[0];
  assert.equal(a.loop,true);assert.equal(a.currentTime,7);assert.equal(a.playbackRate,1.5);assert.equal(a.volume,.2);assert.equal(a.paused,false);
  p.engine.sync({...state,time:62,playing:false});assert.equal(a.currentTime,2);assert.equal(a.paused,true);
  p.engine.sync({...state,time:63,volume:0});assert.equal(a.paused,false);assert.equal(a.volume,0);
  p.engine.pause();assert.equal(a.paused,true);p.engine.sync({...state,id:null});assert.equal(a.paused,true);assert.equal(p.revoked.length,1);
});
test('A late MP3 read cannot restart music after cancellation or replace a newer selection',async()=>{
  let release;const hold=new Promise(resolve=>release=resolve);const p=await player(async id=>{if(id===state.id)await hold;return {blob:new Blob(['sound'])};});
  p.engine.sync(state);p.engine.sync({...state,id:'b'.repeat(64)});await flush();assert.equal(p.audios.length,1);
  p.engine.clear();release();await flush();assert.equal(p.audios.length,1);assert.equal(p.audios[0].paused,true);
});
test('Metadata arriving after the playback lease expires cannot start background audio',async()=>{
  let release;const p=await player(async()=>{await new Promise(resolve=>release=resolve);return {blob:new Blob(['sound'])};});
  p.engine.sync(state);p.advance(1500);release();await flush();assert.equal(p.audios[0].paused,true);
});
test('An unavailable MP3 reports its own warning without failing vocal playback',async()=>{
  const p=await player(async()=>null);p.engine.sync(state);await flush();assert.match(p.engine.sync(state).musicWarning,/silinmiş/);assert.equal(p.audios.length,0);
});

test('Vocal end cannot restart either audio when the video timeline extends beyond it',async()=>{
  const syncs=[];let plays=0;
  const sample={duration:2,paused:true,ended:true,currentTime:2,pause(){this.paused=true;},async play(){plays++;this.paused=false;}};
  const context=vm.createContext({sample,PerdeMusicPlayer:{sync:s=>syncs.push(s)},chrome:{runtime:{onMessage:{addListener(){}}}},setInterval(){},performance:{now:()=>100}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../eklenti/audio-engine.js'),'utf8'),context);
  await vm.runInContext("vocalAudio=sample;audioCommand({type:'audio-sync',time:2.1,rate:1,volume:1,playing:true,musicId:'a'.repeat(64)})",context);
  assert.equal(plays,0);assert.equal(syncs[0].playing,false);
});
