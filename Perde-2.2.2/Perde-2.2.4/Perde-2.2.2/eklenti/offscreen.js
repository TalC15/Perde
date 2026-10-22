'use strict';
let loading=null,extras=null,personModel=null,faceModel=null,genderModel=null;
let queue=Promise.resolve();
let engineStatus={ready:false,backend:null,error:null,faceReady:false,genderReady:false};
const GENDER_BATCH=4,GENDER_SIZE=224,GENDER_OUTPUT='gender_pred/Sigmoid:0';
async function warmUp(face,gender){
  // Compile shaders before these models touch a video frame: a 16:9 frame with
  // one face pass and with the small-people tiles, and every gender batch size.
  const canvas=document.createElement('canvas');canvas.width=800;canvas.height=450;
  await personModel.detect(canvas,1,.9);
  const frame=tf.zeros([1,450,800,3]);
  try{if(face){await findFaces(frame,800,450,[],face);await findFaces(frame,800,450,null,face);}}finally{frame.dispose();}
  tf.tidy(()=>{for(let n=1;n<=GENDER_BATCH;n++)gender?.execute(tf.zeros([n,GENDER_SIZE,GENDER_SIZE,3]),GENDER_OUTPUT);});
}
// Face and gender models load after the person model: until they are ready
// every detected person is covered, so protection starts without waiting.
function loadExtras(){
  if(extras)return extras;
  extras=(async()=>{
    const warnings=[];let face=null,gender=null;
    try{face=await tf.loadGraphModel(chrome.runtime.getURL('face/blazeface-back.json'));}
    catch(error){warnings.push('Yüz modeli yüklenemedi: '+error.message);}
    try{gender=face?await tf.loadGraphModel(chrome.runtime.getURL('gender/faceres.json')):null;}
    catch(error){warnings.push('Cinsiyet modeli yüklenemedi; algılanan herkes örtülecek: '+error.message);}
    await warmUp(face,gender).catch(()=>{});
    faceModel=face;genderModel=gender;
    engineStatus={...engineStatus,faceReady:!!face,genderReady:!!gender,warning:warnings.join(' ')||null};
  })();
  return extras;
}
async function loadModels(){
  if(loading)return loading;
  loading=(async()=>{
    try{if(!await tf.setBackend('webgl'))await tf.setBackend('cpu');}
    catch{await tf.setBackend('cpu');}
    await tf.ready();
    personModel=await cocoSsd.load({base:'lite_mobilenet_v2',modelUrl:chrome.runtime.getURL('model/model.json')});
    engineStatus={...engineStatus,ready:true,backend:tf.getBackend(),error:null};
    void loadExtras();
    return personModel;
  })().catch(error=>{loading=null;personModel?.dispose();personModel=null;engineStatus.error=error.message;throw error;});
  return loading;
}
function readImage(url){
  return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error('Görüntü çözümlenemedi'));image.src=url;});
}
async function findFaces(batch,width,height,people,model=faceModel){
  // batch: float32 [1,H,W,3] frame shared with the gender classifier. The
  // whole-frame pass finds large faces; tiles run only when people are small.
  // All tiles are queued on the GPU and read back once.
  const list=PerdeFaces.tiles(width,height,people);
  const rows=tf.tidy(()=>tf.concat(list.map(tile=>{
    const box=[[tile.y/height,tile.x/width,(tile.y+tile.size)/height,(tile.x+tile.size)/width]];
    const input=tf.sub(tf.div(tf.image.cropAndResize(batch,box,[0],[PerdeFaces.INPUT,PerdeFaces.INPUT]),127.5),1);
    const byShape={};for(const t of model.execute(input))byShape[t.shape.slice(1).join('x')]=t;
    return tf.concat([tf.concat([byShape['512x1'],byShape['512x16']],2),tf.concat([byShape['384x1'],byShape['384x16']],2)],1);
  }),0));
  const data=await rows.data();rows.dispose();
  const size=PerdeFaces.ANCHORS.length*PerdeFaces.ROW,found=[];
  list.forEach((tile,i)=>found.push(...PerdeFaces.decode(data.subarray(i*size,(i+1)*size),tile,.6)));
  return PerdeFaces.suppress(found);
}
async function classify(batch,width,height,faces,limit,skip,scale=1){
  // Probability that each face is male; null when the face is too small/uncertain
  // or belongs to a person whose decision is already settled (cost grows per face).
  // batch may be the full-resolution frame: crops use normalized coordinates.
  const result=faces.map(()=>null);
  const order=faces.map((face,index)=>({index,weight:PerdeFaces.quality(face,scale),size:face.box[2]*face.box[3]}))
    .filter(x=>x.weight>0&&!PerdeFaces.inside(faces[x.index].box,width,height,skip)).sort((a,b)=>b.size-a.size).slice(0,limit);
  if(!genderModel||!order.length)return result;
  for(let i=0;i<order.length;i+=GENDER_BATCH){
    const group=order.slice(i,i+GENDER_BATCH);
    const boxes=group.map(item=>PerdeFaces.cropBox(faces[item.index].box,width,height));
    const output=tf.tidy(()=>genderModel.execute(tf.image.cropAndResize(batch,boxes,boxes.map(()=>0),[GENDER_SIZE,GENDER_SIZE]),GENDER_OUTPUT));
    const values=await output.data();output.dispose();
    group.forEach((item,k)=>{const p=values[k];if(Number.isFinite(p))result[item.index]={male:Math.min(1,Math.max(0,p)),weight:item.weight};});
  }
  return result;
}
async function detect(message){
  if(typeof message.image!=='string'||!/^data:image\/(jpeg|png|webp|gif|avif);base64,/.test(message.image)||message.image.length>3500000)throw Error('Geçersiz görüntü isteği');
  await loadModels();
  const image=await readImage(message.image);
  const max=Math.max(image.naturalWidth,image.naturalHeight);
  const frame=[640,800,960].includes(message.frame)?message.frame:message.detail==='high'?960:640;
  const factor=Math.min(1,frame/max);
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*factor));canvas.height=Math.max(1,Math.round(image.naturalHeight*factor));
  canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
  const W=canvas.width,H=canvas.height,begin=performance.now();
  const pixels=tf.browser.fromPixels(canvas);let floats=null,full=null;
  try{
    const predictions=await personModel.detect(pixels,100,message.confidence===.4?.4:message.confidence===.15?.15:.25);
    const timing={person:Math.round(performance.now()-begin)};
    const people=predictions.filter(x=>x.class==='person').map(p=>p.bbox.map((v,i)=>v/(i%2?H:W)));
    floats=faceModel?tf.tidy(()=>tf.expandDims(tf.cast(pixels,'float32'))):null;
    let mark=performance.now();
    const faces=faceModel?await findFaces(floats,W,H,people):[];
    timing.face=Math.round(performance.now()-mark);mark=performance.now();
    const limit=Number.isInteger(message.genderLimit)?Math.max(0,Math.min(8,message.genderLimit)):3;
    const skip=Array.isArray(message.skip)?message.skip.slice(0,30).filter(b=>Array.isArray(b)&&b.length===4&&b.every(Number.isFinite)):[];
    // Gender crops come from the full frame: small faces keep their detail.
    let genders=faces.map(()=>null);
    if(message.genders!==false&&genderModel&&faces.length){
      const scale=image.naturalWidth/W;
      if(scale>1.05){full=tf.tidy(()=>tf.expandDims(tf.cast(tf.browser.fromPixels(image),'float32')));genders=await classify(full,W,H,faces,limit,skip,scale);}
      else genders=await classify(floats,W,H,faces,limit,skip);
    }
    // Undecided faces that lean male: clearly short hair counts as a male look,
    // long hair keeps them covered. Each look still has to agree with the next.
    if(message.genders!==false&&globalThis.PerdeHair){
      const threshold=Number.isFinite(message.threshold)?Math.min(.95,Math.max(.5,message.threshold)):.8;
      // One face per analysis, the largest: the next look covers the next person.
      const undecided=genders.map((g,i)=>g&&g.weight>=.5&&g.male>=.5&&g.male<threshold?i:-1).filter(i=>i>=0).sort((a,b)=>faces[b].box[3]-faces[a].box[3]).slice(0,1);
      if(undecided.length&&!PerdeHair.ready())PerdeHair.load().catch(()=>{});
      else if(undecided.length){
        const scale=image.naturalWidth/W;
        for(const i of undecided){
          try{
            const hair=PerdeHair.judge(image,faces[i].box.map(v=>v*scale));genders[i].hair=hair;
            if(hair==='short')genders[i].male=Math.max(genders[i].male,Math.min(.95,threshold+.05));
            else if(hair==='long')genders[i].male=Math.min(genders[i].male,.45);
          }catch{/* No hair decision for this look. */}
        }
      }
    }
    timing.gender=Math.round(performance.now()-mark);
    const combined=PerdeFaces.combine(people,faces.map((face,i)=>({box:[face.box[0]/W,face.box[1]/H,face.box[2]/W,face.box[3]/H],score:face.score,male:genders[i]?.male??null,weight:genders[i]?.weight||0})));
    if(!combined.boxes.every(b=>b.every(Number.isFinite)))throw Error('Model geçersiz koordinat üretti');
    // debug: per-face results for the test page and offline evaluation.
    const faceDetails=message.debug===true?faces.map((face,i)=>({box:[face.box[0]/W,face.box[1]/H,face.box[2]/W,face.box[3]/H],score:face.score,male:genders[i]?.male??null,weight:genders[i]?.weight||0,hair:genders[i]?.hair||null})):undefined;
    return {ok:true,boxes:combined.boxes,evidence:combined.evidence,faces:faces.length,faceDetails,genderReady:!!genderModel,timing,ms:Math.round(performance.now()-begin),backend:tf.getBackend(),warning:engineStatus.warning};
  }finally{pixels.dispose();floats?.dispose();full?.dispose();}
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender.id!==chrome.runtime.id||sender.tab)return;
  if(message.target!=='perde-engine')return;
  if(message.type==='engine-detect'){
    const task=queue.then(()=>detect(message));queue=task.catch(()=>{});
    task.then(respond,error=>respond({ok:false,error:error.message}));return true;
  }
  if(message.type==='engine-status'){
    loadModels().then(loadExtras).then(()=>respond({ok:true,...engineStatus}),error=>respond({ok:false,...engineStatus,error:error.message}));return true;
  }
});
