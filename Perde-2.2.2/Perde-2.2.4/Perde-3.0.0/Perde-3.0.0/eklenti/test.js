'use strict';
let oldUrl=null;
document.getElementById('file').onchange=event=>{
  const file=event.target.files[0];if(!file)return;
  if(oldUrl)URL.revokeObjectURL(oldUrl);oldUrl=URL.createObjectURL(file);
  const video=document.getElementById('sample'),photo=document.getElementById('photo');
  if(file.type.startsWith('image/')){video.pause();video.removeAttribute('src');video.hidden=true;photo.hidden=false;photo.src=oldUrl;}
  else{photo.hidden=true;photo.removeAttribute('src');video.hidden=false;video.src=oldUrl;video.play().catch(()=>{});}
  document.getElementById('message').textContent='Dosya yerel olarak inceleniyor. İlk model hazırlığı birkaç saniye sürebilir.';
};
document.getElementById('fullscreen').onclick=()=>document.querySelector('.stage').requestFullscreen();
