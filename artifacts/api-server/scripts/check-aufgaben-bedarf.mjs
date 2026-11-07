import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=mkdtempSync(join(tmpdir(),'lukas-bedarf-'));
try {
  await build({entryPoints:['src/lib/aufgaben-bedarf.ts','src/lib/werkzeug-auswahl.ts','src/lib/lukas-prompt-auswahl.ts'],outdir:dir,bundle:true,platform:'node',format:'esm',outExtension:{'.js':'.mjs'},logLevel:'silent'});
  const {istAntwortEntwurf}=await import(pathToFileURL(join(dir,'aufgaben-bedarf.mjs')));
  const {waehleWerkzeuge}=await import(pathToFileURL(join(dir,'werkzeug-auswahl.mjs')));
  const {waehleLukasPrompt,LUKAS_PROMPT_KERN}=await import(pathToFileURL(join(dir,'lukas-prompt-auswahl.mjs')));
  const names=['mcp_find_tool','mcp_call','query_memory','create_goal','update_goal','email_read','email_search','email_send','telefon_kontakte','telefon_status','ruf_an','plane_rueckruf','fetch_url','github_read_path','github_list_repos','execute_command','read_usage'];
  const tools=names.map(name=>({type:'function',function:{name,parameters:{type:'object'}}}));
  const drafts=[
    'Erstelle zwei Vorlagen für eine neue Website-Anfrage eines Handwerksbetriebs: E-Mail und Projektbrief. Rückrufformular, Budget und Termin klären. Nur Entwürfe erstellen, nicht versenden.',
    'Erstelle einen Übergabevermerk aus diesem fiktiven Kundengespräch. Gewünscht ist ein Rückrufformular. Nur hier antworten, keine Ziele anlegen, nichts speichern oder versenden.',
    'Schreibe eine JavaScript-Funktion. Liefere Tests. Nur hier im Chat antworten, keine Dateien oder Ziele anlegen, keine externen Systeme ändern.',
    'Analysiere synthetische Beispieldaten mit Tokens und Aufgaben. Nichts veröffentlichen oder versenden. Liefere das Ergebnis direkt hier im Chat.',
  ];
  for(const task of drafts){
    assert.equal(istAntwortEntwurf(task),true,task);
    assert.deepEqual(waehleWerkzeuge(tools,task).map(t=>t.function.name),['mcp_find_tool','mcp_call','query_memory']);
    const p=waehleLukasPrompt(task);
    assert.equal(p.stabil,LUKAS_PROMPT_KERN,'entire core remains byte-identical');
    assert.deepEqual(p.module,['antwort-entwurf']);
    assert.match(p.dynamisch,/kein Ziel/);
    assert.match(p.dynamisch,/Freigaben/);
  }
  const actions=[
    ['Schreibe eine E-Mail an einen Kunden','email_send','email'],
    ['Lies mein E-Mail-Postfach','email_read','email'],
    ['Rufe einen Kontakt an','ruf_an','telefon'],
    ['Ruf mich in fünf Minuten zurück','plane_rueckruf','telefon'],
    ['Implementiere einen Cache im TypeScript Repo','execute_command','code'],
    ['Erstelle eine Vorlage und sende sie an den Kunden','mcp_find_tool',null],
    ['Erstelle eine Vorlage und veröffentliche sie','mcp_find_tool',null],
    ['Erstelle eine Vorlage im Repository','github_read_path','code'],
    ['Recherchiere aktuelle Quellen und erstelle eine Vorlage','mcp_find_tool','web'],
    ['Erstelle eine Vorlage und speichere sie','mcp_find_tool',null],
    ['Erstelle eine Vorlage für https://example.com','fetch_url','web'],
    ['Erstelle eine Vorlage und führe die Tests aus','mcp_find_tool',null],
    ['Erstelle eine Vorlage und lege sie im Kundenordner ab','mcp_find_tool',null],
    ['Erstelle eine Vorlage in /tmp/template.md','mcp_find_tool',null],
    ['Erstelle eine Vorlage anhand meiner letzten E-Mails','email_read','email'],
  ];
  for(const [task,tool,module] of actions){
    assert.equal(istAntwortEntwurf(task),false,task);
    assert.ok(waehleWerkzeuge(tools,task).some(t=>t.function.name===tool),task);
    if(module)assert.ok(waehleLukasPrompt(task).module.includes(module),task);
  }
  assert.equal(istAntwortEntwurf('weiter'),false);
  assert.equal(istAntwortEntwurf(''),false);
  assert.equal(istAntwortEntwurf('Erstelle eine Vorlage. '+'x'.repeat(6000)),false);
  for(const task of ['Gib nach zehn Modellaufrufen die Analyse zurück.','Implementiere eine JavaScript-Funktion, die einen Wert zurückgibt.','Baue ein Kontaktformular auf der Website.']){
    assert.ok(!waehleLukasPrompt(task).module.includes('telefon'),task);
    assert.ok(!waehleWerkzeuge(tools,task).some(t=>t.function.name==='telefon_kontakte'),task);
    assert.ok(!waehleWerkzeuge(tools,task).some(t=>t.function.name==='plane_rueckruf'),task);
  }
  console.log(`OK: ${drafts.length} Antwortfälle, ${actions.length} echte/mehrdeutige Aktionsfälle; Kern unverändert, Memory/Discovery erhalten.`);
} finally {rmSync(dir,{recursive:true,force:true});}
