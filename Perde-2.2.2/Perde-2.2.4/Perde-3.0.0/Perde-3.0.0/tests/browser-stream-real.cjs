// Real end-to-end check of progressive vocal playback: the real local service
// downloads and separates a real YouTube video while the extension plays the
// first part. Only the YouTube page is a fixture (a silent video of the same
// length), so timing and sync are measured against a known clock.
// Usage: node tests/browser-stream-real.cjs [videoId] [seconds]
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PERDE_PLAYWRIGHT||'C:/Users/Akyüz/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const python=process.env.PERDE_PYTHON||path.resolve(__dirname,'../vocal-service/.venv/Scripts/python.exe');
const [videoId='dQw4w9WgXcQ',duration='213']=process.argv.slice(2);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label,seconds=60){const end=Date.now()+seconds*1000;while(Date.now()<end){if(await fn())return;await sleep(250);}throw Error('Timed out: '+label);}
function silence(seconds){const rate=8000,b=Buffer.alloc(44+rate*seconds*2);b.write('RIFF',0);b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);return b;}
(async()=>{
 const scratch=fs.mkdtempSync(path.join(__dirname,'.integration-'));let ctx,service;
 const started=Date.now(),stamp=()=>((Date.now()-started)/1000).toFixed(1)+'s';
 try{
  // fs.cpSync crashes Node 22 on paths with non-ASCII letters (e.g. Masaüstü).
  const extension=path.join(scratch,'extension');const copyTree=(from,to)=>{fs.mkdirSync(to,{recursive:true});for(const e of fs.readdirSync(from,{withFileTypes:true})){const a=path.join(from,e.name),b=path.join(to,e.name);if(e.isDirectory())copyTree(a,b);else if(e.isFile())fs.writeFileSync(b,fs.readFileSync(a));}};copyTree(path.resolve(__dirname,'../eklenti'),extension);
  const manifest=JSON.parse(fs.readFileSync(path.join(extension,'manifest.json'),'utf8'));manifest.host_permissions.push('http://127.0.0.1/*');fs.writeFileSync(path.join(extension,'manifest.json'),JSON.stringify(manifest));
  ctx=await chromium.launchPersistentContext(path.join(scratch,'profile'),{executablePath:process.env.PERDE_BROWSER||'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--autoplay-policy=no-user-gesture-required']});
  const sw=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');
  const extensionId=new URL(sw.url()).host;
  service=spawn(python,[path.resolve(__dirname,'../vocal-service/server.py'),'--extension-id',extensionId],{env:{...process.env,PYTHONUTF8:'1'},stdio:['ignore','pipe','pipe']});
  const token=await new Promise((resolve,reject)=>{let text='';service.stdout.on('data',d=>{text+=d;const m=/yapıştır:\r?\n(\S+)/.exec(text);if(m)resolve(m[1]);});service.on('exit',code=>reject(Error('service exited '+code)));});
  console.log(stamp(),'service ready');
  await sw.evaluate(async token=>{await chrome.storage.local.set({settings:{enabled:false,vocalEnabled:true,maxMinutes:5,muteAds:true}});await chrome.storage.session.set({vocalToken:token});},token);
  await ctx.route('https://www.youtube.com/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Fixture - YouTube</title><div id="movie_player" class="html5-video-player"><video class="html5-main-video" controls></video></div>'}));
  const page=await ctx.newPage();await page.goto('https://www.youtube.com/watch?v='+videoId);
  await page.evaluate(encoded=>{const data=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));document.querySelector('video').src=URL.createObjectURL(new Blob([data],{type:'audio/wav'}));},silence(+duration).toString('base64'));
  await page.waitForFunction(()=>document.querySelector('video').duration>0);
  await page.waitForSelector('#perde-vocal-panel');
  const cdp=await ctx.newCDPSession(page);
  async function node(id){const {root}=await cdp.send('DOM.getDocument',{depth:-1,pierce:true});const find=n=>{const a=n.attributes||[];for(let i=0;i<a.length;i+=2)if(a[i]==='id'&&a[i+1]===id)return n;for(const c of [...n.children||[],...n.shadowRoots||[]]){const r=find(c);if(r)return r;}return null;};return find(root);}
  async function click(id){const {object}=await cdp.send('DOM.resolveNode',{nodeId:(await node(id)).nodeId});await cdp.send('Runtime.callFunctionOn',{objectId:object.objectId,functionDeclaration:'function(){this.click()}',userGesture:true});}
  async function text(id){const {object}=await cdp.send('DOM.resolveNode',{nodeId:(await node(id)).nodeId});return (await cdp.send('Runtime.callFunctionOn',{objectId:object.objectId,functionDeclaration:'function(){return this.textContent}',returnByValue:true})).result.value;}
  const browserCdp=await ctx.browser().newBrowserCDPSession();let sessionId=null,sequence=0;
  async function offscreen(expression){
   if(!sessionId){const {targetInfos}=await browserCdp.send('Target.getTargets');const t=targetInfos.find(t=>t.url.endsWith('/offscreen.html'));if(!t)return null;sessionId=(await browserCdp.send('Target.attachToTarget',{targetId:t.targetId,flatten:false})).sessionId;}
   const id=++sequence;
   return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('offscreen timeout')),3000);
    function receive(e){if(e.sessionId!==sessionId)return;const m=JSON.parse(e.message);if(m.id!==id)return;clearTimeout(timer);browserCdp.off('Target.receivedMessageFromTarget',receive);resolve(m.result?.result?.value);}
    browserCdp.on('Target.receivedMessageFromTarget',receive);
    browserCdp.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id,method:'Runtime.evaluate',params:{expression,returnByValue:true}})}).catch(reject);});
  }
  const audioState=()=>offscreen('vocalAudio?({time:vocalAudio.currentTime,paused:vocalAudio.paused,ready:vocalAudio.readyState,until:transfer?.index?.seconds??null,state:transfer?.state,streaming:!!vocalStream}):null');
  const videoState=()=>page.evaluate(()=>{const v=document.querySelector('video');return {time:v.currentTime,paused:v.paused,muted:v.muted};});
  await click('start');const clicked=Date.now();console.log(stamp(),'start clicked');
  await until(async()=>!((await node('play')).attributes||[]).includes('hidden'),'first part playable',300);
  const firstPart=(Date.now()-clicked)/1000;console.log(stamp(),`first part playable after ${firstPart.toFixed(1)} s:`,await text('status'));
  const a0=await audioState();assert.equal(a0.state,'loading','playback must begin before the whole vocal exists');assert.ok(a0.streaming,'Media Source streaming');
  await click('play');
  // Sync while separation continues.
  const drifts=[];
  for(let i=0;i<20;i++){await sleep(500);const [v,a]=await Promise.all([videoState(),audioState()]);if(!v.paused&&!a.paused)drifts.push(Math.abs(v.time-a.time));}
  assert.ok(drifts.length>=10,'vocal played with the video');
  const median=drifts.sort((x,y)=>x-y)[drifts.length>>1];console.log(stamp(),`playing: median |video-vocal| ${(median*1000).toFixed(0)} ms over ${drifts.length} samples`);
  assert.ok(median<.15);
  // Jump to just before the end of the separated part: the video waits, then continues.
  const before=await audioState();
  if(before.state==='loading'&&before.until<+duration-15){
   await page.evaluate(t=>{document.querySelector('video').currentTime=t;},before.until-1);
   await until(async()=>(await videoState()).paused,'video waits at the separated edge',20);
   console.log(stamp(),'waiting at',before.until.toFixed(1),'s:',await text('status'));
   await until(async()=>!(await videoState()).paused,'video resumes once enough is ready',120);
   const [v,a]=await Promise.all([videoState(),audioState()]);console.log(stamp(),`resumed at video ${v.time.toFixed(1)} s, vocal ${a.time.toFixed(1)} s, prepared until ${a.until.toFixed(1)} s`);
   await sleep(1500);const [v2,a2]=await Promise.all([videoState(),audioState()]);assert.ok(!a2.paused&&Math.abs(v2.time-a2.time)<.25,'vocal follows after waiting');
  }else console.log(stamp(),'separation already finished; edge wait not exercised');
  // Seek back into a part that left the Media Source window.
  await page.evaluate(()=>{document.querySelector('video').currentTime=2;});
  await until(async()=>{const [v,a]=await Promise.all([videoState(),audioState()]);return !a.paused&&a.time>2&&a.time<6&&Math.abs(v.time-a.time)<.25;},'seek back plays',20);
  console.log(stamp(),'seek back ok');
  await until(async()=>(await audioState()).state==='ready','whole vocal transferred',600);
  console.log(stamp(),`whole vocal ready after ${((Date.now()-clicked)/1000).toFixed(1)} s`);
  await until(async()=>/kayıtlı/.test(await text('saved-note')),'saved to browser library',30);
  await click('cancel');
  await until(async()=>await audioState()===null,'audio release',20);
  console.log('PASS: progressive playback from the real service');
 }finally{
  if(ctx)await ctx.close().catch(()=>{});if(service)service.kill();
  if(path.dirname(scratch)!==__dirname||!path.basename(scratch).startsWith('.integration-'))throw Error('Unsafe temporary path');
  for(let i=0;i<5;i++){try{fs.rmSync(scratch,{recursive:true,force:true});break;}catch{await sleep(500);}}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
