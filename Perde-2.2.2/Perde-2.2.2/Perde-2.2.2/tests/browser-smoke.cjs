const path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PERDE_PLAYWRIGHT||'C:/Users/Akyüz/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const extension=path.resolve(__dirname,'../eklenti');
 const ctx=await chromium.launchPersistentContext(path.resolve(__dirname,'.browser-profile'),{executablePath:process.env.PERDE_BROWSER||'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true,viewport:{width:430,height:800},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 try{
  const sw=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker',{timeout:20000});
  const base=sw.url().replace('background.js','');
  await sw.evaluate(()=>chrome.storage.local.set({settings:{enabled:true,profile:'balanced'}}));
  const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'popup.html');
  await page.getByRole('button',{name:'Model testi',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('save').textContent!=='Yerel modeller kontrol ediliyor…',{},{timeout:45000});
  const status=await page.locator('#save').textContent();assert.match(status,/İnsan \+ yüz modelleri hazır/);
  await page.locator('#profile').selectOption('high');
  await page.waitForFunction(async()=> (await chrome.storage.local.get('settings')).settings.profile==='high');
  const result=await page.evaluate(async()=>{const c=document.createElement('canvas');c.width=320;c.height=180;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,320,180);return chrome.runtime.sendMessage({type:'detect',image:c.toDataURL('image/jpeg'),confidence:.25,detail:'normal'});});
  assert.equal(result.ok,true,JSON.stringify(result));assert.deepEqual(result.boxes,[]);
  await page.screenshot({path:path.resolve(__dirname,'popup.png'),fullPage:true});
  await page.goto(base+'test.html');
  await page.evaluate(()=>{const c=document.createElement('canvas');c.width=320;c.height=180;c.getContext('2d').fillRect(0,0,320,180);const image=document.getElementById('photo');image.hidden=false;image.src=c.toDataURL('image/png');});
  await page.waitForFunction(()=>document.getElementById('photo').naturalWidth===320&&!document.getElementById('photo').hasAttribute('data-perde-pending'),{},{timeout:30000});
  await page.evaluate(()=>{const img=document.getElementById('photo');img.src='https://unpermitted.invalid/photo.png';});
  await page.waitForFunction(()=>document.getElementById('photo').hasAttribute('data-perde-pending'));
  await page.evaluate(async()=>{const {settings}=await chrome.storage.local.get('settings');await chrome.storage.local.set({settings:{...settings,enabled:false}});});
  await page.waitForFunction(()=>!document.getElementById('photo').hasAttribute('data-perde-pending'));
  assert.deepEqual(errors,[]);
  console.log('PASS:',status,'; real blank-image inference; profile persistence; image source change stays covered; disable clears coverage.');
 }finally{await ctx.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
