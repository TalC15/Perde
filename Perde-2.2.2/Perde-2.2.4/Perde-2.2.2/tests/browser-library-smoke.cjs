'use strict';
// Uses only extension pages and an isolated profile; no HTTP server or user data.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('C:/Users/Akyüz/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..'),extension=path.join(root,'eklenti');
const profile=fs.mkdtempSync(path.join(root,'.integration-library-'));
const screenshots=process.argv.includes('--screenshots')?path.join(root,'.integration-ui-preview'):null;
if(screenshots)fs.mkdirSync(screenshots,{recursive:true});
const videoId='PerdeTest01',title='Perde tarayıcı arşivi testi';
// A valid short, silent PCM WAV provides an actual browser-readable audio Blob.
const wav=Buffer.alloc(44+8820);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(44100,24);wav.writeUInt32LE(88200,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(8820,40);
let context;
async function launch(){
  context=await chromium.launchPersistentContext(profile,{executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true,timeout:15000,ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--disable-background-networking','--disable-component-update','--no-first-run','--no-default-browser-check','--host-resolver-rules=MAP * ~NOTFOUND']});
  await context.route(/^https?:\/\//,route=>route.abort());
  return context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:10000});
}
async function verify(worker){
  const actual=await worker.evaluate(async id=>{
    const listing=await PerdeVocalLibrary.list(),record=await PerdeVocalLibrary.get(id);
    return {listing,bytes:record?Array.from(new Uint8Array(await record.blob.arrayBuffer())):null};
  },videoId);
  assert.equal(actual.listing.length,1);assert.equal(actual.listing[0].title,title);assert.equal(actual.listing[0].bytes,wav.length);assert.deepEqual(Buffer.from(actual.bytes),wav);
  const popup=await context.newPage();await popup.setViewportSize({width:410,height:600});await popup.goto(new URL('popup.html',worker.url()).href);
  await popup.waitForFunction(()=>!document.getElementById('enabled').disabled&&document.getElementById('status').textContent!=='Durum kontrol ediliyor…');
  if(screenshots)await popup.screenshot({path:path.join(screenshots,'protection.png')});
  await popup.locator('#tab-vocals').click();
  await popup.waitForTimeout(180);
  await popup.locator('#vocal-library-list strong').filter({hasText:title}).waitFor({timeout:10000});assert.match(await popup.locator('#library-summary').innerText(),/1 kayıt/);
  if(screenshots)await popup.screenshot({path:path.join(screenshots,'vocals.png')});
  await popup.locator('#tab-settings').click();
  await popup.waitForTimeout(180);
  assert.equal(await popup.locator('#panel-settings').isVisible(),true);
  assert.equal(await popup.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Popup must not scroll horizontally');
  if(screenshots)await popup.screenshot({path:path.join(screenshots,'settings.png')});
  await popup.close();
}
async function verifyRefresh(worker){
  await worker.evaluate(async()=>{
    await chrome.storage.local.set({settings:{...PerdeSettings.defaults,enabled:false}});
    await chrome.runtime.sendMessage({target:'perde-audio',type:'audio-release'});
    globalThis.__librarySmokeRequests=[];
    const originalFetch=globalThis.fetch;
    globalThis.fetch=(url,...args)=>{if(/^https?:/.test(String(url))){__librarySmokeRequests.push(String(url));throw Error('Network is disabled during the saved-vocal test.');}return originalFetch(url,...args);};
  });
  const page=await context.newPage();
  const dom=await context.newCDPSession(page);await dom.send('DOM.enable');
  await page.route(`https://www.youtube.com/watch?v=${videoId}`,route=>route.fulfill({status:200,contentType:'text/html',body:`<!doctype html><html><head><title>Perde offline fixture</title></head><body><div class="html5-video-player"><video class="html5-main-video" preload="auto" src="data:audio/wav;base64,${wav.toString('base64')}"></video></div></body></html>`}));
  async function waitForSaved(previousClient){
    const deadline=Date.now()+15000;let job;
    while(Date.now()<deadline){job=await worker.evaluate(async()=>(await chrome.storage.session.get('vocalJob')).vocalJob);if(job?.source==='browser'&&job.loaded&&job.clientId!==previousClient)return job;await new Promise(resolve=>setTimeout(resolve,100));}
    throw Error(`Saved vocal did not activate: ${JSON.stringify(job)}`);
  }
  async function assertPanel(){
    await page.waitForFunction(()=>{const video=document.querySelector('video');return video?.muted&&video.paused;},{},{timeout:10000});
    // DevTools can inspect the extension's closed shadow root without altering it.
    const deadline=Date.now()+10000;
    while(Date.now()<deadline){
      const {nodes}=await dom.send('DOM.getFlattenedDocument',{depth:-1,pierce:true});
      const buttons=nodes.filter(node=>node.nodeName==='BUTTON').map(node=>{const a={};for(let i=0;i<(node.attributes?.length||0);i+=2)a[node.attributes[i]]=node.attributes[i+1];return a;});
      const start=buttons.find(button=>button.id==='start'),play=buttons.find(button=>button.id==='play');
      if(start&&'hidden' in start&&play&&!('hidden' in play))return;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    throw Error('Saved vocal panel did not hide the create button and show playback.');
  }
  await page.goto(`https://www.youtube.com/watch?v=${videoId}`);const first=await waitForSaved();await assertPanel();
  await page.reload();const second=await waitForSaved(first.clientId);await assertPanel();assert.notEqual(second.clientId,first.clientId);
  if(screenshots){
    const {nodes}=await dom.send('DOM.getFlattenedDocument',{depth:-1,pierce:true});
    const details=nodes.find(node=>node.nodeName==='DETAILS'&&node.attributes?.includes('panel-details'));
    const {object}=await dom.send('DOM.resolveNode',{nodeId:details.nodeId});
    await dom.send('Runtime.callFunctionOn',{objectId:object.objectId,functionDeclaration:'function(){this.open=true;}'});
    await page.locator('#perde-vocal-panel').screenshot({path:path.join(screenshots,'audio-panel.png')});
  }
  const status=await worker.evaluate(async()=>({token:(await chrome.storage.session.get('vocalToken')).vocalToken,requests:globalThis.__librarySmokeRequests}));assert.equal(status.token,undefined);assert.deepEqual(status.requests,[]);
  await page.close();
}
async function main(){
  let worker=await launch();
  await worker.evaluate(async ({videoId,title,data})=>PerdeVocalLibrary.put({videoId,title,totalSeconds:.1,blob:new Blob([new Uint8Array(data)],{type:'audio/wav'})}),{videoId,title,data:Array.from(wav)});
  await verify(worker);
  await context.close();context=null;
  worker=await launch();await verify(worker);
  await worker.evaluate(async()=>chrome.offscreen.createDocument({url:'offscreen.html',reasons:['BLOBS','AUDIO_PLAYBACK'],justification:'Test kayıtlı vokalin yerel arşivden açıldığını doğrular.'}));
  let loaded;
  for(let attempt=0;attempt<30;attempt++){
    loaded=await worker.evaluate(id=>chrome.runtime.sendMessage({target:'perde-audio',type:'audio-load-saved',videoId:id}),videoId);
    if(loaded?.state==='ready'||loaded?.state==='error')break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.equal(loaded?.state,'ready',JSON.stringify(loaded));assert.equal(loaded.saved,true);
  await verifyRefresh(worker);
  await worker.evaluate(async id=>{await chrome.runtime.sendMessage({target:'perde-audio',type:'audio-release'});await PerdeVocalLibrary.remove(id);},videoId);
  assert.equal((await worker.evaluate(()=>PerdeVocalLibrary.list())).length,0);
  console.log('PASS: real Brave IndexedDB restart persistence, popup library, offline automatic activation and page refresh, offscreen saved audio, deletion.');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(async()=>{if(context)await context.close().catch(()=>{});});
