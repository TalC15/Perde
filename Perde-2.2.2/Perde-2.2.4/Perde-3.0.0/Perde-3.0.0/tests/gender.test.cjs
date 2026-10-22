'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(__dirname,'../eklenti');
const settings=require(path.join(root,'settings.js'));
const faces=require(path.join(root,'faces.js'));
const tracking=require(path.join(root,'tracking.js'));

test('Women are the default target; unknown values fall back safely',()=>{
  const s=settings.normalize({});
  assert.equal(s.target,'women');assert.equal(s.maskStyle,'blur');
  assert.equal(settings.normalize({target:'all',maskStyle:'solid'}).target,'all');
  assert.equal(settings.normalize({target:'men',maskStyle:'none'}).target,'women');
  assert.equal(settings.normalize({maskStyle:'none'}).maskStyle,'blur');
  // People whose face was never seen stay covered unless the user chooses otherwise.
  assert.equal(s.faceless,'cover');
  assert.equal(settings.normalize({faceless:'show'}).faceless,'show');
  assert.equal(settings.normalize({faceless:true}).faceless,'cover');
  // A stricter level needs more certainty before anyone is left uncovered.
  assert.ok(settings.profiles.high.maleThreshold>settings.profiles.balanced.maleThreshold);
  assert.ok(settings.profiles.balanced.maleThreshold>settings.profiles.loose.maleThreshold);
});

test('BlazeFace anchors and decoding map a detection back to frame pixels',()=>{
  assert.equal(faces.ANCHORS.length,896);
  const rows=new Float32Array(896*faces.ROW).fill(-20);
  const index=16*16*2+(3*8+5)*6; // second grid, cell (x=5,y=3)
  const [ax,ay]=faces.ANCHORS[index];assert.deepEqual([ax,ay],[32*5.5,32*3.5]);
  rows.set([4,2,-4,40,50],index*faces.ROW);
  const [hit]=faces.decode(rows,{x:100,y:0,size:512},.6);
  assert.ok(hit.score>.98);
  const scale=2;assert.deepEqual(hit.box.map(v=>Math.round(v)),[Math.round(100+(ax+2-20)*scale),Math.round((ay-4-25)*scale),80,100]);
  assert.equal(faces.decode(rows,{x:0,y:0,size:256},.98).length,1);assert.equal(faces.decode(rows,{x:0,y:0,size:256},.99).length,0);
  rows[index*faces.ROW]=-1;assert.equal(faces.decode(rows,{x:0,y:0,size:256},.6).length,0);
});

test('Extra face tiles run only when people are small',()=>{
  assert.equal(faces.tiles(1280,720,[[.4,.05,.2,.9]]).length,1);
  const wide=faces.tiles(1280,720,[[.4,.6,.05,.15]]);
  assert.equal(wide.length,4);assert.deepEqual(wide[0],{x:0,y:0,size:1280});
  assert.ok(wide.slice(1).every(t=>t.size===720&&t.x+t.size<=1280));
  assert.equal(faces.tiles(800,800,[[.4,.6,.05,.1]]).length,1);
  assert.ok(faces.tiles(720,1280,null).slice(1).every(t=>t.x===0&&t.y+t.size<=1280));
});

