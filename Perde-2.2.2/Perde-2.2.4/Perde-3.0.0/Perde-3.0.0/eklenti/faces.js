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
// scale: source pixels per detection pixel (gender crops come from the full frame).
function quality(face,scale=1){
  const size=Math.max(face.box[2],face.box[3])*Math.min(scale,1.6);
  return clamp((size-22)/34,0,1)*clamp((face.score-.55)/.25,0,1);
}
// people: normalized [x,y,w,h]. faces: {box (normalized), score, male (0..1|null), weight}.
// Returns boxes plus aligned evidence {male, weight} or null. Each face belongs
// to at most one person: the one whose head position it fits best, so a man is
// not judged by a neighbour's face. A face without a person gets its own box.
function combine(people,faces){
  const boxes=people.map(b=>[...b]),evidence=people.map(()=>null),pairs=[];
  people.forEach((p,i)=>faces.forEach((f,j)=>{
    const cx=f.box[0]+f.box[2]/2,cy=f.box[1]+f.box[3]/2;
    const inside=cx>=p[0]-p[2]*.05&&cx<=p[0]+p[2]*1.05&&cy>=p[1]-p[3]*.08&&cy<=p[1]+p[3]*.6&&f.box[2]<=p[2]*1.2;
    if(!inside)return;
    // Heads sit at the top centre of a person box.
    const cost=Math.abs(cx-(p[0]+p[2]/2))/p[2]+Math.abs(cy-(p[1]+f.box[3]*.75))/p[3];
    pairs.push({i,j,cost});
  }));
  const person=new Set(),face=new Set();
  for(const {i,j} of pairs.sort((a,b)=>a.cost-b.cost)){
    if(person.has(i)||face.has(j))continue;
    person.add(i);face.add(j);
    const f=faces[j];
    evidence[i]=f.weight>0&&Number.isFinite(f.male)?{male:f.male,weight:f.weight,face:f.box}:null;
  }
  faces.forEach((f,j)=>{
    if(face.has(j))return;
    // A face without a detected body: cover the likely head-and-torso area.
    const [x,y,w,h]=f.box;
    boxes.push([x-w*.35,y-h*.25,w*1.7,h*3.2]);
    evidence.push(f.weight>0&&Number.isFinite(f.male)?{male:f.male,weight:f.weight,face:f.box}:null);
  });
  return {boxes,evidence};
}
// mask: hair confidence [size*size] of a square head crop; face: [x,y,w,h] in
// crop pixels. Hair that ends clearly above the chin is short; hair well below
// it is long. No hair on top of the head (headscarf, hat, bald) decides nothing.
function hairLength(mask,size,face){
  let total=0,top=-1,bottom=-1;
  for(let y=0;y<size;y++){
    let n=0;for(let x=0;x<size;x++)if(mask[y*size+x]>.5)n++;
    total+=n;if(n>size*.04){if(top<0)top=y;bottom=y;}
  }
  const share=total/(size*size);
  if(top<0||share<.02||top>=face[1])return 'none';
  const below=(bottom-(face[1]+face[3]))/face[3];
  if(below<=-.3)return 'short';
  if(below>=.5&&share>=.05)return 'long';
  return 'none';
}
root.PerdeFaces={INPUT,ROW,ANCHORS,anchors,tiles,decode,iou,suppress,cropBox,inside,quality,combine,hairLength};
if(typeof module!=='undefined')module.exports=root.PerdeFaces;
})(globalThis);
