(function(root){
'use strict';
const {clip}=root.PerdeTracking;
function gray(rgba,width,height){
 const data=new Uint8Array(width*height);
 for(let i=0,p=0;i<data.length;i++,p+=4)data[i]=(rgba[p]*77+rgba[p+1]*150+rgba[p+2]*29)>>8;
 return {data,width,height};
}
function displacement(box,a,b){
 if(!a||!b||a.width!==b.width||a.height!==b.height)return [0,0];
 const W=a.width,H=a.height,points=[];
 for(let iy=0;iy<9;iy++)for(let ix=0;ix<6;ix++){
  const x=Math.round((box[0]+box[2]*(.2+.6*ix/5))*W),y=Math.round((box[1]+box[3]*(.15+.7*iy/8))*H);
  if(x>=8&&x<W-8&&y>=6&&y<H-6)points.push([x,y,a.data[y*W+x]]);
 }
 if(points.length<8)return [0,0];
 const mean=points.reduce((s,p)=>s+p[2],0)/points.length;
 if(points.reduce((s,p)=>s+(p[2]-mean)**2,0)/points.length<30)return [0,0];
 const cost=(dx,dy)=>points.reduce((s,p)=>s+Math.abs(p[2]-b.data[(p[1]+dy)*W+p[0]+dx]),0)/points.length;
 const zero=cost(0,0);let best=zero,answer=[0,0];
 for(let dy=-5;dy<=5;dy++)for(let dx=-7;dx<=7;dx++){
  const value=cost(dx,dy)+.15*(Math.abs(dx)+Math.abs(dy));
  if(value<best){best=value;answer=[dx/W,dy/H];}
 }
 return best<zero*.86?answer:[0,0];
}
// Mean absolute brightness change; a hard cut between shots gives a large value.
function difference(a,b){
 if(!a||!b||a.data.length!==b.data.length)return 0;
 let sum=0,count=0;
 for(let i=0;i<a.data.length;i+=3){sum+=Math.abs(a.data[i]-b.data[i]);count++;}
 return count?sum/count:0;
}
function advance(items,a,b){return items.map(item=>{
 const [dx,dy]=displacement(item.box,a,b);const box=clip([item.box[0]+dx,item.box[1]+dy,item.box[2],item.box[3]]);
 return {...item,box};
});}
function replay(boxes,frames,capture){
 let items=boxes.map((box,id)=>({id,box:clip(box)}));
 const start=frames.findIndex(frame=>frame.sequence===capture);
 if(start<0)return items.map(x=>x.box);
 for(let i=start+1;i<frames.length;i++)items=advance(items,frames[i-1],frames[i]);
 return items.map(x=>x.box);
}
root.PerdeMotion={gray,displacement,difference,advance,replay};
if(typeof module!=='undefined')module.exports=root.PerdeMotion;
})(globalThis);