test('Each face joins the one person whose head it fits; a neighbour keeps its own covered box',()=>{
  const person=[.4,.1,.2,.8];
  const man={box:[.46,.12,.06,.08],score:.9,male:.96,weight:1};
  const woman={box:[.5,.13,.06,.08],score:.9,male:.1,weight:1};
  const plain=r=>r.evidence.map(e=>e&&{male:e.male,weight:e.weight});
  let r=faces.combine([person],[man]);
  assert.deepEqual(plain(r),[{male:.96,weight:1}]);assert.deepEqual(r.evidence[0].face,man.box);assert.equal(r.boxes.length,1);
  // The man is judged by his own face; the woman next to him is covered on her own.
  r=faces.combine([person],[man,woman]);assert.deepEqual(plain(r),[{male:.96,weight:1},{male:.1,weight:1}]);assert.equal(r.boxes.length,2);
  // Two people, two faces: each person gets the face at its own head.
  r=faces.combine([[.1,.1,.2,.8],[.25,.1,.2,.8]],[{...woman,box:[.17,.12,.06,.08]},{...man,box:[.32,.12,.06,.08]}]);
  assert.deepEqual(plain(r),[{male:.1,weight:1},{male:.96,weight:1}]);
  // A face low in the box (a carried child) and a face outside get their own covered box.
  const low={box:[.45,.7,.05,.06],score:.9,male:null,weight:0};
  r=faces.combine([person],[low]);assert.equal(r.boxes.length,2);assert.equal(r.evidence[1],null);
  assert.ok(r.boxes[1][3]>low.box[3]*3);
  assert.equal(faces.quality({box:[0,0,18,18],score:.95}),0);
  assert.equal(faces.quality({box:[0,0,80,80],score:.5}),0);
  assert.equal(faces.quality({box:[0,0,80,80],score:.95}),1);
  assert.ok(faces.inside([90,90,20,20],200,200,[[.4,.4,.2,.2]]));
  assert.ok(!faces.inside([10,10,20,20],200,200,[[.4,.4,.2,.2]]));
});

test('A person is shown only after repeated confident male observations',()=>{
  let state=tracking.vote(null,{male:.92,weight:1},.85);
  assert.equal(state.male,false,'one ordinary look is not enough');
  assert.equal(tracking.vote(null,{male:.97,weight:1},.85).male,true,'one very sure, clear look is enough');
  assert.equal(tracking.vote(null,{male:.99,weight:.6},.85).male,false,'but not from a small face');
  assert.equal(tracking.vote(null,{male:.97,weight:1},.88).male,false,'the strict profile asks for more');
  state=tracking.vote(state,{male:.97,weight:1},.85);assert.equal(state.male,true);
  state=tracking.vote(state,{male:.3,weight:.5},.85);assert.equal(state.male,false,'a clear female look covers again');
  let weak=null;for(let i=0;i<3;i++)weak=tracking.vote(weak,{male:.99,weight:.2},.85);
  assert.equal(weak.male,false,'small faces need more evidence');
  let mixed=tracking.vote(null,{male:.5,weight:1},.85);
  for(let i=0;i<4;i++)mixed=tracking.vote(mixed,{male:.99,weight:1},.85);
  assert.equal(mixed.male,false,'an uncertain look in the window blocks the decision');
  assert.equal(tracking.vote(state,null,.85),state);
});

test('Uncertain track matches and scene cuts restart the decision',()=>{
  const tracker=new tracking.Tracker(),man={male:.97,weight:1};
  tracker.update([[.1,.1,.2,.5]],0,[man]);tracker.update([[.11,.1,.2,.5]],150,[man]);
  assert.equal(tracker.sample(160)[0].male,true);
  // Analyses are 0.25-1.2 s apart: the decision must survive that gap.
  tracker.update([[.12,.1,.2,.5]],1100,[null]);
  assert.equal(tracker.sample(1110)[0].male,true,'the same person across a normal analysis interval');
  tracker.update([[.12,.1,.2,.5]],4000,[null]);
  assert.equal(tracker.sample(4010)[0].male,false,'a long gap may hide a different person');
  tracker.update([[.12,.1,.2,.5]],4500,[man]);tracker.update([[.12,.1,.2,.5]],5300,[man]);
  assert.equal(tracker.sample(5310)[0].male,true,'two looks 0.8 s apart decide');
  tracker.update([[.12,.1,.4,.8]],5600,[null]);
  assert.equal(tracker.sample(5610)[0].male,false,'a sudden size change restarts the vote');
  tracker.update([[.12,.1,.4,.8]],5800,[man]);tracker.update([[.12,.1,.4,.8]],6000,[man]);
  tracker.resetGender();assert.equal(tracker.sample(6010)[0].male,false);
});

