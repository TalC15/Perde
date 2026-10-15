(() => {
  'use strict';
  if(globalThis.__perdeGambling)return;globalThis.__perdeGambling=true;
  let enabled=false,pending=false,siteDisabled=false;
  const hidden=new Map();
  // Deliberately limited to identifiable ad containers, not article/page text.
  const containers='ytd-ad-slot-renderer,ytd-promoted-sparkles-web-renderer,ytd-display-ad-renderer,[data-ad-slot],[data-ad-unit],.advertisement';
  const phrase=/(?:canlı bahis|canli bahis|bahis bonusu|deneme bonusu|casino bonus|online casino|sports betting)/i;
  const domains=/(^|\.)(bet365\.com|betway\.com|bwin\.com|stake\.com)$/i;
  function scan(){
    pending=false;
    for(const [element,previous]of hidden)if(!enabled||!element.isConnected){element.removeAttribute('data-perde-gambling');element.inert=previous;hidden.delete(element);}
    if(!enabled)return;
    for(const element of document.querySelectorAll(containers)){
      const matches=phrase.test(element.textContent||'')||[...element.querySelectorAll('a[href]')].some(a=>{try{return domains.test(new URL(a.href).hostname);}catch{return false;}});
      if(matches&&!hidden.has(element)){hidden.set(element,element.inert);element.inert=true;element.setAttribute('data-perde-gambling','true');}
      if(!matches&&hidden.has(element)){element.inert=hidden.get(element);hidden.delete(element);element.removeAttribute('data-perde-gambling');}
    }
  }
  const observer=new MutationObserver(()=>{if(enabled&&!pending){pending=true;setTimeout(scan,150);}});
  observer.observe(document,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['href']});
  chrome.runtime.onMessage.addListener(message=>{if(message.type==='site-disable'){siteDisabled=true;enabled=false;scan();}});
  chrome.storage.local.get({settings:PerdeSettings.defaults}).then(r=>{enabled=PerdeSettings.normalize(r.settings).blockGambling;scan();});
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.settings){enabled=!siteDisabled&&PerdeSettings.normalize(changes.settings.newValue).blockGambling;scan();}});
})();
