import { build } from 'esbuild';
import ts from 'typescript';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Extract declarations from the actual files, rather than copying tool schemas
// or implementing a second request serializer just for the benchmark.
function declaration(source, name) {
  const ast=ts.createSourceFile('source.ts',source,ts.ScriptTarget.Latest,true);
  for(const node of ast.statements){
    if(ts.isFunctionDeclaration(node)&&node.name?.text===name) return node.getText(ast);
    if(ts.isVariableStatement(node)) for(const d of node.declarationList.declarations)
      if(d.name.getText(ast)===name) return `export const ${name} = ${d.initializer.getText(ast)};`;
  }
  throw new Error('Missing source declaration: '+name);
}
export async function toolHarness({baselineRef,live=false}={}) {
  const dir=mkdtempSync(resolve('.tool-harness-'));
  const pinned=baselineRef==='0f7e3a0'?JSON.parse(readFileSync('bench/baselines/tool-routing-0f7e3a0.json','utf8')):undefined;
  const fromRepo=path=>pinned?pinned.files[path]:baselineRef?execFileSync('git',['show',`${baselineRef}:artifacts/api-server/${path}`],{encoding:'utf8'}):readFileSync(path,'utf8');
  const toolsSource=fromRepo('src/lib/lukas-tools.ts');
  // Compare selection algorithms using one current schema catalogue. Prompt
  // edits must not invalidate the historical selector or skew byte savings.
  // Keep the pinned source intact for the baseline selection/loading logic.
  const schemaSource=readFileSync('src/lib/lukas-tools.ts','utf8');
  writeFileSync(join(dir,'selection.ts'),fromRepo('src/lib/werkzeug-auswahl.ts'));
  const external=join(dir,'external.mjs');
  writeFileSync(external,`
    ${live?`import {openai as provider} from ${JSON.stringify(resolve('../../lib/integrations-openai-ai/src/client.ts'))};`:''}
    export const logger={info(){},warn(){},error(){},debug(){}};
    export const db={}; export const approvals={};
    export const isIsolatedBackend=()=>true; export const isLinkFromEmail=()=>false;
    export const hatAktivenAuftrag=()=>true; export const mitVerbrauchsAuftrag=(_q,_id,fn)=>fn();
    export const merkeProviderBeleg=()=>{}; export const hatAufrufMessung=()=>true; export const bucheEinzelBeleg=()=>{};
    export const messeModellAufruf=(_input,_phase,fn)=>fn(); export const merkeAufrufUsage=()=>{}; export const merkeToolSchema=()=>{};
    export const verbucheTag=async()=>{};
    export const openai={responses:{create:async(request,opts)=>{
      globalThis.__toolBenchRequests??=[];globalThis.__toolBenchRequests.push(request);
      ${live?'return provider.responses.create(request,opts);':`return {output:[],output_text:'offline',status:'completed'};`}
    }}};
  `);
  const entry=join(dir,'entry.ts');
  writeFileSync(entry,`
    import {waehleWerkzeuge} from './selection';
    import {policyHinweis,setMcpRiskTiers} from '../src/lib/policy';
    import {ordneMcpWerkzeuge} from '../src/lib/mcp-auswahl';
    const MCP_TOOL_PREFIX='mcp__'; const MCP_TOOLS_PER_SERVER=18;
    const activeServers=async()=>globalThis.__toolBenchServers??[];
    const logger={info(){},warn(){}};
    ${['LUKAS_TOOLS','sanitizeToolSchema','mitPolicyHinweis','allLukasTools','mcpFindTool'].map(n=>declaration(n==='LUKAS_TOOLS'?schemaSource:toolsSource,n)).join('\n')}
    export {waehleWerkzeuge};
    export {riskFor} from '../src/lib/policy';
    export * from '../src/lib/ai/model-client';
    export * from '../src/lib/ai/model-router';
    export * from '../src/lib/tool-batch';
  `);
  const outfile=join(dir,'harness.mjs');
  await build({entryPoints:[entry],outfile,bundle:true,format:'esm',platform:'node',packages:'external',logLevel:'silent',
    alias:{'@workspace/db':external,'@workspace/integrations-openai-ai':external},plugins:[{name:'isolated-external-systems',setup(b){
      b.onResolve({filter:/(^|\/)(logger|code-sandbox|email|verbrauch-auftrag|tagesbudget)$/},()=>({path:external}));
    }}]});
  return {dir,api:await import(pathToFileURL(outfile))};
}
