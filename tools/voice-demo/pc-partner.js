const $=id=>document.getElementById(id);
let stream,context,frame;
function stop(){speechSynthesis.cancel();cancelAnimationFrame(frame);stream?.getTracks().forEach(t=>t.stop());stream=null;context?.close();context=null;$('level').value=0;$('status').textContent='Testpartner gestoppt. LUKAS separat in Edge stoppen.';}
$('devices').onclick=async()=>{
  try{const grant=await navigator.mediaDevices.getUserMedia({audio:true});grant.getTracks().forEach(t=>t.stop());
    $('mic').replaceChildren();for(const d of await navigator.mediaDevices.enumerateDevices())if(d.kind==='audioinput')$('mic').add(new Option(d.label,d.deviceId));$('listen').disabled=false;
  }catch{$('status').textContent='Mikrofonfreigabe fehlgeschlagen.';}
};
$('listen').onclick=async()=>{
  stop();try{
    stream=await navigator.mediaDevices.getUserMedia({audio:{deviceId:{exact:$('mic').value},echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
    context=new AudioContext();await context.resume();const analyzer=context.createAnalyser();analyzer.fftSize=2048;
    context.createMediaStreamSource(stream).connect(analyzer);const values=new Float32Array(analyzer.fftSize);
    const tick=()=>{analyzer.getFloatTimeDomainData(values);$('level').value=Math.sqrt(values.reduce((a,x)=>a+x*x,0)/values.length);frame=requestAnimationFrame(tick);};tick();
    $('status').textContent='Empfang aktiv. Während einer Testfrage muss B2 still bleiben; bei LUKAS muss der Pegel ausschlagen.';
  }catch{stop();$('status').textContent='Empfang konnte nicht gestartet werden.';}
};
document.querySelectorAll('[data-question]').forEach(button=>button.onclick=()=>{
  speechSynthesis.cancel();const question=new SpeechSynthesisUtterance(button.dataset.question);question.lang='de-DE';
  const voice=speechSynthesis.getVoices().find(v=>v.lang.startsWith('de')&&v.localService);if(voice)question.voice=voice;
  question.onerror=()=>{$('status').textContent='Testfrage nicht gesprochen. Windows-Sprachausgabe prüfen.';};speechSynthesis.speak(question);
});
$('stop').onclick=stop;window.addEventListener('pagehide',stop);
