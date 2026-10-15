(function(root) {
  'use strict';
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function overlap(a,b) {
    const x=Math.max(a[0],b[0]),y=Math.max(a[1],b[1]);
    const w=Math.max(0,Math.min(a[0]+a[2],b[0]+b[2])-x);
    const h=Math.max(0,Math.min(a[1]+a[3],b[1]+b[3])-y);
    return w*h/(a[2]*a[3]+b[2]*b[3]-w*h || 1);
  }
  function clip(b) {
    if(!Array.isArray(b)||b.length!==4||!b.every(Number.isFinite)||b[2]<=0||b[3]<=0)throw Error('Geçersiz insan kutusu');
    const x=clamp(b[0],0,1),y=clamp(b[1],0,1);
    return [x,y,Math.max(0,Math.min(1,b[0]+b[2])-x),Math.max(0,Math.min(1,b[1]+b[3])-y)];
  }
  function expanded(b,padding=.12) {
    const px=Math.max(.012,b[2]*padding),py=Math.max(.015,b[3]*padding);
    return clip([b[0]-px,b[1]-py,b[2]+px*2,b[3]+py*2]);
  }
  class Tracker {
    constructor(){this.tracks=[];this.nextId=1;}
    reset(){this.tracks=[];}
    update(boxes,now) {
      if(!Array.isArray(boxes))throw Error('Geçersiz algılama sonucu');
      const old=this.tracks.filter(t=>now-t.seen<8000),available=new Set(old);
      const next=[];
      for(const raw of boxes){
        const box=clip(raw);if(box[2]===0||box[3]===0)continue;
        let match=null,best=0;
        for(const t of available){
          const score=overlap(t.box,box);
          const distance=Math.hypot(t.box[0]+t.box[2]/2-box[0]-box[2]/2,t.box[1]+t.box[3]/2-box[1]-box[3]/2);
          const candidate=score>.08?1+score:distance<.13?.6-distance:0;
          if(candidate>best){match=t;best=candidate;}
        }
        if(match){
          available.delete(match);
          const dt=Math.max(.04,(now-match.seen)/1000);
          const velocity=box.map((v,i)=>clamp((v-match.box[i])/dt,-1.2,1.2));
          next.push({id:match.id,box,velocity,seen:now});
        }else next.push({id:this.nextId++,box,velocity:[0,0,0,0],seen:now});
      }
      for(const t of available)if(now-t.seen<750)next.push(t);
      this.tracks=next;return this.sample(now);
    }
    sample(now,padding=.12) {
      return this.tracks.filter(t=>now-t.seen<1100).map(t=>{
        const dt=clamp((now-t.seen)/1000,0,.22);
        const move=t.box.map((v,i)=>v+t.velocity[i]*dt);
        // Retain both the observed area and a short motion prediction.
        const x=Math.min(t.box[0],move[0]),y=Math.min(t.box[1],move[1]);
        const r=Math.max(t.box[0]+t.box[2],move[0]+move[2]);
        const b=Math.max(t.box[1]+t.box[3],move[1]+move[3]);
        return {id:t.id,box:expanded([x,y,r-x,b-y],padding)};
      });
    }
  }
  function contentRect(rect,naturalWidth,naturalHeight,fit='contain',position='50% 50%') {
    if(!naturalWidth||!naturalHeight)return rect;
    const contain=Math.min(rect.width/naturalWidth,rect.height/naturalHeight);
    const cover=Math.max(rect.width/naturalWidth,rect.height/naturalHeight);
    const scale=fit==='cover'?cover:fit==='fill'?null:fit==='none'?1:fit==='scale-down'?Math.min(1,contain):contain;
    if(scale===null)return {...rect};
    const width=naturalWidth*scale,height=naturalHeight*scale;
    const parts=(position||'50% 50%').trim().split(/\s+/);
    const offset=(value,space)=>{
      if(value==='left'||value==='top')return 0;
      if(value==='right'||value==='bottom')return space;
      if(value==='center')return space/2;
      if(/^-?[\d.]+%$/.test(value))return space*parseFloat(value)/100;
      if(/^-?[\d.]+px$/.test(value))return parseFloat(value);
      return space/2;
    };
    return {left:rect.left+offset(parts[0],rect.width-width),top:rect.top+offset(parts[1]||'50%',rect.height-height),width,height};
  }
  // Categories are supplied exclusively by the user, never inferred from pixels.
  function shouldCensor(target,label){return target==='all'||!['male','nonmale'].includes(label)||target===label;}
  function sceneChanged(a,b){if(a.length!==b.length)return true;let sum=0;for(let i=0;i<a.length;i++)sum+=Math.abs(a[i]-b[i]);return sum/a.length>45;}
  root.PerdeTracking={Tracker,clip,expanded,overlap,contentRect,shouldCensor,sceneChanged};
  if(typeof module!=='undefined')module.exports=root.PerdeTracking;
})(globalThis);
