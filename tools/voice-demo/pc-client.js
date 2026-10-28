const $=id=>document.getElementById(id);
let stream,context,node,player,socket,running=false,stopping=false,lastServer=0,watchdog,stoppedAck;
const status=text=>{$('status').textContent=text;};
async function request(path,body){
  const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!r.ok)throw Error(await r.text());return r.json();
}
async function devices(){
  try{
    const permission=await navigator.mediaDevices.getUserMedia({audio:true});permission.getTracks().forEach(t=>t.stop());
    const list=await navigator.mediaDevices.enumerateDevices();
    for(const [id,kind] of [['input','audioinput'],['output','audiooutput']]){
      $(id).replaceChildren();
      for(const d of list.filter(d=>d.kind===kind))$(id).add(new Option(d.label||'Audiogerät',d.deviceId));
    }
    $('start').disabled=!$('input').value||!$('output').value;
    status('Geräte geladen. Für den ersten Test Mikrofon und Kopfhörer auswählen.');
  }catch(e){status('Geräte nicht verfügbar: '+e.message);}
}
function silence(){
  clearInterval(watchdog);
  if(player){player.pause();player.srcObject=null;player.remove();player=null;}
  if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}
  if(context){context.close().catch(()=>{});context=null;}
  node=null;
}
function reset(){running=false;stopping=false;$('stop').disabled=true;$('start').disabled=false;$('devices').disabled=false;}
async function stop(reason='Gestoppt.'){
  if(stopping)return;stopping=true;
  // Immediately silence the Windows output, then drain the last partial recording frame.
  if(player)player.pause();if(stream)stream.getTracks().forEach(t=>t.stop());
  if(node){await Promise.race([new Promise(resolve=>{stoppedAck=resolve;node.port.postMessage({type:'stop'});}),new Promise(r=>setTimeout(r,200))]);}
  silence();status(reason+' Sprachsitzung wird beendet …');
  if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'stop'}));
  try{await request('/pc/stop',{});}catch{status(reason+' Server nicht erreichbar; automatische Verbindungskontrolle ist aktiv.');}
  const old=socket;
  setTimeout(()=>{if(old?.readyState===WebSocket.OPEN)old.close();},18000);
}
async function start(){
  if(running||!$('consent').checked){status('Bitte die Testaufnahme ausdrücklich bestätigen.');return;}
  running=true;stopping=false;$('start').disabled=true;$('devices').disabled=true;$('stop').disabled=false;
  try{
    if(!window.isSecureContext||!window.AudioWorkletNode||!HTMLMediaElement.prototype.setSinkId)throw Error('Bitte aktuelles Edge unter HTTPS verwenden.');
    stream=await navigator.mediaDevices.getUserMedia({audio:{deviceId:{exact:$('input').value},channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
    if(stopping){stream.getTracks().forEach(t=>t.stop());throw Error('Start abgebrochen.');}
    context=new AudioContext({sampleRate:24000});if(context.sampleRate!==24000)throw Error('24-kHz-Audiokontext nicht verfügbar.');
    await context.audioWorklet.addModule('/pc-audio-worklet.js');
    if(stopping)throw Error('Start abgebrochen.');
    node=new AudioWorkletNode(context,'pc-audio',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1]});
    const destination=context.createMediaStreamDestination();context.createMediaStreamSource(stream).connect(node);node.connect(destination);
    player=document.createElement('audio');player.srcObject=destination.stream;document.body.appendChild(player);
    await player.setSinkId($('output').value);if(stopping)throw Error('Start abgebrochen.');
    await context.resume();if(stopping)throw Error('Start abgebrochen.');
    await player.play();if(stopping)throw Error('Start abgebrochen.');
    node.port.onmessage=({data:m})=>{
      if(m.type==='pcm'&&socket?.readyState===WebSocket.OPEN){
        if(socket.bufferedAmount>128000){void stop('Audioverbindung zu langsam.');return;}
        socket.send(m.packet);
      }else if(m.type==='levels'){$('in-level').value=m.input;$('out-level').value=m.output;}
      else if(m.type==='error')void stop(m.reason);
      else if(m.type==='stopped')stoppedAck?.();
    };
    await request('/pc/start',{mode:'test',recording_consent:true});
    if(stopping)throw Error('Start abgebrochen.');
    socket=new WebSocket((location.protocol==='https:'?'wss:':'ws:')+'//'+location.host+'/pc/stream');
    const thisSocket=socket;
    socket.onmessage=({data})=>{
      if(socket!==thisSocket)return;
      lastServer=Date.now();const m=JSON.parse(data);
      if(m.type==='ready'){node?.port.postMessage({type:'start'});status('Test läuft · Beide Tonspuren werden privat aufgezeichnet.');}
      else if(m.type==='audio'&&!stopping){
        const bytes=Uint8Array.from(atob(m.pcm),c=>c.charCodeAt(0));node?.port.postMessage({type:'audio',generation:m.generation,pcm:bytes.buffer},[bytes.buffer]);
      }else if(m.type==='clear')node?.port.postMessage(m);
      else if(m.type==='stopped'){
        silence();status(m.status.provider_finalized?'Gestoppt · Sprachsitzung beendet. Abschrift wird erstellt.':'Audio gestoppt · Beendigung beim Sprachanbieter unbestätigt.');reset();
      }
    };
    socket.onclose=()=>{if(socket!==thisSocket)return;silence();if(running)status('Verbindung geschlossen. Aufnahme und Sitzungsstatus im Archiv prüfen.');reset();};
    socket.onerror=()=>{if(socket===thisSocket)void stop('Verbindungsfehler.');};
    lastServer=Date.now();watchdog=setInterval(()=>{if(Date.now()-lastServer>30000)void stop('Keine Serverantwort.');},1000);
    status('LUKAS wird mit dem privaten Demo-Kontext verbunden …');
  }catch(e){await stop('Start fehlgeschlagen: '+e.message);reset();}
}
$('devices').onclick=devices;$('start').onclick=start;$('stop').onclick=()=>stop();
window.addEventListener('pagehide',()=>{silence();socket?.close();});
navigator.mediaDevices?.addEventListener('devicechange',()=>{if(running)void stop('Audiogeräte haben sich geändert.');});
