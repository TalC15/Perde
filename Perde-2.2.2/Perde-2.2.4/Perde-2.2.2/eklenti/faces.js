(function(root){
'use strict';
// BlazeFace (MediaPipe back-camera model, 256x256) decoding, frame tiling and
// face-to-person association. Pure functions: the offscreen engine runs the
// models, tests run these helpers without a browser.
const INPUT=256,ROW=17;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function anchors(size=INPUT){
  const out=[];
  for(const [stride,count] of [[size/16,2],[size/8,6]]){
    const grid=Math.ceil(size/stride);
    for(let y=0;y<grid;y++)for(let x=0;x<grid;x++)for(let n=0;n<count;n++)out.push([stride*(x+.5),stride*(y+.5)]);
  }
  return out;
}
const ANCHORS=anchors();
// Square tiles keep faces undistorted. One letterboxed pass covers the frame;
// overlapping squares are added only when a detected person is so small that
// the head would fall below the face model's reliable size in that pass.
const MIN_HEAD=18;
function tiles(width,height,people=null){
  const side=Math.min(width,height),long=Math.max(width,height),full={x:0,y:0,size:long};
  if(long<=side*1.25)return [full];
  const small=!people||people.some(p=>p[3]*height*.18*INPUT/long<MIN_HEAD);
  if(!small)return [full];
  const count=Math.ceil(long/side)+1,list=[];
  for(let i=0;i<count;i++){
    const offset=Math.round((long-side)*i/(count-1));
    list.push(width>=height?{x:offset,y:0,size:side}:{x:0,y:offset,size:side});
  }
  return [full,...list];
}
// rows: flattened [896 x 17] model output; order matches ANCHORS.
function decode(rows,tile,minScore=.6){
  const out=[],scale=tile.size/INPUT;
  for(let i=0;i<ANCHORS.length;i++){
    const o=i*ROW,score=1/(1+Math.exp(-clamp(rows[o],-80,80)));
    if(!(score>=minScore))continue;
    const [ax,ay]=ANCHORS[i],cx=rows[o+1]+ax,cy=rows[o+2]+ay,w=rows[o+3],h=rows[o+4];
    if(!(w>0&&h>0&&Number.isFinite(cx)&&Number.isFinite(cy)))continue;
    out.push({score,box:[tile.x+(cx-w/2)*scale,tile.y+(cy-h/2)*scale,w*scale,h*scale]});
  }
  return out;
}
function iou(a,b){
  const x=Math.max(a[0],b[0]),y=Math.max(a[1],b[1]);
  const w=Math.max(0,Math.min(a[0]+a[2],b[0]+b[2])-x),h=Math.max(0,Math.min(a[1]+a[3],b[1]+b[3])-y);
  return w*h/(a[2]*a[3]+b[2]*b[3]-w*h||1);
}
function suppress(faces,threshold=.3,limit=40){
  const kept=[];
  for(const face of [...faces].sort((a,b)=>b.score-a.score)){
    if(kept.length>=limit)break;
    if(kept.every(other=>iou(other.box,face.box)<threshold))kept.push(face);
  }
  return kept;
}
// Square crop around the face; 1.3x margin was the most accurate setting for
// the gender model in local evaluation.
function cropBox(box,width,height,margin=1.3){
  const side=Math.max(box[2],box[3])*margin,cx=box[0]+box[2]/2,cy=box[1]+box[3]/2;
  return [(cy-side/2)/height,(cx-side/2)/width,(cy+side/2)/height,(cx+side/2)/width];
}
// Face centre inside any normalized [x,y,w,h] region.
function inside(box,width,height,regions){
  const cx=(box[0]+box[2]/2)/width,cy=(box[1]+box[3]/2)/height;
  return regions.some(r=>cx>=r[0]&&cx<=r[0]+r[2]&&cy>=r[1]&&cy<=r[1]+r[3]);
}
// Small or uncertain faces give no gender evidence; their person stays covered.
function quality(face){
  const size=Math.max(face.box[2],face.box[3]);
  return clamp((size-22)/34,0,1)*clamp((face.score-.55)/.25,0,1);
}
// people: normalized [x,y,w,h]. faces: {box (normalized), score, male (0..1|null), weight}.
// Returns boxes plus aligned evidence {male, weight} or null. A person box with
// any female-looking face in its head region counts as female for that frame.
function combine(people,faces){
  const boxes=people.map(b=>[...b]),evidence=people.map(()=>null),used=new Set();
  people.forEach((p,i)=>{
    let best=null;
    faces.forEach((f,j)=>{
      const cx=f.box[0]+f.box[2]/2,cy=f.box[1]+f.box[3]/2;
      const inside=cx>=p[0]-p[2]*.05&&cx<=p[0]+p[2]*1.05&&cy>=p[1]-p[3]*.08&&cy<=p[1]+p[3]*.6&&f.box[2]<=p[2]*1.2;
      if(!inside)return;
      used.add(j);
      if(!(f.weight>0)||!Number.isFinite(f.male))return;
      if(!best||f.male<best.male)best={male:f.male,weight:f.weight};
    });
    evidence[i]=best;
  });
  faces.forEach((f,j)=>{
    if(used.has(j))return;
    // A face without a detected body: cover the likely head-and-torso area.
    const [x,y,w,h]=f.box;
    boxes.push([x-w*.35,y-h*.25,w*1.7,h*3.2]);
    evidence.push(f.weight>0&&Number.isFinite(f.male)?{male:f.male,weight:f.weight}:null);
  });
  return {boxes,evidence};
}
root.PerdeFaces={INPUT,ROW,ANCHORS,anchors,tiles,decode,iou,suppress,cropBox,inside,quality,combine};
if(typeof module!=='undefined')module.exports=root.PerdeFaces;
})(globalThis);
