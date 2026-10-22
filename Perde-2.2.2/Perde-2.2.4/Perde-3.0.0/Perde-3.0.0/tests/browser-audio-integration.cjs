// End-to-end transport/playback test. Only the download/separation service is a fixture.
// Production extension scripts are copied unchanged; the fixture adds localhost permission.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PERDE_PLAYWRIGHT||'C:/Users/Akyüz/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// Headless offscreen documents can take 10+ s to load the vision scripts.
async function until(fn,label){for(let i=0;i<500;i++){if(await fn())return;await sleep(150);}throw Error('Timed out: '+label);}
function wave(){const rate=8000,seconds=60,b=Buffer.alloc(44+rate*seconds*2);b.write('RIFF',0);b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);return b;}
console.log('Integration: starting isolated fixture');
(async()=>{
 const scratch=fs.mkdtempSync(path.join(__dirname,'.integration-'));let ctx,server;
 try{
  const extension=path.join(scratch,'extension');function copyTree(source,target){fs.mkdirSync(target,{recursive:true});for(const entry of fs.readdirSync(source,{withFileTypes:true})){const src=path.join(source,entry.name),dst=path.join(target,entry.name);if(entry.isDirectory())copyTree(src,dst);else if(entry.isFile())fs.writeFileSync(dst,fs.readFileSync(src));}}copyTree(path.resolve(__dirname,'../eklenti'),extension);
  console.log('Integration: extension copied');
  const manifest=JSON.parse(fs.readFileSync(path.join(extension,'manifest.json'),'utf8'));manifest.host_permissions.push('http://127.0.0.1/*');fs.writeFileSync(path.join(extension,'manifest.json'),JSON.stringify(manifest));
  const token='fixture-session-key-abcdefghijklmnopqrstuvwxyz',job='a'.repeat(32),audio=wave(),requests=[];
  server=http.createServer((req,res)=>{
   requests.push({path:req.url,method:req.method,authorized:req.headers.authorization==='Bearer '+token});
   res.setHeader('Cache-Control','no-store');res.setHeader('Connection','close');
   if(req.headers.authorization!=='Bearer '+token){res.writeHead(401,{'Content-Type':'application/json'});res.end('{"error":"unauthorized"}');return;}
   if(req.url==='/jobs/'+job+'/audio'){
    const range=/^bytes=(\d+)-(\d+)$/.exec(req.headers.range||'');assert.ok(range);
    const start=Number(range[1]),end=Math.min(Number(range[2]),audio.length-1);
    res.writeHead(206,{'Content-Type':'audio/wav','Content-Length':end-start+1,'Content-Range':`bytes ${start}-${end}/${audio.length}`});res.end(audio.subarray(start,end+1));return;
   }
   res.setHeader('Content-Type','application/json');
   if(req.url==='/jobs'&&req.method==='POST'){res.end(JSON.stringify({id:job,state:'downloading'}));return;}
   if(req.url==='/jobs/'+job){res.end(JSON.stringify(req.method==='DELETE'?{ok:true}:{id:job,state:'ready'}));return;}
   if(req.url==='/health'){res.end(JSON.stringify({ok:true,maxMinutes:40}));return;}
   res.writeHead(404);res.end('{"error":"missing"}');
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(8765,'127.0.0.1',resolve);});
  console.log('Integration: localhost fixture listening');
  ctx=await chromium.launchPersistentContext(path.join(scratch,'profile'),{executablePath:process.env.PERDE_BROWSER||'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--autoplay-policy=no-user-gesture-required']});
  console.log('Integration: test browser ready');
  const sw=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');
  await sw.evaluate(async token=>{await chrome.storage.local.set({settings:{enabled:false,vocalEnabled:true,maxMinutes:40,muteAds:true}});await chrome.storage.session.set({vocalToken:token});},token);
  await ctx.route('https://www.youtube.com/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><div id="movie_player" class="html5-video-player"><video class="html5-main-video" controls></video></div>'}));
  const page=await ctx.newPage();await page.goto('https://www.youtube.com/watch?v=abcdefghijk');
  await page.evaluate(encoded=>{const data=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));document.querySelector('video').src=URL.createObjectURL(new Blob([data],{type:'audio/wav'}));},audio.toString('base64'));
  await page.waitForFunction(()=>document.querySelector('video').duration===60);
  await page.waitForSelector('#perde-vocal-panel');
  const cdp=await ctx.newCDPSession(page);
  async function nodeById(id){
   const {root}=await cdp.send('DOM.getDocument',{depth:-1,pierce:true});
   function find(n){const attrs=n.attributes||[];for(let i=0;i<attrs.length;i+=2)if(attrs[i]==='id'&&attrs[i+1]===id)return n;for(const child of [...n.children||[],...n.shadowRoots||[]]){const result=find(child);if(result)return result;}return null;}
   const node=find(root);if(!node)throw Error('Missing control: '+id);return node;
  }
  async function click(id){const node=await nodeById(id);const {object}=await cdp.send('DOM.resolveNode',{nodeId:node.nodeId});await cdp.send('Runtime.callFunctionOn',{objectId:object.objectId,functionDeclaration:'function(){this.click()}',userGesture:true});}
  await click('start');
  await until(()=>requests.some(r=>r.path.endsWith('/audio')),'audio fetch');
  await until(async()=>{const job=(await sw.evaluate(()=>chrome.storage.session.get('vocalJob'))).vocalJob;return job?.loaded;},'loaded job');
  const browserCdp=await ctx.browser().newBrowserCDPSession();
  const {targetInfos}=await browserCdp.send('Target.getTargets');const target=targetInfos.find(t=>t.url.endsWith('/offscreen.html'));
  assert.ok(target,'offscreen audio document');
  const {sessionId}=await browserCdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:false});let sequence=0;
  async function readAudio(){
   const id=++sequence;
   return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{browserCdp.off('Target.receivedMessageFromTarget',receive);reject(Error('No audio state'));},20000);
    function receive(event){if(event.sessionId!==sessionId)return;const msg=JSON.parse(event.message);if(msg.id!==id)return;clearTimeout(timer);browserCdp.off('Target.receivedMessageFromTarget',receive);resolve(msg.result?.result?.value);}
    browserCdp.on('Target.receivedMessageFromTarget',receive);
    browserCdp.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id,method:'Runtime.evaluate',params:{expression:'vocalAudio ? ({time:vocalAudio.currentTime,paused:vocalAudio.paused,rate:vocalAudio.playbackRate,ready:vocalAudio.readyState}) : null',returnByValue:true}})}).catch(reject);
   });
  }
  await until(async()=>{const node=await nodeById('play');return !(node.attributes||[]).includes('hidden');},'play button');
  await click('play');
  await until(async()=>{const a=await readAudio();return a&&!a.paused&&a.time>0;},'real vocal playback');
  await page.evaluate(()=>{const v=document.querySelector('video');v.currentTime=40;v.playbackRate=1.5;});
  await until(async()=>{const a=await readAudio();return a?.time>=40&&a.rate===1.5;},'real seek and rate');
  await page.evaluate(()=>document.getElementById('movie_player').classList.add('ad-showing'));
  await until(async()=>(await readAudio())?.paused,'ad stops actual vocal');
  await page.evaluate(()=>document.getElementById('movie_player').classList.remove('ad-showing'));
  await until(async()=>(await readAudio())?.paused===false,'ad end resumes actual vocal');
  await click('cancel');
  await until(async()=>await readAudio()===null,'audio release');
  await until(()=>requests.some(r=>r.method==='DELETE'),'server cleanup request');
  assert.equal(await page.locator('video').evaluate(v=>v.muted),false);
  assert.ok(requests.every(r=>r.authorized));
  console.log('PASS: real extension -> authenticated local HTTP -> offscreen audio; playback, seek/rate, ads, release and deletion. Service uses synthetic fixture audio.');
 }finally{
  if(ctx)await ctx.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  if(path.dirname(scratch)!==__dirname||!path.basename(scratch).startsWith('.integration-'))throw Error('Unsafe temporary path');
  fs.rmSync(scratch,{recursive:true,force:true});
 }
})().catch(e=>{console.error(e);fs.writeFileSync(path.join(__dirname,'integration-error.txt'),String(e.stack||e));process.exitCode=1;});
