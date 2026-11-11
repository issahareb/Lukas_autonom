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
    else if(path==='/api/telefon/anfragen')data={rows:[{id:21,nummer:'4915100000001',status:'neu',kategorie:'sonstiges',weitergabe:'offen',auswertung:'fertig',zusammenfassung:'Anbieter möchte den kostenlosen Firmeneintrag abgleichen.',details:{unternehmen:'Beispielanbieter',ergebnis:'Firmenadresse bestätigt.',naechsteSchritte:'Unterlagen per E-Mail anfordern.'},notiz:'',email_status:'ausstehend',created_at:stamp,updated_at:stamp,beendet_am:stamp},{id:20,nummer:'',status:'neu',kategorie:'unklar',weitergabe:'offen',auswertung:'fertig',zusammenfassung:'',details:{},notiz:'',email_status:'ausstehend',created_at:stamp,updated_at:stamp}],total:2};
    else if(path.includes('rueckruf'))data=[];
    else if(path==='/api/lukas/gehirn')data={stand:stamp,zahlen:{},knoten:[{id:'identity',art:'identitaet',titel:'Lukas',text:'Synthetischer Test',gewicht:1,daten:{}},{id:'memory',art:'erinnerung',titel:'Testnotiz',text:'Gesprächsnotiz',gewicht:.5,daten:{}},{id:'goal',art:'ziel',titel:'Testziel',text:'Helle Oberflächen',gewicht:.5,daten:{}}],kanten:[{von:'identity',nach:'memory',art:'kennt',gewicht:.7},{von:'memory',nach:'goal',art:'verbindet',gewicht:.7}]};
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

const luminance = color => {
  const rgb=color.match(/[\d.]+/g)?.slice(0,3).map(Number);
  if(!rgb||rgb.length!==3)throw Error('Unexpected computed colour: '+color);
  return rgb.reduce((sum,v,i)=>{v/=255;return sum+[.2126,.7152,.0722][i]*(v<=.04045?v/12.92:((v+.055)/1.055)**2.4)},0);
};
const output=process.env.CREAM_REPORT??'/tmp/lukas-cream-dashboard.json';
const shots=process.env.CREAM_SCREENSHOTS;
try{
  browser=await chromium.launch({headless:true,executablePath:process.env.AUDIT_CHROMIUM||undefined,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  if(shots)await mkdir(shots,{recursive:true});
  for(const viewport of [{width:390,height:844},{width:1440,height:1000}])for(const [path,title] of routes){
    await check(`${viewport.width}px ${path}`,async()=>{const f=await fixture(viewport);try{
      await f.page.goto(base+path);
      await f.page.getByRole('heading',{level:1,name:title,exact:true}).waitFor({timeout:15000});
      await f.page.waitForTimeout(250);
      assert.deepEqual(f.errors,[],'No uncaught browser errors');
      assert.ok(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'No horizontal document overflow');
      const styles=await f.page.evaluate(()=>{
        const css=el=>({selector:el.className,background:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color});
        return {shell:css(document.querySelector('.app-shell')),cards:[...document.querySelectorAll('.workspace-page .card-soft,.workspace-stat,.gehirn-main,.gehirn-view-switch')].map(css),scheme:getComputedStyle(document.documentElement).colorScheme};
      });
      assert.equal(styles.scheme,'light');
      assert.ok(luminance(styles.shell.background)>.7,'Paper shell');
      for(const card of styles.cards){
        assert.ok(luminance(card.background)>.7,'Light panel '+card.selector);
        assert.ok((luminance(card.background)+.05)/(luminance(card.color)+.05)>=4.5,'Readable panel text '+card.selector);
      }
      if(path==='/telefonanfragen'){
        await f.page.getByText('Anbieter möchte den kostenlosen Firmeneintrag abgleichen.').waitFor();
        await f.page.getByText('Firmenadresse bestätigt.').waitFor();
        await f.page.getByText('Unterlagen per E-Mail anfordern.').waitFor();
        await f.page.getByText(/Für diesen Anruf ist keine Gesprächsnotiz gespeichert/).waitFor();
        const select=f.page.getByLabel('Anfragen nach Status filtern');
        assert.ok(luminance(await select.evaluate(el=>getComputedStyle(el).backgroundColor))>.7,'Native select is light');
        if(shots)await f.page.screenshot({path:resolve(shots,`telefonanfragen-${viewport.width}.png`)});
      }
      if(path==='/gehirn'){
        await f.page.locator('.gehirn-canvas canvas').waitFor();
        if(shots)await f.page.screenshot({path:resolve(shots,`gehirn-${viewport.width}.png`)});
      }
      if(path==='/memory'){
        await f.page.getByRole('button',{name:'Neue Erinnerung'}).click();
        const dialog=f.page.getByRole('dialog');await dialog.waitFor();
        const bg=await dialog.evaluate(el=>getComputedStyle(el).backgroundColor);
        assert.ok(luminance(bg)>.7,'Portalled dialog is light');
        await f.page.getByPlaceholder('Was soll Lukas wissen?').fill('Nur lokaler visueller Test');
        if(shots)await f.page.screenshot({path:resolve(shots,`dialog-${viewport.width}.png`)});
        await f.page.keyboard.press('Escape');
      }
    }finally{await f.context.close();}});
  }
}finally{
  await browser?.close();await new Promise(r=>server.close(r));
  await writeFile(output,JSON.stringify({mode:'isolated-browser-fixtures',production:false,modelCalls:0,results,unexpectedApiPaths:[...unexpected]},null,2));
  console.log(JSON.stringify({passed:results.filter(r=>r.ok).length,failed:results.filter(r=>!r.ok).length,unexpected:[...unexpected],output}));
  if(results.some(r=>!r.ok)||unexpected.size)process.exitCode=1;
}
