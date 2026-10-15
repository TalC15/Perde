'use strict';
globalThis.PerdeMusicControls={install(shadow,rpc){
  const section=document.createElement('section');section.className='music-section';
  const heading=document.createElement('p'),list=document.createElement('div'),note=document.createElement('p'),label=document.createElement('label'),volume=document.createElement('input'),value=document.createElement('span');
  heading.textContent='Arka plan müziği';heading.className='music-heading';list.id='background-tracks';note.id='music-note';note.setAttribute('role','status');
  volume.type='range';volume.min='0';volume.max='100';volume.step='1';volume.value='15';volume.setAttribute('aria-label','Arka plan müziği ses düzeyi');volume.id='music-volume';
  label.append(document.createTextNode('Müzik sesi'),volume,value);section.append(heading,list,label,note);shadow.getElementById('panel-details').append(section);
  let revision=0,selected=null,changing=false,volumeQueue=Promise.resolve();
  async function refresh(){
    const version=++revision;
    try{
      const result=await rpc({type:'music-list'});if(version!==revision)return;
      selected=result.backgroundTrackId;list.replaceChildren();volume.value=String(Math.round((result.musicVolume??.15)*100));value.textContent=`%${volume.value}`;
      for(const item of result.items||[]){
        const row=document.createElement('label'),box=document.createElement('input'),title=document.createElement('span');box.type='checkbox';box.checked=item.id===selected;box.value=item.id;title.textContent=item.title;row.append(box,title);list.append(row);
        box.onchange=async()=>{
          if(changing)return;changing=true;for(const input of list.querySelectorAll('input'))input.disabled=true;
          try{await rpc({type:'music-select',id:box.checked?item.id:null});await refresh();}
          catch(error){note.textContent=error.message;box.checked=item.id===selected;}
          finally{changing=false;for(const input of list.querySelectorAll('input'))input.disabled=false;}
        };
      }
      note.textContent=result.items?.length?'Bir parça seçebilirsin. Video durunca müzik de durur; kısa parçalar döngüyle çalar.':'MP3 eklemek için eklenti menüsündeki MP3’ler bölümünü aç.';
      label.hidden=!result.items?.length;
    }catch(error){note.textContent=error.message;}
  }
  volume.oninput=()=>{value.textContent=`%${volume.value}`;};
  volume.onchange=()=>{const amount=Number(volume.value)/100;volumeQueue=volumeQueue.then(()=>rpc({type:'music-volume',volume:amount})).catch(error=>{note.textContent=error.message;});};
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&(changes.musicLibraryChanged||changes.backgroundTrackId||changes.musicVolume))refresh();});
  refresh();
  return {warning(message){if(message)note.textContent=message;}};
}};
