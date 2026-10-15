(() => {
  'use strict';
  let busy=false,preview=null,previewURL=null,revision=0;
  const status=text=>{$('music-status').textContent=text;};
  function stopPreview(){if(preview){preview.pause();preview.remove();preview=null;}if(previewURL)URL.revokeObjectURL(previewURL);previewURL=null;}
  function controls(){ $('music-files').disabled=busy;for(const button of $('music-list').querySelectorAll('button'))button.disabled=busy; }
  async function refresh(){
    const version=++revision,items=await PerdeMusicLibrary.list();if(version!==revision)return;
    stopPreview();$('music-list').replaceChildren();$('music-count').textContent=`${items.length} / ${PerdeMusicLibrary.MAX_TRACKS}`;$('music-empty').hidden=items.length>0;
    for(const item of items){
      const row=document.createElement('li'),name=document.createElement('strong'),info=document.createElement('p'),actions=document.createElement('div');
      name.textContent=item.title;info.textContent=`${vocalDuration(item.totalSeconds)} · ${vocalSize(item.bytes)}`;actions.className='library-actions';
      for(const [label,action] of [['Dinle','preview'],['İndir','download'],['Sil','remove']]){
        const button=document.createElement('button');button.textContent=label;button.setAttribute('aria-label',`${item.title}: ${label}`);if(action==='remove')button.className='library-remove';
        button.onclick=async()=>{
          if(busy)return;busy=true;controls();
          try{
            if(action==='remove'){await rpc({type:'music-remove',id:item.id});await refresh();status('MP3 tarayıcı kitaplığından silindi.');}
            else{
              const record=await PerdeMusicLibrary.get(item.id);if(!record)throw Error('Parça bulunamadı. Paneli yeniden aç.');
              if(action==='preview'){
                stopPreview();previewURL=URL.createObjectURL(record.blob);preview=document.createElement('audio');preview.controls=true;preview.src=previewURL;preview.volume=.3;row.append(preview);await preview.play();
              }else{
                const url=URL.createObjectURL(record.blob),link=document.createElement('a');link.href=url;link.download=item.title.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/\.mp3$/i,'')+'.mp3';link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);status('MP3 indirmesi başlatıldı.');
              }
            }
          }catch(error){status(error.message);}finally{busy=false;controls();}
        };
        actions.append(button);
      }
      row.append(name,info,actions);$('music-list').append(row);
    }
    controls();
  }
  function duration(blob){return new Promise((resolve,reject)=>{
    let finished=false;
    const url=URL.createObjectURL(blob),audio=new Audio(),timer=setTimeout(()=>finish(Error('MP3 açılamadı: süre sınırı aşıldı.')),15000);
    function finish(error){if(finished)return;finished=true;clearTimeout(timer);const seconds=audio.duration;audio.removeAttribute('src');audio.load();URL.revokeObjectURL(url);error?reject(error):resolve(seconds);}
    audio.addEventListener('loadedmetadata',()=>finish(Number.isFinite(audio.duration)&&audio.duration>0?null:Error('Geçerli bir MP3 seç.')),{once:true});
    audio.addEventListener('error',()=>finish(Error('Bu dosya oynatılabilen bir MP3 değil.')),{once:true});audio.preload='metadata';audio.src=url;
  });}
  $('music-files').onchange=async()=>{
    if(busy)return;const files=[...$('music-files').files];if(!files.length)return;
    busy=true;controls();stopPreview();let added=0;const failures=[];
    for(const [index,file] of files.entries()){
      status(`MP3’ler kaydediliyor… ${index+1} / ${files.length}`);
      try{
        if(!/\.mp3$/i.test(file.name))throw Error('Yalnızca MP3 dosyaları eklenebilir.');
        if(!file.size||file.size>PerdeMusicLibrary.MAX_BYTES)throw Error('Dosya boyutu 0–25 MB arasında olmalı.');
        const blob=new Blob([file],{type:'audio/mpeg'}),totalSeconds=await duration(blob);
        await PerdeMusicLibrary.put({title:file.name.replace(/\.mp3$/i,''),blob,totalSeconds});added++;
        // Notify after each committed file, so closing the popup never hides a saved import.
        await rpc({type:'music-library-changed'});
      }catch(error){failures.push(`${file.name}: ${error.message}`);}
    }
    $('music-files').value='';busy=false;
    try{await refresh();}catch(error){failures.push(error.message);}
    controls();status(`${added} MP3 kaydedildi.${failures.length?' '+failures.join(' '):' Videodaki vokal panelinden birini seçebilirsin.'}`);
  };
  window.addEventListener('pagehide',stopPreview);
  for(const name of sections)$(`tab-${name}`).addEventListener('click',()=>{if(name!=='music')stopPreview();});
  refresh().catch(error=>status(error.message));
})();
