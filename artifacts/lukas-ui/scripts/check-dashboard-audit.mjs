import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium} from 'playwright';

// Runs only against a loopback static build with intercepted synthetic API data.
// No provider, production API, real credentials, emails, calls or media requests.
const root=resolve('artifacts/lukas-ui/dist/public'),stamp='2026-11-10T12:00:00Z';
const results=[],unexpected=new Set();
const server=http.createServer(async(req,res)=>{
  try{let file=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
    if(!file.startsWith(root+'/')||!extname(file))file=resolve(root,'index.html');
    res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.png':'image/png','.gif':'image/gif','.woff2':'font/woff2'})[extname(file)]??'application/octet-stream');res.end(await readFile(file));
  }catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
let browser;
const check=async(name,fn)=>{const start=Date.now();try{await fn();results.push({name,ok:true,ms:Date.now()-start});console.log('PASS '+name);}catch(e){results.push({name,ok:false,ms:Date.now()-start,error:String(e.message).slice(0,1500)});console.log('FAIL '+name+': '+String(e.message).split('\n')[0]);}};
const status={mood:'focused',energy:'normal',obsession:'Synthetic audit',note:'',activeGoalsCount:0,memoriesCount:0,lastActive:stamp};
async function fixture(viewport,fail=[]){
  const context=await browser.newContext({viewport});
  await context.addInitScript(()=>localStorage.setItem('lukas_token','synthetic-local-audit'));
  const page=await context.newPage(),errors=[],writes=[];
  page.on('pageerror',e=>errors.push(e.message));
  const memories=[],goals=[];let next=100;
  await page.route('**/api/**',async route=>{
    const req=route.request(),u=new URL(req.url()),path=u.pathname,method=req.method();let data;
    if(method!=='GET')writes.push({path,method,body:req.postDataJSON()});
    if(fail.some(s=>path.endsWith(s)))return route.fulfill({status:503,json:{error:'Synthetic service unavailable'}});
    if(path==='/api/healthz'||path==='/api/readyz')data={status:'ok'};
    else if(path==='/api/lukas/status')data=status;
    else if(path==='/api/lukas/dashboard')data={status,recentDiary:[],recentMemories:[],activeGoals:[],mediaJobs:[],recentEmotions:[],character:null};
    else if(path==='/api/lukas/memories'){
      if(method==='POST'){data={...req.postDataJSON(),id:++next,createdAt:stamp};memories.push(data);}
      else data=memories.filter(m=>!u.searchParams.get('search')||m.content.includes(u.searchParams.get('search')));
    }else if(/^\/api\/lukas\/memories\/\d+$/.test(path)){const i=memories.findIndex(m=>m.id===Number(path.split('/').at(-1)));if(method==='DELETE'&&i>=0)memories.splice(i,1);return route.fulfill({status:204});}
    else if(path==='/api/lukas/goals'){
      if(method==='POST'){data={...req.postDataJSON(),id:++next,status:'active',progress:'',createdAt:stamp,updatedAt:stamp};goals.push(data);}else data=goals;
    }else if(/^\/api\/lukas\/goals\/\d+$/.test(path)){const i=goals.findIndex(g=>g.id===Number(path.split('/').at(-1)));if(method==='DELETE'){goals.splice(i,1);return route.fulfill({status:204});}data=Object.assign(goals[i],req.postDataJSON());}
    else if(path==='/api/lukas/diary')data=[{id:1,content:'Synthetic diary entry',mood:'focused',energy:'normal',createdAt:stamp}];
    else if(['/api/lukas/approvals','/api/lukas/proposals','/api/lukas/meldungen','/api/lukas/debug-log','/api/higgsfield/jobs','/api/anthropic/conversations'].includes(path))data=[];
    else if(path==='/api/lukas/wartet')data={meldungen:[],freigaben:[],gesamt:{meldungen:0,freigaben:0}};
    else if(path==='/api/lukas/mcp')data={servers:[],callbackUrl:''};
    else if(path==='/api/lukas/zugaenge')data={bereit:true,zugaenge:[]};
    else if(path==='/api/lukas/telefon')data={nummern:[],anrufe:[],anbieter:'telnyx',bereit:{webhook:true,anrufen:true}};
    else if(path==='/api/telefon/anfragen')data={rows:[],total:0,limit:20,offset:0};
    else if(path.includes('rueckruf'))data=[];
    else if(path==='/api/lukas/gehirn')data={stand:stamp,zahlen:{},knoten:[],kanten:[]};
    else if(path==='/api/lukas/kennzahlen')data={reihe:[],auffaelligkeiten:[],jetzt:{freigabenOffen:0,meldungenOffen:0},schlechtesteWerkzeuge:[]};
    else if(path==='/api/lukas/verbrauch')data={stand:stamp,tageswerte:[],modelle:[],liveModelle:[],guthaben:null};
    else if(path==='/api/lukas/websites/analytics')data={site:'hareb.digital',days:7,fetchedAt:stamp,summary:{active:0,sessions:0,views:0,seconds:0,depth:0},pages:[],clicks:[],sections:[],scroll:[],forms:[],devices:[],referrers:[],exits:[],recent:[]};
    else if(path==='/api/lukas/websites/stream')return route.fulfill({status:503,json:{error:'Synthetic stream unavailable'}});
    else if(path.includes('/verbrauch/fallstudie')||path.includes('/taxibb/analytics'))return route.fulfill({status:503,json:{error:'Synthetic analytics unavailable'}});
    else if(path==='/api/higgsfield/models')data={image:[],video:[]};
    else {unexpected.add(path);return route.fulfill({status:404,json:{error:'Unspecified audit fixture'}});}
    return route.fulfill({json:data});
  });
  // Block any external requests even if a component tries an unexpected service.
  await page.route(url=>new URL(url).origin!==base,route=>route.abort());
  return {context,page,errors,writes};
}
const routes=[['/','Was bewegen wir heute?'],['/chat','Gespräche'],['/memory','Gedächtnis'],['/goals','Ziele'],['/diary','Tagebuch'],['/studio','Studio'],['/approvals','Freigaben'],['/meldungen','Meldungen'],['/proposals','Vorschläge'],['/mcp','Verbindungen'],['/telefon','Telefon'],['/telefonanfragen','Telefonanfragen'],['/gehirn','Gehirn'],['/kennzahlen','Kennzahlen'],['/zugaenge','Zugänge'],['/diagnostics','Diagnose']];
try{
  browser=await chromium.launch({headless:true,executablePath:process.env.AUDIT_CHROMIUM||undefined,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  for(const viewport of [{width:390,height:844},{width:1440,height:1000}])for(const [path,title] of routes){
    await check(`${viewport.width}px ${path}`,async()=>{const f=await fixture(viewport);try{
      await f.page.goto(base+path);
      if(title)await f.page.getByRole('heading',{level:1,name:title,exact:true}).waitFor({timeout:10000});
      else await f.page.getByRole('textbox',{name:'Nachricht an Lukas'}).waitFor({timeout:10000});
      await f.page.waitForTimeout(250);
      assert.deepEqual(f.errors,[],'No uncaught browser errors');
      assert.ok(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'No horizontal document overflow');
    }finally{await f.context.close();}});
  }
  await check('memory create/search/delete (synthetic)',async()=>{const f=await fixture({width:390,height:844});try{
    await f.page.goto(base+'/memory');await f.page.getByRole('button',{name:'Neue Erinnerung'}).click();await f.page.getByPlaceholder('Was soll Lukas wissen?').fill('AUDIT synthetic memory');await f.page.getByRole('button',{name:'Speichern',exact:true}).click();await f.page.getByText('AUDIT synthetic memory',{exact:true}).waitFor();
    await f.page.getByLabel('Erinnerungen durchsuchen',{exact:true}).fill('unmatched');await f.page.getByText('Nichts gefunden',{exact:true}).waitFor();await f.page.getByLabel('Erinnerungen durchsuchen',{exact:true}).fill('');await f.page.getByRole('button',{name:'Erinnerung löschen'}).click();await f.page.getByText('AUDIT synthetic memory',{exact:true}).waitFor({state:'hidden'});assert.equal(f.writes.filter(w=>w.method==='POST').length,1);
  }finally{await f.context.close();}});
  await check('goal create/complete/delete (synthetic)',async()=>{const f=await fixture({width:1440,height:1000});try{
    await f.page.goto(base+'/goals');await f.page.getByRole('button',{name:'Neues Ziel'}).click();await f.page.getByPlaceholder('Worum geht es?').fill('AUDIT synthetic goal');await f.page.getByPlaceholder('Was genau ist das Ziel? Warum ist es wichtig?').fill('Only fixture data');await f.page.getByRole('button',{name:'Ziel setzen',exact:true}).click();await f.page.getByRole('heading',{name:'AUDIT synthetic goal'}).waitFor();
    const card=f.page.locator('.card-soft').filter({has:f.page.getByRole('heading',{name:'AUDIT synthetic goal'})});
    const changed=f.page.waitForResponse(r=>r.url().includes('/goals/')&&r.request().method()!=='GET');await card.getByRole('button',{name:'Erledigt',exact:true}).click();await changed;
    assert.ok(f.writes.some(w=>w.body?.status==='completed'));await f.page.getByRole('button',{name:'Ziel „AUDIT synthetic goal“ löschen'}).click();await f.page.getByRole('heading',{name:'AUDIT synthetic goal'}).waitFor({state:'hidden'});
  }finally{await f.context.close();}});
  for(const [path,suffix,message] of [['/memory','/memories','Die Erinnerungen konnten nicht geladen werden.'],['/goals','/goals','Die Ziele konnten nicht geladen werden.'],['/diary','/diary','Das Tagebuch konnte nicht geladen werden.'],['/studio','/jobs','Die Medienaufträge konnten nicht geladen werden.'],['/zugaenge','/zugaenge','Die Zugänge konnten nicht geladen werden.']]){
    await check(`503 is visible ${path}`,async()=>{const f=await fixture({width:390,height:844},[suffix]);try{await f.page.goto(base+path);await f.page.getByText(message,{exact:true}).waitFor({timeout:12000});assert.deepEqual(f.errors,[]);}finally{await f.context.close();}});
  }
}finally{
  await browser?.close();await new Promise(r=>server.close(r));
  const output=process.env.AUDIT_REPORT??'/tmp/lukas-dashboard-audit.json';await writeFile(output,JSON.stringify({mode:'isolated-browser-fixtures',production:false,modelCalls:0,results,unexpectedApiPaths:[...unexpected]},null,2));
  console.log(JSON.stringify({passed:results.filter(r=>r.ok).length,failed:results.filter(r=>!r.ok).length,unexpected:[...unexpected],output}));
  if(results.some(r=>!r.ok)||unexpected.size)process.exitCode=1;
}
