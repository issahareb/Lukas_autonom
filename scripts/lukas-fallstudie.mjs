import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const args=process.argv.slice(2),flag=k=>args.includes(k),value=k=>{const i=args.indexOf(k);return i<0?undefined:args[i+1]};
const command=args[0]??'plan';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const plan=JSON.parse(await readFile(resolve(root,'docs/fallstudie/faelle.json'),'utf8'));
const base=new URL(process.env.LUKAS_BASE_URL??'https://lukas.issahareb.me');
if(base.origin!=='https://lukas.issahareb.me'&&!['localhost','127.0.0.1'].includes(base.hostname))throw new Error('LUKAS_BASE_URL must use the configured LUKAS host or local test server.');
const token=command==='report'?(process.env.LUKAS_USAGE_READ_TOKEN??process.env.LUKAS_API_TOKEN):process.env.LUKAS_API_TOKEN;
async function request(path,options={}){
 if(!token?.trim())throw new Error('Authenticated API credential missing; do not paste it into chat.');
 const r=await fetch(new URL(path,base),{redirect:'error',...options,headers:{Authorization:`Bearer ${token.trim()}`,'Content-Type':'application/json',...options.headers}});
 if(!r.ok)throw new Error(`LUKAS API returned HTTP ${r.status}`);return r;
}
async function save(path,data){if(!path)throw new Error('--out required');await mkdir(dirname(resolve(path)),{recursive:true});await writeFile(path,JSON.stringify(data,null,2)+'\n',{flag:'wx',mode:0o600});}
try{
 if(command==='plan'){console.log(JSON.stringify(plan,null,2));}
 else if(command==='report'){
  const q=new URLSearchParams();for(const k of ['von','bis','vergleichVon','vergleichBis'])if(value('--'+k))q.set(k,value('--'+k));
  const b=await(await request('/api/lukas/verbrauch/fallstudie'+(q.size?'?'+q:''))).json();
  const {nachweis,...data}=b;const hash=createHash('sha256').update(JSON.stringify(data,(_key,v)=>v && typeof v==='object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])) : v)).digest('hex');
  if(nachweis?.sha256!==hash)throw new Error('Evidence hash mismatch.');await save(value('--out'),b);
  console.log(JSON.stringify({saved:value('--out'),sha256:hash,aktuell:b.aktuell.zeitraum,vergleich:b.vergleich.map(v=>({kanal:v.kanal,art:v.aufgabenart,urteil:v.bewertung,gruende:v.gruende}))},null,2));
 }else if(command==='test'){
  const c=plan.faelle.find(c=>c.id===value('--case'));if(!c)throw new Error('Known --case required');
  if(!flag('--execute')){console.log(JSON.stringify({dryRun:true,case:c,serie:plan.serie,hint:'One task only. No API call. Paid run requires confirmed funding and separate budget supervision.'},null,2));}
  else{
   if(!flag('--funding-confirmed')||!flag('--supervised-budget'))throw new Error('Paid execution requires --funding-confirmed and --supervised-budget. No EUR cap can be inferred from tokens; verify tariffs/budget before each individual task.');
   if(!value('--out'))throw new Error('--out required before creating a paid task');
   // Create the destination exclusively before spending, so an existing artifact cannot be overwritten.
   await save(value('--out'),{status:'prepared',case:c.id});
   const conversation=await(await request('/api/anthropic/conversations',{method:'POST',body:JSON.stringify({title:`Fallstudie ${plan.serie}: ${c.id}`})})).json();
   let response;
   try{response=await request(`/api/anthropic/conversations/${conversation.id}/messages`,{method:'POST',body:JSON.stringify({content:c.prompt,fallstudie:{serie:plan.serie,fall:c.id,abnahme:c.abnahme}}),signal:AbortSignal.timeout(600000)});
    const raw=await response.text();const events=raw.split(/\r?\n/).filter(l=>l.startsWith('data: ')).map(l=>JSON.parse(l.slice(6)));
    const result={status:events.some(e=>e.done)?'response_received':'incomplete',createdAt:new Date().toISOString(),serie:plan.serie,case:c,conversationId:conversation.id,auftragId:response.headers.get('x-lukas-auftrag'),events};
    await writeFile(value('--out'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
    console.log(JSON.stringify({saved:value('--out'),conversationId:result.conversationId,auftragId:result.auftragId,status:result.status,acceptance:'not yet reviewed; response is not verified success'}));
   }catch(error){
    // Same stop action as the dashboard. No blind retry, which could duplicate paid work.
    await request(`/api/anthropic/conversations/${conversation.id}/stop`,{method:'POST'}).catch(()=>{});
    await writeFile(value('--out'),JSON.stringify({status:'interrupted',conversationId:conversation.id,auftragId:response?.headers.get('x-lukas-auftrag')??null,case:c.id})+'\n',{mode:0o600});throw error;
   }
  }
 }else if(command==='accept'){
  const id=value('--auftrag'),file=value('--evidence'),ergebnis=value('--result');
  if(!id||!file||!['erfolgreich','fehlgeschlagen'].includes(ergebnis))throw new Error('--auftrag, --evidence and --result erfolgreich/fehlgeschlagen required');
  const bytes=await readFile(file);const hash=createHash('sha256').update(bytes).digest('hex');
  const row=await(await request(`/api/lukas/verbrauch/auftraege/${encodeURIComponent(id)}/abnahme`,{method:'POST',body:JSON.stringify({ergebnis,pruefer:value('--reviewer')??'supervised-independent-review',beleg:`${file}; SHA-256 ${hash}`})})).json();
  console.log(JSON.stringify({acceptanceId:row.id,rootId:row.rootId,result:row.ergebnis,evidenceSha256:hash}));
 }else throw new Error('Commands: plan, report, test, accept');
}catch(e){console.error(e instanceof Error?e.message:'Failed');process.exitCode=1;}
