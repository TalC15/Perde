// Hair length for people the gender model cannot decide (MediaPipe hair
// segmentation, on this device). Loaded on first need; until then nothing changes.
import {ImageSegmenter} from './vendor/mediapipe/vision_bundle.mjs';
const SIZE=256;
let segmenter=null,loading=null;
const canvas=document.createElement('canvas');canvas.width=SIZE;canvas.height=SIZE;
const context=canvas.getContext('2d',{willReadFrequently:true});
function load(){
  if(!loading)loading=(async()=>{
    const fileset={wasmLoaderPath:chrome.runtime.getURL('vendor/mediapipe/wasm/vision_wasm_internal.js'),wasmBinaryPath:chrome.runtime.getURL('vendor/mediapipe/wasm/vision_wasm_internal.wasm')};
    const options=delegate=>({baseOptions:{modelAssetPath:chrome.runtime.getURL('hair/hair_segmenter.tflite'),delegate},runningMode:'IMAGE',outputCategoryMask:false,outputConfidenceMasks:true});
    // On the processor it slowed every analysis (~0.3 s); the graphics card needs a few ms.
    try{segmenter=await ImageSegmenter.createFromOptions(fileset,options('GPU'));}
    catch{segmenter=await ImageSegmenter.createFromOptions(fileset,options('CPU'));}
  })().catch(error=>{loading=null;throw error;});
  return loading;
}
// face: [x,y,w,h] in image pixels. Returns 'short', 'long' or 'none'.
function judge(image,face){
  const [fx,fy,fw,fh]=face,side=Math.max(fw*3.2,fh*3.6),x=fx+fw/2-side/2,y=fy-fh*.9;
  context.fillStyle='#000';context.fillRect(0,0,SIZE,SIZE);
  context.drawImage(image,x,y,side,side,0,0,SIZE,SIZE);
  const result=segmenter.segment(canvas);
  try{
    const masks=result.confidenceMasks,mask=masks[masks.length-1].getAsFloat32Array();
    return PerdeFaces.hairLength(mask,SIZE,[(fx-x)/side*SIZE,(fy-y)/side*SIZE,fw/side*SIZE,fh/side*SIZE]);
  }finally{result.close();}
}
globalThis.PerdeHair={load,ready:()=>!!segmenter,judge};
