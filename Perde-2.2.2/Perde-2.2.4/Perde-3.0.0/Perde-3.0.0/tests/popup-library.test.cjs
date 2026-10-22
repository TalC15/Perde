'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const test=require('node:test');
const root=path.join(__dirname,'..','eklenti');

class Element {
  constructor(tag='div'){this.tagName=tag;this.children=[];this.textContent='';this.disabled=false;this.type='text';this.value='';this.checked=false;this.events={};}
  append(...items){this.children.push(...items);}
  replaceChildren(...items){this.children=[...items];}
  setAttribute(name,value){this[name]=value;}
  addEventListener(name,handler){this.events[name]=handler;}
  focus(){this.focused=true;}
  querySelectorAll(selector){return this.children.flatMap(child=>child instanceof Element?[...(selector==='button'&&child.tagName==='button'?[child]:[]),...child.querySelectorAll(selector)]:[]);}
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function panel(initialItems=[],initialFailures=[]){
  const html=fs.readFileSync(path.join(root,'popup.html'),'utf8');
  const ids=[...html.matchAll(/id="([^"]+)"/g)].map(match=>match[1]);
  assert.equal(new Set(ids).size,ids.length,'Popup IDs must be unique');
  const elements=new Map(ids.map(id=>[id,new Element()]));
  for(const id of ['enabled','pauseOnError','muteAds','blockGambling','vocalEnabled'])elements.get(id).type='checkbox';
  const state={items:initialItems,messages:[],tabs:[],failures:new Set(initialFailures),waitFor:null,service:{connected:false,tokenPresent:false}};
  const radios=[...html.matchAll(/type="radio" name="([^"]+)" value="([^"]+)"/g)].map(([,name,value])=>Object.assign(new Element('input'),{type:'radio',name,value}));
  const document={
    getElementById:id=>{assert(elements.has(id),`Missing popup element ${id}`);return elements.get(id);},
    querySelectorAll:selector=>radios.filter(radio=>selector===`input[name="${radio.name}"]`),
    createElement:tag=>new Element(tag),createTextNode:value=>value,hidden:false
  };
  const chrome={
    runtime:{sendMessage:async message=>{
      state.messages.push(message);const serviceSnapshot={...state.service};
      if(state.waitFor?.type===message.type)await state.waitFor.promise;
      if(state.failures.has(message.type))return{ok:false,error:'Kayıtlara erişilemedi.'};
      if(message.type==='vocal-library-list')return{ok:true,items:[...state.items]};
      if(message.type==='vocal-library-remove')state.items=state.items.filter(item=>item.videoId!==message.videoId);
      if(message.type==='vocal-library-clear')state.items=[];
      if(message.type==='service-connect')state.service={connected:true,tokenPresent:true};
      if(message.type==='service-disconnect')state.service={connected:false,tokenPresent:false};
      if(message.type==='service-status')return {ok:true,...serviceSnapshot};
      return{ok:true};
    },getURL:value=>value,getManifest:()=>({version:'2.2.2'})},
    tabs:{query:async()=>[],sendMessage:async()=>({}),create:async value=>state.tabs.push(value)},
    permissions:{request:async()=>true},
    storage:{local:{get:async key=>typeof key==='object'?key:{siteOrigins:[]},set:async()=>{}}}
  };
  const context={document,chrome,setInterval(){},URL,console,PerdeSettings:{defaults:{},normalize:value=>value||{}}};
  vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(root,'popup.js'),'utf8'),context);
  await flush();
  return{state,context,get:id=>elements.get(id)};
}
const recording={videoId:'abcDEF123_-',title:'<img src=x onerror=alert(1)>',bytes:1048576,totalSeconds:126,savedAt:2};

test('popup shows saved vocals without connecting to the service and opens the exact video',async()=>{
  const {state,get}=await panel([recording,{...recording,videoId:'../invalid'}]);
  const list=get('vocal-library-list');
  assert.equal(list.children.length,1);
  assert.equal(list.children[0].children[0].textContent,recording.title,'Titles remain literal text');
  assert.match(list.children[0].children[1].textContent,/2:06 · 1 MB/);
  assert.match(get('library-summary').textContent,/1 kayıt/);
  await list.querySelectorAll('button')[0].onclick();
  assert.equal(state.tabs[0].url,'https://www.youtube.com/watch?v=abcDEF123_-');
  assert(!state.messages.some(message=>message.type==='service-connect'));
});

