import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = await mkdtemp(join(tmpdir(), 'public-brain-'));
try {
  const out = join(dir, 'projection.mjs');
  await build({ entryPoints: ['src/lib/public-brain.ts'], outfile: out, bundle: true, platform: 'node', format: 'esm' });
  const { publicBrain } = await import(pathToFileURL(out).href);
  const node = (id, art, gewicht) => ({ id, art, gewicht, titel: 'PRIVATE title', text: 'PRIVATE memory', daten: { token: 'PRIVATE token' }, datei: 'PRIVATE path', ordner: 'PRIVATE folder', extra: 'PRIVATE extra' });
  const graph = { stand: 'PRIVATE timestamp', zahlen: { private: 42 }, knoten: [node('PRIVATE owner', 'identitaet', 1), node('PRIVATE entry', 'erinnerung', .71), node('PRIVATE agent', 'agent', .5), node('PRIVATE unsupported', 'PRIVATE category', 1)], kanten: [{ von: 'PRIVATE owner', nach: 'PRIVATE entry', art: 'PRIVATE relationship', gewicht: .8 }, { von: 'PRIVATE entry', nach: 'PRIVATE agent', gewicht: .4 }, { von: 'missing', nach: 'PRIVATE agent', gewicht: 1 }] };
  const result = publicBrain(graph);
  assert.equal(result.nodes.length, 3); assert.equal(result.edges.length, 2);
  assert.deepEqual(result.edges[1], { source: 1, target: 2, weight: .4 });
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  assert.deepEqual(Object.keys(result).sort(), ['edges', 'nodes', 'version']);
  assert.equal(publicBrain({ knoten: [], kanten: [] }).nodes.length, 0);
  console.log('Public brain: real relationships retained; private fields, identifiers and labels excluded.');
} finally { await rm(dir, { recursive: true, force: true }); }
