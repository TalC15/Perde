(function(root){
  'use strict';
  // maleThreshold: how sure the gender model must be before a person is left
  // uncovered in "women" mode. Undetermined people always stay covered.
  // gpuShare: the largest share of graphics time analysis may use, so video
  // playback keeps its frames; motion tracking moves masks in between.
  const profiles={
    loose:{confidence:.4,padding:.08,detail:'normal',frame:640,maleThreshold:.72,genderLimit:2,cutBlur:false,gpuShare:.1},
    balanced:{confidence:.25,padding:.15,detail:'normal',frame:800,maleThreshold:.8,genderLimit:3,cutBlur:false,gpuShare:.15},
    high:{confidence:.15,padding:.25,detail:'high',frame:960,maleThreshold:.88,genderLimit:4,cutBlur:true,gpuShare:.25}
  };
  const targets=['women','all'],maskStyles=['blur','solid'];
  const defaults={enabled:true,profile:'balanced',target:'women',maskStyle:'blur',pauseOnError:true,muteAds:true,blockGambling:false,vocalEnabled:true,maxMinutes:40};
  function normalize(raw={}){
    if(!raw||typeof raw!=='object')raw={};
    const profile=Object.hasOwn(profiles,raw.profile)?raw.profile:raw.confidence===.4?'loose':raw.confidence===.15?'high':'balanced';
    return {...defaults,profile,...profiles[profile],enabled:raw.enabled!==false,target:targets.includes(raw.target)?raw.target:defaults.target,maskStyle:maskStyles.includes(raw.maskStyle)?raw.maskStyle:defaults.maskStyle,pauseOnError:raw.pauseOnError!==false,muteAds:raw.muteAds!==false,blockGambling:raw.blockGambling===true,vocalEnabled:raw.vocalEnabled!==false,maxMinutes:[3,5,10,15,25,40].includes(Number(raw.maxMinutes))?Number(raw.maxMinutes):40};
  }
  function videoId(url){try{const u=new URL(url);if(u.protocol!=='https:'||!/(^|\.)youtube(?:-nocookie)?\.com$/.test(u.hostname))return null;const id=u.searchParams.get('v')||u.pathname.match(/^\/(?:shorts|embed)\/([\w-]{11})/)?.[1];return /^[\w-]{11}$/.test(id||'')?id:null;}catch{return null;}}
  root.PerdeSettings={defaults,profiles,targets,maskStyles,normalize,videoId};
  if(typeof module!=='undefined')module.exports=root.PerdeSettings;
})(globalThis);