test('Displayed masks grow immediately and never shrink below the person',()=>{
  const shown=[100,100,100,200];
  const grown=tracking.settle(shown,[90,100,120,200],16);
  assert.equal(grown[0],90);assert.ok(grown[0]+grown[2]>=210);
  const moved=tracking.settle(shown,[110,100,100,200],16);
  assert.ok(moved[0]<110&&moved[0]>=100,'left edge eases');assert.equal(moved[0]+moved[2],210,'right edge jumps');
  assert.deepEqual(tracking.settle(shown,[500,500,50,50],16),[500,500,50,50],'far jumps snap');
  assert.deepEqual(tracking.settle(null,[1,2,3,4]),[1,2,3,4]);
});
test('A covered box behind a shown man gets a hole only at his head',()=>{
  const box=[.4,.3,.2,.6],face=[.47,.32,.06,.08];
  const rel=tracking.relative(face,box);
  assert.deepEqual(rel.map(v=>+v.toFixed(3)),[.35,.033,.3,.133]);
  const head=tracking.head(box,rel);
  // Slightly larger than the face, mostly upwards for hair.
  assert.ok(head[0]<face[0]&&head[1]<face[1]&&head[0]+head[2]>face[0]+face[2]&&head[1]+head[3]>face[1]+face[3]);
  assert.ok(head[2]<face[2]*1.6&&head[3]<face[3]*1.8);
  assert.equal(tracking.head(box,null),null);assert.equal(tracking.relative(null,box),null);
  // The face travels with the track's box.
  const tracker=new tracking.Tracker();
  tracker.update([box],0,[{male:.97,weight:1,face}]);tracker.update([[.42,.3,.2,.6]],500,[null]);
  const item=tracker.sample(510)[0];assert.ok(item.face);assert.deepEqual(item.face,tracker.tracks[0].face);
});
test('Hair length is read only when hair is visible on top of the head',()=>{
  const S=100,face=[40,30,20,24];
  const mask=(top,bottom,left=30,right=70)=>{const m=new Float32Array(S*S);for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++)m[y*S+x]=.9;return m;};
  assert.equal(faces.hairLength(mask(10,40),S,face),'short','ends at the ears');
  assert.equal(faces.hairLength(mask(10,90),S,face),'long','reaches the shoulders');
  assert.equal(faces.hairLength(mask(10,55),S,face),'none','about chin length decides nothing');
  assert.equal(faces.hairLength(new Float32Array(S*S),S,face),'none','headscarf or hat: no visible hair');
  assert.equal(faces.hairLength(mask(35,90),S,face),'none','hair only below the forehead is not a head of hair');
  assert.equal(faces.hairLength(mask(10,20,45,55),S,face),'none','a few pixels are not enough');
});
test('A man seen clearly earlier is recognised; a woman never becomes known male',()=>{
  const unit=(...v)=>faces.normalize(Float32Array.from({length:8},(_,i)=>v[i]||0));
  const man=unit(1,.2),manTurned=unit(1,.3,.1),woman=unit(0,1),similarWoman=unit(.55,.84);
  const memory=new faces.Memory();
  assert.deepEqual(memory.observe(man,.95,1),{knownMale:false,knownFemale:false},'one look makes no identity decision');
  memory.observe(man,.93,1);
  assert.ok(faces.similarity(man,manTurned)>=faces.SAME_PERSON);
  assert.equal(memory.observe(manTurned,.6,.8).knownMale,true,'recognised from an uncertain side view');
  assert.ok(faces.similarity(man,similarWoman)<faces.SAME_PERSON);
  assert.equal(memory.observe(similarWoman,.6,1).knownMale,false,'a different face is not matched');
  memory.observe(woman,.05,1);
  assert.equal(memory.observe(woman,.5,1).knownFemale,true,'a woman seen once stays a woman');
  // Uncertain looks never create a person.
  const fresh=new faces.Memory();fresh.observe(man,.7,1);fresh.observe(man,.7,1);
  assert.equal(fresh.people.length,0);
  // One female look ends a "known male" identity for good.
  const mixed=new faces.Memory();mixed.observe(man,.95,1);mixed.observe(man,.95,1);mixed.observe(man,.1,1);
  assert.deepEqual(mixed.observe(man,.9,1),{knownMale:false,knownFemale:true});
});

