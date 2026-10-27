import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { startProxy } from './proxy.mjs';
import { createEngine } from './engine.mjs';

export async function startServer({ token = process.env.LUKAS_BROWSER_TOKEN, port = Number(process.env.PORT || 8080), dataDir = process.env.BROWSER_DATA_DIR || '/data', engine: supplied } = {}) {
  if (!token || token.length < 32) throw new Error('LUKAS_BROWSER_TOKEN with at least 32 characters is required.');
  await mkdir(dataDir + '/uploads', {recursive:true,mode:0o700});
  const proxy = supplied ? null : await startProxy();
  const engine = supplied || createEngine(proxy.address().port,dataDir);
  await engine.ready(); // health only becomes green after a real Chromium/JS start
  const server = http.createServer(async (req,res) => {
    res.setHeader('Content-Type','application/json'); res.setHeader('Cache-Control','no-store');
    const reply=(code,data)=>{res.writeHead(code);res.end(JSON.stringify(data));};
    if(req.method==='GET' && req.url==='/healthz') return reply(200,{status:'ok',browser:'chromium',backend:'railway'});
    const got=Buffer.from(req.headers.authorization || ''); const expected=Buffer.from('Bearer '+token);
    if(got.length!==expected.length || !timingSafeEqual(got,expected)) return reply(401,{ok:false,fehler:'Unauthorized'});
    const operation={'/render':'render','/operate':'operate','/search':'search'}[req.url];
    if(req.method!=='POST'||!operation) return reply(404,{ok:false});
    try {
      let bytes=0;const chunks=[];
      for await(const chunk of req){bytes+=chunk.length;if(bytes>128*1024)return reply(413,{ok:false,fehler:'Auftrag zu groß.'});chunks.push(chunk);}
      const input=JSON.parse(Buffer.concat(chunks).toString());
      if(!input||typeof input!=='object'||Array.isArray(input)) return reply(400,{ok:false});
      const result=await engine.run(operation,input);
      reply(200,result);
    } catch {reply(400,{ok:false,fehler:'Ungültiger oder derzeit nicht ausführbarer Browserauftrag.'});}
  });
  server.requestTimeout=180000;
  await new Promise(resolve=>server.listen(port,'::',resolve));
  return {server, async close(){await engine.close();await new Promise(resolve=>server.close(resolve));if(proxy)await new Promise(resolve=>proxy.close(resolve));}};
}
if(import.meta.url===pathToFileURL(process.argv[1] || '').href){
  const app=await startServer();
  console.log(JSON.stringify({event:'browser_ready',backend:'railway',chromium:true}));
  for(const signal of ['SIGTERM','SIGINT']) process.on(signal,()=>{void app.close().then(()=>process.exit(0));setTimeout(()=>process.exit(1),10000).unref();});
}
