import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium} from 'playwright';
const root=resolve('artifacts/lukas-ui/dist/public');
const server=http.createServer(async(req,res)=>{
  try{let file=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!file.startsWith(root+'/'))file=resolve(root,'index.html');if(!extname(file))file=resolve(root,'index.html');
    const data=await readFile(file);res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.gif':'image/gif','.png':'image/png','.woff2':'font/woff2'})[extname(file)]??'application/octet-stream');res.end(data);
  }catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try{
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('lukas_token','local-browser-fixture'));
  let next=40,creates=0;const convos=[];const sent=[];
  await page.route('**/api/**',async route=>{
    const req=route.request(),u=new URL(req.url());let body={};
    if(/\/healthz?$/.test(u.pathname))body={status:'ok'};
    if(u.pathname.endsWith('/conversations')){
      if(req.method()==='POST'){creates++;body={id:++next,title:'Browsergespräch '+next,createdAt:new Date().toISOString(),messages:[]};convos.push(body);}
      else body=convos;
    }
    const match=u.pathname.match(/\/conversations\/(\d+)(\/messages)?$/);
    if(match){const c=convos.find(c=>c.id===Number(match[1]));if(!c)return route.fulfill({status:404,json:{error:'missing'}});
      if(match[2]){
        const content=req.postDataJSON().content;sent.push({id:c.id,content});
        if(content==='fixture offline')return route.fulfill({status:503,json:{error:'Senden im Test abgewiesen'}});
        c.messages.push({id:sent.length*2,role:'user',content,createdAt:new Date().toISOString()});
        const steps=content==='fixture frage'?[{tool:'frage_issa',input:'{}',ok:true,ms:1,result:JSON.stringify({surface:'lukas-rueckfrage',id:'fixture-question',conversationId:c.id,fragen:[{frage:'Welche Variante?',optionen:['Erste','Zweite']}]})}]:[];
        const answer={id:sent.length*2+1,role:'assistant',content:steps.length?'Welche Variante?':'Gespeicherte Testantwort',createdAt:new Date().toISOString(),steps};c.messages.push(answer);
        return route.fulfill({contentType:'text/event-stream',body:`${steps.map(step=>'data: '+JSON.stringify({step})+'\n\n').join('')}data: ${JSON.stringify({content:answer.content})}\n\ndata: {"done":true}\n\n`});
      }body=c;
    }
    if(u.pathname.includes('/attachments/'))body=[];
    if(u.pathname.endsWith('/wartet'))body={meldungen:[],freigaben:[],gesamt:{meldungen:0,freigaben:0}};
    return route.fulfill({json:body});
  });
  const base=`http://127.0.0.1:${server.address().port}`;
  await page.goto(base);await page.getByRole('textbox',{name:'Frage an Lukas'}).fill('Hero-Anfrage vollständig');await page.getByRole('button',{name:'Senden',exact:true}).click();
  await page.getByRole('textbox',{name:'Nachricht an Lukas'}).waitFor();await page.getByText('Gespeicherte Testantwort',{exact:true}).waitFor();
  assert.equal(creates,1);assert.equal(sent.length,1);assert.equal(sent[0].content,'Hero-Anfrage vollständig');
  const navigate=async label=>{await page.getByRole('button',{name:'Menü öffnen',exact:true}).click();await page.getByRole('dialog').getByRole('link',{name:label,exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});assert.notEqual(await page.evaluate(()=>document.body.style.pointerEvents),'none');};
  for(let i=0;i<5;i++)await navigate('Chat');
  await page.getByRole('textbox',{name:'Nachricht an Lukas'}).fill('Entwurf bleibt');await navigate('Übersicht');await navigate('Chat');
  assert.equal(await page.getByRole('textbox',{name:'Nachricht an Lukas'}).inputValue(),'Entwurf bleibt');
  await page.getByRole('textbox',{name:'Nachricht an Lukas'}).fill('fixture frage');await page.getByRole('button',{name:'Senden',exact:true}).click();
  await page.getByRole('dialog',{name:'Lukas hat eine Rückfrage'}).waitFor();await page.getByRole('radio',{name:'Zweite'}).check();
  const questionResponse=page.waitForResponse(r=>r.url().endsWith('/messages')&&r.request().method()==='POST'&&r.request().postDataJSON().content.includes('Antwort: Zweite'));
  await page.getByRole('button',{name:'Antwort senden'}).click();await questionResponse;await page.getByRole('dialog').waitFor({state:'hidden'});
  assert.equal(sent.at(-1).id,sent[0].id);assert.match(sent.at(-1).content,/Antwort: Zweite/);
  await page.getByRole('textbox',{name:'Nachricht an Lukas'}).fill('fixture offline');await page.getByRole('button',{name:'Senden',exact:true}).click();await page.getByText('Senden im Test abgewiesen',{exact:true}).waitFor();
  assert.equal(await page.getByRole('textbox',{name:'Nachricht an Lukas'}).inputValue(),'fixture offline');assert.deepEqual(errors,[]);
  console.log('PASS mobile browser: Hero creates/sends once, same-route menu closes, navigation unlocks, drafts survive routes, structured answers reach same chat and rejected sends preserve input. No model calls.');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
