'use strict';
const path=require('node:path'),assert=require('node:assert/strict');
const runtime=process.env.PERDE_NODE_MODULES||'C:/Users/Akyüz/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium}=require(process.env.PERDE_PLAYWRIGHT||path.join(runtime,'playwright'));
const {PNG}=require(path.join(runtime,'pngjs'));
const extension=path.resolve(__dirname,'../eklenti');
const pixel=(buffer,x,y)=>{const png=PNG.sync.read(buffer);return [...png.data.subarray((y*png.width+x)*4,(y*png.width+x)*4+3)];};

(async()=>{
  const browser=await chromium.launch({executablePath:process.env.PERDE_BROWSER||'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
  try{
    const page=await browser.newPage({viewport:{width:1200,height:900},deviceScaleFactor:1});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    // Offline fixture: YouTube places its media container at 10, toolbar at 60,
    // and menus at 70. The previous global !important override lowered it to 8.
    await page.setContent(`<!doctype html><style>
      *{box-sizing:border-box}body{margin:0;background:white}
      #movie_player{position:relative;width:640px;height:360px;margin:20px;background:#36455b}
      .html5-video-container{position:relative;z-index:10;width:100%;height:100%}
      video{display:block;width:100%;height:100%;object-fit:fill}
      .ytp-chrome-bottom{position:absolute;bottom:0;left:0;width:100%;height:48px;z-index:60;background:#edb000}
      .ytp-chrome-bottom button{height:40px;margin:4px;background:#edb000;border:0}
      .ytp-chrome-top{position:absolute;top:0;z-index:60;background:#e83e8c;width:100%;height:24px}
      .ytp-settings-menu{position:absolute;right:12px;bottom:55px;z-index:70;background:#52c77c;width:180px;height:110px}
      .ytp-settings-menu button{width:100%;height:100%;background:transparent;border:0}
      #custom-player{position:relative;margin:20px;width:640px;height:300px;transform-origin:top left;transform:scale(.8);border:5px solid #111}
      #custom-video{position:relative;z-index:2}
      #custom-controls{position:absolute;z-index:2;bottom:0;left:0;width:100%;height:50px;background:#18a4c5}
      #custom-controls button{height:50px;width:100px;background:transparent;border:0}
      #control-icon{width:24px;height:24px}
      #photo-wrap{position:absolute;left:740px;top:20px;width:300px;height:240px;transform:scale(.75);transform-origin:top left;border:7px solid #333}
      #photo{width:100%;height:100%;object-fit:fill;display:block}
      #hidden-wrap{visibility:hidden;position:absolute;left:740px;top:300px;width:200px;height:120px}
      #hidden-photo{width:100%;height:100%}
      </style>
      <div id="movie_player" class="html5-video-player">
        <div class="html5-video-container"><video class="html5-main-video" muted></video></div>
        <div class="ytp-chrome-top">Video başlığı</div>
        <div class="ytp-chrome-bottom"><button id="progress">İlerleme</button><button id="volume">Ses</button><button id="settings">Ayarlar</button></div>
        <div class="ytp-settings-menu"><button id="speed">Oynatma hızı</button></div>
      </div>
      <div id="custom-player"><video id="custom-video" muted></video><div id="custom-controls" role="toolbar"><button id="custom-play"><img id="control-icon" alt="Oynat"></button></div></div>
      <div id="photo-wrap"><img id="photo" alt="Fotoğraf"></div>
      <div id="hidden-wrap"><img id="hidden-photo" alt="Gizli fotoğraf"></div>`);
    await page.evaluate(async()=>{
      window.controlClicks=[];window.detects=0;window.storageChanges=[];
      for(const button of document.querySelectorAll('button'))button.addEventListener('click',()=>controlClicks.push(button.id));
      window.chrome={runtime:{sendMessage:async message=>{if(message.type==='detect'){detects++;return {ok:true,boxes:[[.2,.1,.65,.9]],backend:'fixture',ms:1};}return {ok:true};},onMessage:{addListener(){}}},storage:{local:{get:async()=>({settings:{enabled:true,padding:0}})},onChanged:{addListener:fn=>storageChanges.push(fn)}}};
      const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;
      const context=canvas.getContext('2d');context.fillStyle='#36455b';context.fillRect(0,0,640,360);
      const source=canvas.toDataURL('image/png');for(const image of document.images)image.src=source;
      // Real HTMLVideoElements and the real browser compositing/hit-test pipeline.
      window.fixtureCanvas=canvas;window.fixtureStream=canvas.captureStream(10);
      for(const video of document.querySelectorAll('video')){video.srcObject=fixtureStream;await video.play();}
    });
    await page.addStyleTag({path:path.join(extension,'content.css')});
    for(const script of ['settings.js','tracking.js','motion.js','content.js'])await page.addScriptTag({path:path.join(extension,script)});
    await page.waitForFunction(()=>document.querySelectorAll('[data-perde-mask]').length>=3);
    const topAt=selector=>page.locator(selector).evaluate(element=>{const box=element.getBoundingClientRect();return document.elementFromPoint(box.left+box.width/2,box.top+box.height/2)?.closest('button')?.id;});
    for(const id of ['progress','volume','settings','speed','custom-play'])assert.equal(await topAt('#'+id),id);
    const shot=await page.screenshot();
    assert.deepEqual(pixel(shot,420,355),[237,176,0],'The native YouTube toolbar must paint above the video and person masks.');
    assert.deepEqual(pixel(shot,500,260),[82,199,124],'The settings menu must paint above person masks.');
    assert.deepEqual(pixel(shot,250,160),[10,16,25],'The person region must remain masked.');
    // Reproduce the reported regression against exactly the old rule.
    const oldRule=await page.addStyleTag({content:'.ytp-chrome-bottom,.ytp-chrome-top,.ytp-ad-player-overlay{z-index:8!important}'});
    assert.notEqual(await topAt('#volume'),'volume');
    assert.notDeepEqual(pixel(await page.screenshot(),420,355),[237,176,0]);
    await oldRule.evaluate(element=>element.remove());
    for(const id of ['progress','volume','settings','speed','custom-play'])await page.locator('#'+id).click();
    assert.deepEqual(await page.evaluate(()=>controlClicks),['progress','volume','settings','speed','custom-play']);
    assert.equal(await page.locator('#control-icon').getAttribute('data-perde-pending'),null);
    assert.equal(await page.locator('#custom-controls [data-perde-layer]').count(),0,'Control icons must never create masks.');
    assert.equal(await page.locator('#hidden-wrap [data-perde-layer]').isVisible(),false,'Hidden media must not leak a visible mask.');
    for(const media of ['.html5-main-video','#custom-video','#photo']){
      const aligned=await page.locator(media).evaluate(element=>{const media=element.getBoundingClientRect(),layer=element.nextElementSibling.getBoundingClientRect();return ['left','top','width','height'].every(key=>Math.abs(media[key]-layer[key])<1);});
      assert.equal(aligned,true,`${media}: overlay should follow the media under transforms and borders.`);
    }
    // Player UI added after load must keep its order; detached media releases all overlays.
    await page.evaluate(()=>{const image=document.getElementById('photo');document.getElementById('custom-play').append(image);});
    await page.waitForFunction(()=>!document.querySelector('#custom-play [data-perde-layer]')&&!document.getElementById('photo').hasAttribute('data-perde-pending'));
    await page.evaluate(()=>storageChanges.forEach(fn=>fn({settings:{newValue:{enabled:false}}},'local')));
    assert.equal(await page.locator('[data-perde-layer]:visible').count(),0);
    assert.equal(await page.locator('video[data-perde-starting]').count(),0);
    assert.deepEqual(errors,[]);
    console.log('PASS: reproduced old toolbar regression; visible/clickable YouTube seek, volume, settings, menus; same-level custom controls; UI-icon exclusion; hidden media; transformed alignment; disabling cleanup. Real Brave, offline fixture and mocked detection.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
