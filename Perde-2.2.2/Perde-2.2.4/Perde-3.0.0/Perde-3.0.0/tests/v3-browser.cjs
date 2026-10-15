'use strict';
// Isolated real browser, synthetic MP3, intercepted YouTube fixture; no live website/service.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {chromium}=require('C:/Users/Akyüz/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..'),extension=path.join(root,'eklenti'),profile=fs.mkdtempSync(path.join(root,'.integration-v3-'));
const ffmpeg=process.env.PERDE_TEST_FFMPEG||path.resolve(root,'../../Perde-2.2.2/vocal-service/.venv/Lib/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe');
const generated=spawnSync(ffmpeg,['-v','error','-f','lavfi','-i','sine=frequency=220:duration=3','-ac','2','-codec:a','libmp3lame','-f','mp3','pipe:1'],{windowsHide:true});
assert.equal(generated.status,0,generated.stderr?.toString());const mp3=generated.stdout;
let context,worker;
async function launch(){
  context=await chromium.launchPersistentContext(profile,{executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true,timeout:15000,ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--disable-background-networking','--disable-component-update','--no-first-run','--no-default-browser-check','--autoplay-policy=no-user-gesture-required','--host-resolver-rules=MAP * ~NOTFOUND']});
  await context.route(/^https?:\/\//,route=>route.abort());worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:10000});
}
async function popup(){const p=await context.newPage();await p.setViewportSize({width:410,height:600});await p.goto(new URL('popup.html',worker.url()).href);await p.locator('#tab-music').click();return p;}
async function nodeCall(cdp,id,fn){
  const {nodes}=await cdp.send('DOM.getFlattenedDocument',{depth:-1,pierce:true});const node=nodes.find(n=>n.attributes?.some((v,i)=>v==='id'&&n.attributes[i+1]===id));assert(node,`Missing ${id}`);
  const {object}=await cdp.send('DOM.resolveNode',{nodeId:node.nodeId});const result=await cdp.send('Runtime.callFunctionOn',{objectId:object.objectId,functionDeclaration:fn,returnByValue:true});assert(!result.exceptionDetails,JSON.stringify(result.exceptionDetails));return result.result.value;
}
async function main(){
  await launch();let p=await popup();const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.locator('#music-files').setInputFiles([{name:'Deneme MP3.mp3',mimeType:'audio/mpeg',buffer:mp3},{name:'İkinci parça.mp3',mimeType:'audio/mpeg',buffer:Buffer.concat([mp3,Buffer.from([0])])}]);
  await p.waitForFunction(()=>document.querySelector('#music-status').textContent.includes('2 MP3 kaydedildi'));
  assert.equal(await p.locator('#music-list li').count(),2);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await p.locator('#music-files').setInputFiles({name:'Deneme MP3.mp3',mimeType:'audio/mpeg',buffer:mp3});await p.waitForFunction(()=>document.querySelector('#music-status').textContent.includes('1 MP3 kaydedildi'));assert.equal(await p.locator('#music-list li').count(),2,'Duplicate content must use one slot');
  const download= p.waitForEvent('download');await p.locator('#music-list button').filter({hasText:'İndir'}).first().click();assert.match((await download).suggestedFilename(),/\.mp3$/);
  await p.locator('#music-list button').filter({hasText:'Dinle'}).first().click();assert.equal(await p.locator('audio').evaluate(a=>a.paused),false);
  await p.screenshot({path:path.join(profile,'mp3-library.png')});
  assert.deepEqual(errors,[]);await context.close();context=null;
  await launch();p=await popup();await p.locator('#music-list li').first().waitFor();assert.equal(await p.locator('#music-list li').count(),2,'MP3s persist after browser restart');
  const tracks=await worker.evaluate(()=>PerdeMusicLibrary.list());
  await worker.evaluate(async({data,id})=>{
    await chrome.storage.local.set({settings:{...PerdeSettings.defaults,enabled:false},backgroundTrackId:id});
    await PerdeVocalLibrary.put({videoId:'PerdeTest01',title:'V3 test',totalSeconds:3,blob:new Blob([new Uint8Array(data)],{type:'audio/mpeg'})});
  },{data:Array.from(mp3),id:tracks[0].id});
  const page=await context.newPage();await page.setViewportSize({width:1200,height:800});const cdp=await context.newCDPSession(page);await cdp.send('DOM.enable');
  const url='https://www.youtube.com/watch?v=PerdeTest01';
  await page.route(url,route=>route.fulfill({contentType:'text/html',body:`<!doctype html><style>body{background:#1b262a}video{width:760px;height:428px;margin:60px 0}</style><div class="html5-video-player"><video class="html5-main-video" src="data:audio/mpeg;base64,${mp3.toString('base64')}"></video></div>`}));
  await page.goto(url);await page.waitForFunction(()=>document.querySelector('#perde-vocal-panel')?.getAttribute('data-state')==='ready');
  await nodeCall(cdp,'panel-details','function(){this.open=true;}');
  assert.equal(await nodeCall(cdp,'background-tracks','function(){return this.querySelectorAll("input").length;}'),2);
  await nodeCall(cdp,'background-tracks','function(){this.querySelectorAll("input")[1].click();}');
  await p.waitForFunction(async id=>(await chrome.storage.local.get('backgroundTrackId')).backgroundTrackId===id,tracks[1].id);
  assert.equal(await nodeCall(cdp,'background-tracks','function(){return this.querySelectorAll("input:checked").length;}'),1);
  const before=await page.locator('#perde-vocal-panel').boundingBox();
  const grip=await nodeCall(cdp,'drag-panel','function(){const r=this.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};}');
  await page.mouse.move(grip.x,grip.y);await page.mouse.down();await page.mouse.move(grip.x-250,grip.y+100,{steps:8});await page.mouse.up();
  const moved=await page.locator('#perde-vocal-panel').boundingBox();assert(Math.abs(moved.x-before.x+250)<3);assert(Math.abs(moved.y-before.y-100)<3);
  await page.reload();await page.waitForFunction(()=>document.querySelector('#perde-vocal-panel')?.getAttribute('data-state')==='ready');
  const restored=await page.locator('#perde-vocal-panel').boundingBox();assert(Math.abs(restored.x-moved.x)<3);assert(Math.abs(restored.y-moved.y)<3);
  await nodeCall(cdp,'panel-details','function(){this.open=true;}');await page.locator('#perde-vocal-panel').screenshot({path:path.join(profile,'vocal-panel.png')});
  await nodeCall(cdp,'reset-panel','function(){this.click();}');await p.waitForFunction(async()=>!(await chrome.storage.local.get('vocalPanelPosition')).vocalPanelPosition);
  await page.close();
  // Real decoded audio: invoke the same offscreen engine in an extension test page.
  const audioPage=await context.newPage();await audioPage.goto(new URL('offscreen.html',worker.url()).href);
  const playback=await audioPage.evaluate(async({data,id})=>{
    const NativeAudio=Audio;globalThis.testTracks=[];globalThis.Audio=function(...args){const a=new NativeAudio(...args);testTracks.push(a);return a;};
    vocalAudio=new NativeAudio(URL.createObjectURL(new Blob([new Uint8Array(data)],{type:'audio/mpeg'})));
    await new Promise(resolve=>vocalAudio.addEventListener('loadedmetadata',resolve,{once:true}));
    await audioCommand({type:'audio-sync',musicId:id,musicVolume:.2,time:.5,rate:1.5,volume:.8,playing:true});
    await new Promise(resolve=>setTimeout(resolve,200));
    const music=testTracks[0],running={paused:music.paused,loop:music.loop,volume:music.volume,rate:music.playbackRate};
    await audioCommand({type:'audio-sync',musicId:id,musicVolume:.2,time:1,rate:1,volume:1,playing:false});const stopped=music.paused;
    await audioCommand({type:'audio-sync',musicId:id,musicVolume:.2,time:1,rate:1,volume:1,playing:true});
    await new Promise(resolve=>setTimeout(resolve,1600));const expired=music.paused;
    releaseAudio();return {running,stopped,expired};
  },{data:Array.from(mp3),id:tracks[1].id});
  assert.equal(playback.running.paused,false);assert.equal(playback.running.loop,true);assert(Math.abs(playback.running.volume-.16)<.001);assert.equal(playback.running.rate,1.5);assert.equal(playback.stopped,true);assert.equal(playback.expired,true);await audioPage.close();
  await p.locator('#music-list button').filter({hasText:'Sil'}).nth(1).click();await p.waitForFunction(()=>document.querySelectorAll('#music-list li').length===1);
  assert.equal((await worker.evaluate(()=>chrome.storage.local.get('backgroundTrackId'))).backgroundTrackId,null);
  const limits=await worker.evaluate(async()=>{
    const attempts=await Promise.allSettled(Array.from({length:12},(_,i)=>PerdeMusicLibrary.put({title:`Limit ${i}`,totalSeconds:1,blob:new Blob([String(i)],{type:'audio/mpeg'})})));
    return {count:(await PerdeMusicLibrary.list()).length,rejected:attempts.filter(a=>a.status==='rejected').length};
  });assert.equal(limits.count,10);assert.equal(limits.rejected,3);
  console.log('PASS: V3 MP3 batch import/dedup/export/preview, browser restart, single checkbox selection, pointer dragging/reload/reset, real audio mix/pause/watchdog, selected deletion, concurrent 10-track limit.');
  console.log(`Screenshots: ${profile}`);
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;}).finally(async()=>{if(context)await context.close().catch(()=>{});});
