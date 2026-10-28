// 24 kHz mono. Paired input/rendered output frames share a sample clock.
class PcAudio extends AudioWorkletProcessor {
  constructor() {
    super(); this.active=false; this.queue=[]; this.head=0; this.queued=0;
    this.generation=0; this.frame=0; this.used=0; this.packet=new ArrayBuffer(1924);
    this.view=new DataView(this.packet); this.energyIn=0; this.energyOut=0;
    this.port.onmessage=({data:m})=>{
      if(m.type==='start') this.active=true;
      if(m.type==='clear') {this.queue=[];this.head=0;this.queued=0;this.generation=m.generation;}
      if(m.type==='audio' && m.generation===this.generation) {
        const pcm=new Int16Array(m.pcm);
        if(this.queued+pcm.length>48000){this.port.postMessage({type:'error',reason:'Ausgabepuffer überfüllt'});return;}
        this.queue.push(pcm);this.queued+=pcm.length;
      }
      if(m.type==='stop') {
        this.active=false;this.queue=[];this.queued=0;
        if(this.used) this.sendFrame();
        this.port.postMessage({type:'stopped'});
      }
    };
  }
  sendFrame() {
    this.view.setUint32(0,this.frame,true);
    this.port.postMessage({type:'pcm',packet:this.packet},[this.packet]);
    this.frame+=480;this.used=0;this.packet=new ArrayBuffer(1924);this.view=new DataView(this.packet);
    if(this.frame%12000===0){
      this.port.postMessage({type:'levels',input:Math.sqrt(this.energyIn/12000),output:Math.sqrt(this.energyOut/12000)});
      this.energyIn=0;this.energyOut=0;
    }
  }
  process(inputs,outputs) {
    const out=outputs[0][0],input=inputs[0]?.[0];
    out.fill(0);
    if(!this.active) return true;
    for(let i=0;i<out.length;i++){
      const x=Math.max(-1,Math.min(1,input?.[i]??0));let y=0;
      if(this.queue.length){
        const chunk=this.queue[0];y=chunk[this.head++]/32768;this.queued--;
        if(this.head>=chunk.length){this.queue.shift();this.head=0;}
      }
      out[i]=y;
      this.view.setInt16(4+this.used*2,Math.round(x*32767),true);
      this.view.setInt16(964+this.used*2,Math.round(y*32767),true);
      this.energyIn+=x*x;this.energyOut+=y*y;
      if(++this.used===480)this.sendFrame();
    }
    return true;
  }
}
registerProcessor('pc-audio',PcAudio);
