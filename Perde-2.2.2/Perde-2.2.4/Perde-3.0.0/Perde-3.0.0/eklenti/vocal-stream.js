'use strict';
// Plays a vocal MP3 while the service is still producing it. Chrome keeps only
// ~12 MB of audio in Media Source, so a window of a few minutes follows the
// playback position; a frame index lets a seek rebuild the window anywhere.
(()=>{
  const FRAME_SECONDS=1152/44100,AHEAD=180,BEHIND=30,APPEND_FRAMES=Math.ceil(12/FRAME_SECONDS);
  const BITRATES=[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320],RATES=[44100,48000,32000];
  class FrameIndex{
    constructor(){this.bytes=new Uint8Array(1<<20);this.length=0;this.offsets=new Uint32Array(1<<14);this.count=0;this.scan=0;}
    push(chunk){
      if(this.length+chunk.length>this.bytes.length){
        const grown=new Uint8Array(Math.max(this.length+chunk.length,Math.ceil(this.bytes.length*1.5)));grown.set(this.bytes.subarray(0,this.length));this.bytes=grown;
      }
      this.bytes.set(chunk,this.length);this.length+=chunk.length;
      // Only complete MPEG-1 Layer III frames count as playable.
      const b=this.bytes;
      while(this.scan+4<=this.length){
        const i=this.scan;
        if(b[i]!==0xFF||(b[i+1]&0xFE)!==0xFA){this.scan++;continue;}
        const bitrate=BITRATES[b[i+2]>>4],rate=RATES[(b[i+2]>>2)&3];
        if(!bitrate||!rate){this.scan++;continue;}
        const size=Math.floor(144000*bitrate/rate)+((b[i+2]>>1)&1);
        if(i+size>this.length)break;
        if(this.count===this.offsets.length){const grown=new Uint32Array(this.count*2);grown.set(this.offsets);this.offsets=grown;}
        this.offsets[this.count++]=i;this.scan=i+size;
      }
    }
    get seconds(){return this.count*FRAME_SECONDS;}
    frameAt(time){return Math.max(0,Math.min(this.count,Math.floor(time/FRAME_SECONDS)));}
    slice(from,to){return this.bytes.slice(this.offsets[from],to<this.count?this.offsets[to]:this.scan);}
    blob(){return new Blob([this.bytes.subarray(0,this.length)],{type:'audio/mpeg'});}
  }
  class VocalStream{
    static supported(){return typeof MediaSource==='function'&&MediaSource.isTypeSupported('audio/mpeg');}
    constructor(audio,index,duration){
      this.audio=audio;this.index=index;this.media=new MediaSource();this.buffer=null;
      this.first=0;this.next=0;this.restart=true;this.complete=false;
      this.url=URL.createObjectURL(this.media);audio.src=this.url;
      this.media.addEventListener('sourceopen',()=>{
        if(this.buffer)return;
        this.buffer=this.media.addSourceBuffer('audio/mpeg');this.buffer.mode='sequence';
        if(duration>0)this.media.duration=duration;
        this.buffer.addEventListener('updateend',()=>this.pump());
        this.pump();
      },{once:true});
      this.onSeek=()=>this.pump();audio.addEventListener('seeking',this.onSeek);
      this.timer=setInterval(()=>this.pump(),400);
    }
    finish(){this.complete=true;this.pump();}
    pump(){
      const buffer=this.buffer;
      if(!buffer||buffer.updating||this.media.readyState==='closed')return;
      try{
        const time=this.audio.currentTime;
        // A seek outside the window starts a new one there; two earlier frames
        // carry the MP3 bit reservoir the first decoded frame refers to.
        if(time<this.first*FRAME_SECONDS-.3||time>this.next*FRAME_SECONDS+2){
          // Not clamped to the received frames: a seek past them waits there.
          this.first=this.next=Math.max(0,Math.floor(time/FRAME_SECONDS)-2);this.restart=true;
          if(buffer.buffered.length){buffer.remove(0,Infinity);return;}
        }
        if(this.next<this.index.count&&this.next*FRAME_SECONDS<time+AHEAD){
          const to=Math.min(this.index.count,this.next+APPEND_FRAMES);
          if(this.restart){buffer.timestampOffset=this.next*FRAME_SECONDS;this.restart=false;}
          const data=this.index.slice(this.next,to);this.next=to;buffer.appendBuffer(data);return;
        }
        if(buffer.buffered.length&&buffer.buffered.start(0)<time-BEHIND-10){
          this.first=Math.max(this.first,this.index.frameAt(time-BEHIND));buffer.remove(0,time-BEHIND);return;
        }
        if(this.complete&&this.next>=this.index.count&&this.media.readyState==='open')this.media.endOfStream();
      }catch{
        // A rejected append (e.g. quota) rebuilds the window at the current position.
        this.first=this.next=0;this.restart=true;
      }
    }
    close(){clearInterval(this.timer);this.audio.removeEventListener('seeking',this.onSeek);URL.revokeObjectURL(this.url);this.buffer=null;}
  }
  globalThis.PerdeVocalStream={FrameIndex,VocalStream,FRAME_SECONDS};
})();