test('popup deletes individual and all browser recordings, then displays the empty state',async()=>{
  const {state,get}=await panel([recording]);
  await get('vocal-library-list').querySelectorAll('button')[1].onclick();
  assert.equal(get('vocal-library-list').children.length,0);
  assert.equal(get('clear-library').disabled,true);
  assert.match(get('library-summary').textContent,/Henüz kayıt yok/);
  assert(state.messages.some(message=>message.type==='vocal-library-remove'&&message.videoId===recording.videoId));
  state.items=[recording];
  await get('refresh-library').onclick();
  assert.equal(get('clear-library').disabled,false);
  await get('clear-library').onclick();
  assert.equal(get('library-clear-confirm').hidden,false);
  assert.equal(state.items.length,1,'Opening the confirmation must not delete recordings');
  assert(!state.messages.some(message=>message.type==='vocal-library-clear'));
  await get('confirm-clear-library').onclick();
  assert.equal(get('vocal-library-list').children.length,0);
  assert(state.messages.some(message=>message.type==='vocal-library-clear'));
  assert(!state.messages.some(message=>message.type==='cache-clear'),'Browser deletion must not delete legacy disk records');
});

test('Popup tabs work with arrow keys and preserve the current library',async()=>{
  const {state,get}=await panel([recording]);let prevented=false;
  assert.equal(get('panel-protection').hidden,false);assert.equal(get('panel-vocals').hidden,true);
  get('tab-protection').events.keydown({key:'ArrowRight',preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.equal(get('panel-vocals').hidden,false);assert.equal(get('panel-protection').hidden,true);
  assert.equal(get('tab-vocals')['aria-selected'],'true');assert.equal(get('tab-vocals').tabIndex,0);
  assert.equal(get('tab-vocals').focused,true);assert.equal(state.items.length,1);
  get('tab-settings').onclick();assert.equal(get('panel-settings').hidden,false);assert.equal(get('panel-vocals').hidden,true);
});

test('Bulk deletion can be cancelled without erasing a recording',async()=>{
  const {state,get}=await panel([recording]);get('clear-library').onclick();get('cancel-clear-library').onclick();
  assert.equal(get('library-clear-confirm').hidden,true);assert.equal(state.items.length,1);
  assert(!state.messages.some(message=>message.type==='vocal-library-clear'));assert.equal(get('clear-library').focused,true);
});

test('Service connection reports the real state and clears the entered secret',async()=>{
  const {state,get}=await panel();
  assert.equal(get('service-state').textContent,'Bağlı değil');assert.equal(get('disconnect').disabled,true);
  get('token').value='x'.repeat(43);await get('connect').onclick();
  assert.equal(get('service-state').textContent,'Servis bağlı');assert.equal(get('token').value,'');assert.equal(get('disconnect').disabled,false);
  await get('disconnect').onclick();assert.equal(get('service-state').textContent,'Bağlı değil');
  assert.equal(state.items.length,0);assert(!state.messages.some(message=>message.type==='vocal-library-clear'));
});

test('popup exposes library failure and recovers through refresh without discarding a failed deletion',async()=>{
  const {state,get}=await panel([recording],['vocal-library-list']);
  assert.match(get('library-summary').textContent,/Kayıtlar yüklenemedi/);
  assert.match(get('library-status').textContent,/Kayıtlara erişilemedi/);
  assert.equal(get('refresh-library').disabled,false);
  state.failures.clear();
  await get('refresh-library').onclick();
  assert.equal(get('vocal-library-list').children.length,1);
  state.failures.add('vocal-library-remove');
  await get('vocal-library-list').querySelectorAll('button')[1].onclick();
  assert.equal(get('vocal-library-list').children.length,1);
  assert.match(get('library-status').textContent,/Kayıtlara erişilemedi/);
  assert.equal(get('clear-library').disabled,false);
});

test('popup disables library actions while a deletion is pending',async()=>{
  const {state,get}=await panel([recording]);
  let resolve;
  state.waitFor={type:'vocal-library-remove',promise:new Promise(done=>{resolve=done;})};
  const deleting=get('vocal-library-list').querySelectorAll('button')[1].onclick();
  assert.equal(get('refresh-library').disabled,true);
  assert.equal(get('clear-library').disabled,true);
  assert(get('vocal-library-list').querySelectorAll('button').every(button=>button.disabled));
  resolve();await deleting;
  assert.equal(get('refresh-library').disabled,false);
  assert.equal(get('vocal-library-list').children.length,0);
});

test('A connected service hides credentials and disables the connected button',async()=>{
  const p=await panel();p.get('token').value='x'.repeat(43);await p.get('connect').onclick();
  assert.equal(p.get('connect').textContent,'Servise Bağlı');assert.equal(p.get('connect').disabled,true);assert.equal(p.get('service-credentials').hidden,true);
  await p.get('disconnect').onclick();assert.equal(p.get('connect').disabled,false);assert.equal(p.get('service-credentials').hidden,false);
});

test('A stale in-flight status reply cannot overwrite a newly connected UI',async()=>{
  const p=await panel();let release;const hold=new Promise(resolve=>release=resolve);p.state.waitFor={type:'service-status',promise:hold};
  const pending=vm.runInContext('refreshService()',p.context);await flush();
  p.get('token').value='x'.repeat(43);await p.get('connect').onclick();release();await pending;
  assert.equal(p.get('connect').textContent,'Servise Bağlı');assert.equal(p.get('service-credentials').hidden,true);
});
