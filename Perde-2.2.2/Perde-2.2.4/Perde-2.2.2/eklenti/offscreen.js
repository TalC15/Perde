'use strict';
let loading=null,personModel=null,faceModel=null;
let queue=Promise.resolve();
let engineStatus={ready:false,backend:null,error:null,faceReady:false};
async function loadModels(){
  if(loading)return loading;
  loading=(async()=>{
    try{if(!await tf.setBackend('webgl'))await tf.setBackend('cpu');}
    catch{await tf.setBackend('cpu');}
    await tf.ready();
    personModel=await cocoSsd.load({base:'lite_mobilenet_v2',modelUrl:chrome.runtime.getURL('model/model.json')});
    let faceWarning=null;
    try{faceModel=await blazeface.load({modelUrl:chrome.runtime.getURL('face/model.json'),maxFaces:30,scoreThreshold:.7});}
    catch(error){faceWarning='Ek yüz modeli yüklenemedi: '+error.message;}
    engineStatus={ready:true,backend:tf.getBackend(),error:null,faceReady:!!faceModel,warning:faceWarning};
    return {personModel,faceModel};
  })().catch(error=>{loading=null;personModel?.dispose();personModel=null;engineStatus.error=error.message;throw error;});
  return loading;
}
function readImage(url){
  return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error('Görüntü çözümlenemedi'));image.src=url;});
}
async function detect(message){
  if(typeof message.image!=='string'||!/^data:image\/(jpeg|png|webp|gif|avif);base64,/.test(message.image)||message.image.length>3500000)throw Error('Geçersiz görüntü isteği');
  await loadModels();
  const image=await readImage(message.image);
  const max=Math.max(image.naturalWidth,image.naturalHeight);
  const factor=Math.min(1,(message.detail==='high'?960:640)/max);
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*factor));canvas.height=Math.max(1,Math.round(image.naturalHeight*factor));
  canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
  const begin=performance.now();
  const predictions=await personModel.detect(canvas,100,message.confidence===.4?.4:message.confidence===.15?.15:.25);
  const boxes=predictions.filter(x=>x.class==='person').map(p=>p.bbox.map((v,i)=>v/(i%2?canvas.height:canvas.width)));
  const faces=faceModel?await faceModel.estimateFaces(canvas,false,false,true):[];
  for(const f of faces){
    const x=f.topLeft[0]/canvas.width,y=f.topLeft[1]/canvas.height;
    const w=(f.bottomRight[0]-f.topLeft[0])/canvas.width,h=(f.bottomRight[1]-f.topLeft[1])/canvas.height;
    const face=[x,y,w,h];
    // Faces supplement close-up human detection; do not suppress a reliable full body box.
    if(!boxes.some(b=>x+w/2>=b[0]&&x+w/2<=b[0]+b[2]&&y+h/2>=b[1]&&y+h/2<=b[1]+b[3]))
      boxes.push([x-w*.35,y-h*.25,w*1.7,h*3.2]);
  }
  if(!boxes.every(b=>b.every(Number.isFinite)))throw Error('Model geçersiz koordinat üretti');
  return {ok:true,boxes,faces:faces.length,ms:Math.round(performance.now()-begin),backend:tf.getBackend(),warning:engineStatus.warning};
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender.id!==chrome.runtime.id||sender.tab)return;
  if(message.target!=='perde-engine')return;
  if(message.type==='engine-detect'){
    const task=queue.then(()=>detect(message));queue=task.catch(()=>{});
    task.then(respond,error=>respond({ok:false,error:error.message}));return true;
  }
  if(message.type==='engine-status'){
    loadModels().then(()=>respond({ok:true,...engineStatus}),error=>respond({ok:false,...engineStatus,error:error.message}));return true;
  }
});
