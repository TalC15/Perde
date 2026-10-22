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
  // Per-track gender vote. A person is left visible only after two or more
  // confident "male" observations; one clear female observation covers again.
  const WINDOW=6;
  function vote(state,evidence,threshold=.8,now=0) {
    const previous=state||{obs:[],male:false,mean:null,at:0};
    if(!evidence||!(evidence.weight>0)||!Number.isFinite(evidence.male))return previous;
    const obs=[...previous.obs,{p:clamp(evidence.male,0,1),w:clamp(evidence.weight,0,1)}].slice(-WINDOW);
    const weight=obs.reduce((s,o)=>s+o.w,0),mean=obs.reduce((s,o)=>s+o.p*o.w,0)/(weight||1),last=obs.at(-1);
    let male=previous.male;
    if(male)male=!(mean<threshold-.15||last.p<.35&&last.w>=.4);
    else male=obs.length>=2&&weight>=1&&mean>=threshold&&Math.min(...obs.map(o=>o.p))>=threshold-.25;
    return {obs,male,mean,at:now};
  }
  // Displayed masks never trail the person: edges grow at once and shrink smoothly.
  function settle(shown,target,dt=16) {
    if(!shown||overlap(shown,target)<.2)return [...target];
    const k=1-Math.exp(-Math.max(0,dt)/60);
    const L=shown[0],T=shown[1],R=shown[0]+shown[2],B=shown[1]+shown[3];
    const l=target[0],t=target[1],r=target[0]+target[2],b=target[1]+target[3];
    const nl=l<L?l:L+(l-L)*k,nt=t<T?t:T+(t-T)*k,nr=r>R?r:R+(r-R)*k,nb=b>B?b:B+(b-B)*k;
    return [nl,nt,nr-nl,nb-nt];
  }
  // Face position as a fraction of its person box, so it moves with the box.
  function relative(face,box) {
    if(!Array.isArray(face)||!face.every(Number.isFinite)||!(box[2]>0&&box[3]>0))return null;
    return [(face[0]-box[0])/box[2],(face[1]-box[1])/box[3],face[2]/box[2],face[3]/box[3]];
  }
  // The head area of a shown person, from its box and relative face: a covered
  // box behind that person must not hide the head in front of it.
  function head(box,face) {
    if(!face)return null;
    const w=face[2]*box[2],h=face[3]*box[3],x=box[0]+face[0]*box[2],y=box[1]+face[1]*box[3];
    return [x-w*.25,y-h*.4,w*1.5,h*1.7];
  }
  class Tracker {
    constructor(){this.tracks=[];this.nextId=1;}
    reset(){this.tracks=[];}
    // After a scene cut nobody keeps an earlier "male" decision.
    resetGender(){for(const t of this.tracks)t.gender=null;}
    update(boxes,now,evidence=[],threshold=.8) {
      if(!Array.isArray(boxes))throw Error('Geçersiz algılama sonucu');
      const old=this.tracks.filter(t=>now-t.seen<8000),available=new Set(old);
      const next=[];
      for(const [index,raw] of boxes.entries()){
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
          // An uncertain match may be a different person: its decision restarts.
          // Boxes arrive already moved to the current frame, so a clear overlap
          // within a few analysis intervals is the same person (cuts reset anyway).
          const area=box[2]*box[3]/(match.box[2]*match.box[3]||1);
          const same=best>1.3&&now-match.seen<=2500&&area>.55&&area<1.8;
          next.push({id:match.id,box,velocity,seen:now,gender:vote(same?match.gender:null,evidence[index],threshold,now),face:relative(evidence[index]?.face,box)||(same?match.face:null)});
        }else next.push({id:this.nextId++,box,velocity:[0,0,0,0],seen:now,gender:vote(null,evidence[index],threshold,now),face:relative(evidence[index]?.face,box)});
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
        return {id:t.id,box:expanded([x,y,r-x,b-y],padding),raw:move,face:t.face||null,male:t.gender?.male===true,score:t.gender?.mean??null};
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
  root.PerdeTracking={Tracker,clip,expanded,overlap,contentRect,vote,settle,relative,head};
  if(typeof module!=='undefined')module.exports=root.PerdeTracking;
})(globalThis);
