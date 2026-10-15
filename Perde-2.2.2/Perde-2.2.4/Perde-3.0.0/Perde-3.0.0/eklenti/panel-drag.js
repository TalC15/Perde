'use strict';
globalThis.PerdePanelDrag={install(host,handle,reset){
  let saved=null,drag=null;
  function bounds(){return {width:window.innerWidth,height:window.innerHeight,panel:Math.min(304,window.innerWidth-24)};}
  function position(left,top){const b=bounds();return {left:Math.max(12,Math.min(b.width-b.panel-12,left)),top:Math.max(12,Math.min(b.height-60,top))};}
  function paint(p){const b=bounds();host.style.left=p.left+'px';host.style.top=p.top+'px';host.style.right='auto';host.style.bottom='auto';host.style.setProperty('--panel-height',Math.max(48,b.height-p.top-12)+'px');}
  function store(p){const b=bounds();saved={x:(p.left-12)/Math.max(1,b.width-b.panel-24),y:(p.top-12)/Math.max(1,b.height-72)};chrome.storage.local.set({vocalPanelPosition:saved}).catch(()=>{});}
  function apply(){if(!saved&&!drag)return false;if(drag)return true;const b=bounds();paint(position(12+saved.x*Math.max(1,b.width-b.panel-24),12+saved.y*Math.max(1,b.height-72)));return true;}
  chrome.storage.local.get('vocalPanelPosition').then(r=>{const p=r.vocalPanelPosition;if(p&&Number.isFinite(p.x)&&Number.isFinite(p.y)){saved={x:Math.max(0,Math.min(1,p.x)),y:Math.max(0,Math.min(1,p.y))};apply();}}).catch(()=>{});
  handle.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();const r=host.getBoundingClientRect();drag={id:e.pointerId,x:e.clientX,y:e.clientY,left:r.left,top:r.top};handle.setPointerCapture(e.pointerId);});
  handle.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;e.preventDefault();const p=position(drag.left+e.clientX-drag.x,drag.top+e.clientY-drag.y);paint(p);});
  function end(e){if(!drag||drag.id!==e.pointerId)return;const r=host.getBoundingClientRect();drag=null;store(position(r.left,r.top));}
  handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);handle.addEventListener('lostpointercapture',end);
  handle.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();});
  handle.addEventListener('keydown',e=>{const shifts={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};if(e.key==='Home'){e.preventDefault();reset.click();return;}if(!shifts[e.key])return;e.preventDefault();const r=host.getBoundingClientRect(),delta=shifts[e.key],step=e.shiftKey?2:20,p=position(r.left+delta[0]*step,r.top+delta[1]*step);paint(p);store(p);});
  reset.addEventListener('click',()=>{saved=null;drag=null;chrome.storage.local.remove('vocalPanelPosition').catch(()=>{});});
  return {apply};
}};
