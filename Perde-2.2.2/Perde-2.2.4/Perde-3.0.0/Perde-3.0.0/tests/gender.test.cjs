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

test('Faces join the person whose head region they occupy; the most female-looking face decides',()=>{
  const person=[.4,.1,.2,.8];
  const man={box:[.46,.12,.06,.08],score:.9,male:.96,weight:1};
  const woman={box:[.5,.13,.06,.08],score:.9,male:.1,weight:1};
  let r=faces.combine([person],[man]);
  assert.deepEqual(r.evidence,[{male:.96,weight:1}]);assert.equal(r.boxes.length,1);
  r=faces.combine([person],[man,woman]);assert.deepEqual(r.evidence,[{male:.1,weight:1}]);
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
  let state=tracking.vote(null,{male:.99,weight:1},.85);
  assert.equal(state.male,false,'one look is never enough');
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
  tracker.update([[.12,.1,.2,.5]],700,[null]);
  assert.equal(tracker.sample(710)[0].male,false,'a long gap may hide a different person');
  tracker.update([[.12,.1,.2,.5]],800,[man]);tracker.update([[.12,.1,.2,.5]],900,[man]);
  assert.equal(tracker.sample(910)[0].male,true);
  tracker.update([[.12,.1,.4,.8]],1000,[null]);
  assert.equal(tracker.sample(1010)[0].male,false,'a sudden size change restarts the vote');
  tracker.update([[.12,.1,.4,.8]],1100,[man]);tracker.update([[.12,.1,.4,.8]],1200,[man]);
  tracker.resetGender();assert.equal(tracker.sample(1210)[0].male,false);
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
