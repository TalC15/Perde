(function(root){
  'use strict';
  const profiles={loose:{confidence:.4,padding:.08,detail:'normal'},balanced:{confidence:.25,padding:.15,detail:'normal'},high:{confidence:.15,padding:.25,detail:'high'}};
  const defaults={enabled:true,profile:'balanced',pauseOnError:true,muteAds:true,blockGambling:false,vocalEnabled:true,maxMinutes:40};
  function normalize(raw={}){
    if(!raw||typeof raw!=='object')raw={};
    const profile=Object.hasOwn(profiles,raw.profile)?raw.profile:raw.confidence===.4?'loose':raw.confidence===.15?'high':'balanced';
    return {...defaults,profile,...profiles[profile],enabled:raw.enabled!==false,pauseOnError:raw.pauseOnError!==false,muteAds:raw.muteAds!==false,blockGambling:raw.blockGambling===true,vocalEnabled:raw.vocalEnabled!==false,maxMinutes:[3,5,10,15,25,40].includes(Number(raw.maxMinutes))?Number(raw.maxMinutes):40};
  }
  function videoId(url){try{const u=new URL(url);if(u.protocol!=='https:'||!/(^|\.)youtube(?:-nocookie)?\.com$/.test(u.hostname))return null;const id=u.searchParams.get('v')||u.pathname.match(/^\/(?:shorts|embed)\/([\w-]{11})/)?.[1];return /^[\w-]{11}$/.test(id||'')?id:null;}catch{return null;}}
  root.PerdeSettings={defaults,profiles,normalize,videoId};
  if(typeof module!=='undefined')module.exports=root.PerdeSettings;
})(globalThis);
