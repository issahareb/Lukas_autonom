import { Router } from 'express';
import { EventEmitter } from 'node:events';
import { pool } from '@workspace/db';
import { gleicherToken } from '../middlewares/schutz';
import { websiteBatch } from '../lib/website-event-schema';

const router=Router(), changes=new EventEmitter();changes.setMaxListeners(100);
let retentionAt=0;
router.post("/public/website-events",async(req,res)=>{
  const parsed=websiteBatch.safeParse(req.body);
  if(!parsed.success)return void res.status(400).json({error:'Invalid events'});
  const b=parsed.data, expected=b.site==='hareb.digital'?process.env.HAREB_ACTIVITY_WRITE_TOKEN:process.env.PORTFOLIO_ACTIVITY_WRITE_TOKEN;
  if(!expected||!gleicherToken(req.get('x-activity-token'),expected))return void res.status(401).end();
  if(b.events.some(e=>e.at<Date.now()-86400000||e.at>Date.now()+60000))return void res.status(400).end();
  try{
    const values:unknown[]=[];
    const rows=b.events.map(e=>{const n=values.length;values.push(b.site,e.id,b.session,b.page,b.path,e.event,new Date(e.at),JSON.stringify(e.data));return '('+Array.from({length:8},(_,i)=>'$'+(n+i+1)).join(',')+')'});
    const result=await pool.query('INSERT INTO lukas_website_events (site,id,session,page,path,event,occurred_at,data) VALUES '+rows.join(',')+' ON CONFLICT (site,id) DO NOTHING',values);
    if(result.rowCount)changes.emit('change',b.site);
    if(Date.now()-retentionAt>3600000){retentionAt=Date.now();void pool.query("DELETE FROM lukas_website_events WHERE received_at < now()-interval '90 days'").catch(()=>{retentionAt=0})}
    res.status(202).json({accepted:result.rowCount});
  }catch{res.status(503).json({error:'Storage unavailable'})}
});

router.get("/lukas/websites/stream",(req,res)=>{
  res.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no'});res.flushHeaders();
  const send=(site:string)=>res.write('data: '+JSON.stringify({site})+'\n\n');send('connected');changes.on('change',send);
  const timer=setInterval(()=>res.write(': keepalive\n\n'),15000);
  req.on('close',()=>{clearInterval(timer);changes.off('change',send)});
});

router.get("/lukas/websites/analytics",async(req,res)=>{
  const site=String(req.query.site||'hareb.digital'),days=Number(req.query.days||7);
  if(!['hareb.digital','issahareb.me'].includes(site)||![1,7,30,90].includes(days))return void res.status(400).end();
  const prefix="WITH e AS (SELECT * FROM lukas_website_events WHERE site=$1 AND received_at >= now()-($2::int * interval '1 day')) ";
  const query=async(sql:string)=>(await pool.query(prefix+sql,[site,days])).rows;
  res.set('Cache-Control','no-store');
  try{
    const [summary,pages,clicks,sections,scroll,forms,recent,devices,referrers,exits]=await Promise.all([
      query(`, p AS (SELECT session,page,max(coalesce((data->>'seconds')::float,0)) seconds,max(coalesce((data->>'depth')::float,0)) depth FROM e WHERE event IN ('engagement','page_exit') GROUP BY session,page), s AS (SELECT session,sum(seconds) seconds FROM p GROUP BY session) SELECT (SELECT count(DISTINCT session) FROM e) sessions,(SELECT count(*) FROM e WHERE event='page_view') views,(SELECT count(DISTINCT session) FROM e WHERE received_at>now()-interval '30 seconds' AND event IN ('page_view','engagement')) active,coalesce((SELECT avg(seconds) FROM s),0) seconds,coalesce((SELECT avg(depth) FROM p),0) depth`),
      query(`SELECT path,count(*) views,count(DISTINCT session) visits FROM e WHERE event='page_view' GROUP BY path ORDER BY views DESC LIMIT 100`),
      query(`SELECT path,data->>'section' section,data->>'target' target,data->>'destination' destination,count(*) clicks,count(DISTINCT session) visits FROM e WHERE event='click' GROUP BY 1,2,3,4 ORDER BY clicks DESC LIMIT 150`),
      query(`SELECT path,data->>'section' section,count(DISTINCT page) FILTER(WHERE event='section_view') views,coalesce(sum((data->>'seconds')::float) FILTER(WHERE event='section_time'),0) seconds FROM e WHERE event IN ('section_view','section_time') GROUP BY 1,2 ORDER BY seconds DESC LIMIT 150`),
      query(`SELECT path,data->>'section' section,floor((data->>'depth')::float/5)*5 depth,count(*) stops,count(DISTINCT page) pages FROM e WHERE event='scroll_stop' GROUP BY 1,2,3 ORDER BY stops DESC LIMIT 150`),
      query(`, f AS (SELECT session,path,data->>'target' target,data->>'form' form,bool_or(event='form_start') started,bool_or(event='form_success') success,count(*) FILTER(WHERE event='form_attempt') attempts,count(*) FILTER(WHERE event IN ('form_error','form_invalid')) errors,(array_agg(data->>'field' ORDER BY occurred_at DESC,(data->>'order')::int DESC) FILTER(WHERE coalesce(data->>'field','')<>''))[1] field FROM e WHERE event LIKE 'form_%' GROUP BY 1,2,3,4), last_seen AS (SELECT session,max(received_at) at FROM e GROUP BY session) SELECT f.path,f.target,count(*) FILTER(WHERE started) starts,sum(attempts) attempts,count(*) FILTER(WHERE success) successes,sum(errors) errors,count(*) FILTER(WHERE started AND NOT success AND at<now()-interval '30 minutes') abandoned,count(*) FILTER(WHERE started AND NOT success AND at>=now()-interval '30 minutes') pending,array_agg(field) FILTER(WHERE started AND NOT success AND at<now()-interval '30 minutes') fields FROM f JOIN last_seen USING(session) GROUP BY 1,2 ORDER BY starts DESC`),
      query(`SELECT event,path,occurred_at at,left(session,8) visit,data FROM e WHERE event NOT IN ('engagement','section_time') ORDER BY occurred_at DESC,(data->>'order')::int DESC LIMIT 80`),
      query(`SELECT data->>'device' device,count(DISTINCT session) visits FROM e WHERE event='page_view' GROUP BY 1 ORDER BY visits DESC`),
      query(`SELECT coalesce(nullif(data->>'referrer',''),'Direkt / unbekannt') referrer,count(DISTINCT session) visits FROM e WHERE event='page_view' GROUP BY 1 ORDER BY visits DESC LIMIT 50`),
      query(`, last_seen AS (SELECT session,max(received_at) at FROM e GROUP BY session), last_page AS (SELECT DISTINCT ON (session) session,path,data FROM e WHERE event IN ('page_exit','engagement') ORDER BY session,occurred_at DESC,(data->>'order')::int DESC) SELECT path,data->>'section' section,count(*) exits,avg(coalesce((data->>'currentDepth')::float,(data->>'depth')::float)) depth FROM last_page JOIN last_seen USING(session) WHERE at<now()-interval '30 minutes' GROUP BY 1,2 ORDER BY exits DESC LIMIT 100`)
    ]);
    res.json({site,days,fetchedAt:new Date().toISOString(),summary:summary[0],pages,clicks,sections,scroll,forms,recent,devices,referrers,exits});
  }catch{res.status(503).json({error:'Analytics unavailable'})}
});
export default router;
