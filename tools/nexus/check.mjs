// Runs nexus.mjs against a stand-in for Nexus's API (NEXUS_API_BASE), from a scratch repo in the
// temp folder, as a tool's repo would run it. Nothing reaches Nexus and no real key is used.
//   node tools/nexus/check.mjs
import { createServer } from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tool = join(dirname(fileURLToPath(import.meta.url)), 'nexus.mjs');
let failed = 0;
const ok = (cond, what, extra = '') => {
  console.log(`${cond ? 'pass' : 'FAIL'}  ${what}${cond ? '' : `  ${extra}`}`);
  if (!cond) failed++;
};

function server(state) {
  const srv = createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      const body = raw && req.headers['content-type']?.includes('json') ? JSON.parse(raw) : null;
      const send = (data, code = 200) => {
        res.writeHead(code, { 'content-type': 'application/json', etag: '"e"' });
        res.end(JSON.stringify({ data }));
      };
      const base = `http://127.0.0.1:${srv.address().port}`;
      const u = req.url.split('?')[0];
      let m;
      if (req.method === 'GET' && u === '/games/cyberpunk2077/mods/1') return send(state.mod);
      if (req.method === 'GET' && u.match(/^\/mods\/[^/]+\/files$/)) return send({ mod_files: state.files.map((f) => ({ id: f.id, name: f.name, is_active: true })) });
      if (req.method === 'GET' && (m = u.match(/^\/mod-files\/([^/]+)\/versions$/))) return send({ versions: state.files.find((f) => String(f.id) === m[1])?.versions ?? [] });
      if (req.method === 'POST' && u === '/uploads/multipart') {
        state.uploads++;
        return send({ id: 'up1', part_size_bytes: 1 << 20, part_presigned_urls: [`${base}/part`], complete_presigned_url: `${base}/done` });
      }
      if (req.method === 'PUT' && u === '/part') return send({});
      if (req.method === 'POST' && u === '/done') return send({});
      if (req.method === 'POST' && u === '/uploads/up1/finalise') return send({});
      if (req.method === 'GET' && u === '/uploads/up1') return send({ state: 'available' });
      const add = (f, b) => {
        state.posts.push(b);
        if (b.archive_existing_file && b.previous_version_id) f.versions.find((v) => v.id === b.previous_version_id).category = 'archived';
        if (b.primary_mod_manager_download && !state.ignorePrimary) f.versions.forEach((v) => (v.is_primary = false));
        f.versions.push({ id: `v${b.version}`, version: b.version, category: b.file_category, uploaded_at: '2026-11-06T12:00:00Z', is_primary: !!b.primary_mod_manager_download && !state.ignorePrimary });
        if (b.update_mod_version && !state.ignoreVersion) state.mod.version = b.version;
      };
      if (req.method === 'POST' && u === '/mod-files') {
        const f = { id: 900 + state.files.length, name: body.name, versions: [] };
        state.files.push(f);
        add(f, body);
        return send({ id: f.id });
      }
      if (req.method === 'POST' && (m = u.match(/^\/mod-files\/([^/]+)\/versions$/))) {
        add(state.files.find((f) => String(f.id) === m[1]), body);
        return send({ version: { id: 'new' } });
      }
      if (req.method === 'POST' && u.endsWith('/changelogs')) {
        state.changelogs++;
        return send({});
      }
      if (req.method === 'PATCH' && u === '/mods/m1') {
        state.pushed = body.description;
        state.mod.description = body.description;
        return send({});
      }
      send({ message: `not handled: ${req.method} ${u}` }, 404);
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}

/** A scratch repo with nexus/ and a zip; `tag` makes it a git repo whose tag holds that description. */
function scratch(config, description, tag) {
  const dir = mkdtempSync(join(tmpdir(), 'nx-'));
  mkdirSync(join(dir, 'nexus'));
  writeFileSync(join(dir, 'nexus/nexus.json'), JSON.stringify(config));
  writeFileSync(join(dir, 'a.zip'), 'zip');
  const desc = join(dir, 'nexus/description.bbcode');
  if (tag) {
    const git = (...a) => execFileSync('git', ['-c', 'user.name=check', '-c', 'user.email=check@example.invalid', ...a], { cwd: dir, stdio: 'ignore' });
    git('init', '-q');
    writeFileSync(desc, tag.text);
    git('add', '-A');
    git('commit', '-q', '-m', 'release');
    git('tag', tag.name);
  }
  writeFileSync(desc, description);
  return dir;
}

async function run(state, dir, args, env = {}) {
  const srv = await server(state);
  const out = await new Promise((resolve) => {
    const e = { ...process.env, NEXUS_KEY: 'test', NEXUS_API_BASE: `http://127.0.0.1:${srv.address().port}`, ...env };
    if (!env.GITHUB_ACTIONS) delete e.GITHUB_ACTIONS;
    const c = spawn(process.execPath, [tool, ...args], { cwd: dir, env: e });
    let s = '';
    c.stdout.on('data', (d) => (s += d));
    c.stderr.on('data', (d) => (s += d));
    c.on('close', (code) => resolve(`${s}\n[exit ${code}]`));
  });
  srv.close();
  return out;
}

const mod = (version = '1.0', description = 'same text') => ({ id: 'm1', name: 'Tool', version, description });
const v = (version, category, is_primary = false, day = '01') => ({ id: `v${version}`, version, category, is_primary, uploaded_at: `2026-11-${day}T00:00:00Z` });
const up = (over = {}) => ({ name: 'Tool', category: 'main', primary: true, modManager: false, archivePrevious: true, description: 'Tool {version}', ...over });
const state = (versions, over = {}) => ({ mod: mod(), fileId: 100, files: [{ id: 100, name: 'Tool', versions }], posts: [], uploads: 0, changelogs: 0, ...over });
const config = (s, upload, extra = {}) => ({ page: 1, mod: 'm1', file: s.fileId ?? null, upload, ...extra });
const release = (ver) => ['release', '--version', ver, '--zip', 'a.zip'];
const go = (s, upload, args, env, extra) => run(s, scratch(config(s, upload, extra), 'same text'), args, env);

{ // A VS Code tool's page: Primary on, Mod Manager Download off.
  const s = state([v('1.0', 'main', true, '02'), v('0.9', 'archived')]);
  const o = await go(s, up(), release('1.1'));
  const b = s.posts[0];
  ok(b?.primary_mod_manager_download === true, 'primary is sent as true', o);
  ok(b?.allow_mod_manager_download === false, 'mod manager download stays off');
  ok(b?.update_mod_version === true, 'the main file sets the page version');
  ok(b?.archive_existing_file === true && b?.previous_version_id === 'v1.0', 'the version on show is replaced and archived', JSON.stringify(b));
  ok(s.files[0].versions.find((x) => x.version === '1.1').is_primary, 'the new version is Primary');
  ok(/1\.1 is the page's Primary file/.test(o), 'the read-back says so', o);
  ok(/The page's version is 1\.1/.test(o), 'the page version is read back', o);
  ok(/the new Primary file/.test(o), 'the plan says it will be Primary', o);
}
{ // The stale state: Primary on an archived version, two still under Main files.
  const s = state([v('0.8', 'archived', true), v('0.9', 'main', false, '02'), v('1.0', 'main', false, '03')]);
  const o = await go(s, up(), release('1.1'));
  ok(s.posts[0]?.previous_version_id === 'v1.0', 'an archived Primary is not the one replaced', JSON.stringify(s.posts[0]));
  ok(/Also under Main files: 0\.9/.test(o), 'the older one left under Main is named', o);
}
{ // Nexus ignores the flag: the run warns, with an annotation in CI, and still ends well.
  const s = state([v('1.0', 'main', true)], { ignorePrimary: true });
  const o = await go(s, up(), release('1.1'), { GITHUB_ACTIONS: 'true' });
  ok(/::warning title=Nexus Primary file::1\.1 is not/.test(o), 'a version that did not become Primary warns in CI', o);
  ok(/\[exit 0\]/.test(o), 'and does not fail the run', o);
}
{ // The page's version did not follow.
  const s = state([v('1.0', 'main', true)], { ignoreVersion: true });
  const o = await go(s, up(), release('1.1'));
  ok(/still 1\.0, not 1\.1/.test(o), 'a page version that did not follow warns', o);
}
{ // A "primary": false left in a nexus.json.
  const s = state([v('1.0', 'main', true)]);
  const o = await go(s, up({ primary: false }), ['check', '--version', '1.1']);
  ok(/"primary": false/.test(o), 'check warns about "primary": false', o);
  ok(s.uploads === 0 && !s.posts.length, 'check changes nothing');
}
{ // A first release: no files yet.
  const s = state([], { fileId: null, files: [] });
  const o = await go(s, up(), release('1.0'));
  ok(s.posts[0]?.primary_mod_manager_download === true, 'a first file is made Primary', o);
  ok(/1\.0 is the page's Primary file/.test(o), 'and the read-back finds it', o);
  ok(/Created the main file/.test(o), 'the main file is created', o);
}
{ // A rerun of a version already there.
  const s = state([v('1.1', 'main', true)]);
  const o = await go(s, up(), release('1.1'));
  ok(s.uploads === 0 && s.changelogs === 0, 'a rerun uploads nothing', o);
  ok(!/is the page's Primary file/.test(o), 'and checks nothing', o);
}
{ // No id in nexus.json: the main file is the page's Primary one, also among several.
  const s = state([], { fileId: null, files: [{ id: 200, name: 'Other', versions: [v('0.1', 'optional')] }, { id: 100, name: 'Tool', versions: [v('1.0', 'main', true)] }] });
  const o = await go(s, up(), ['check', '--version', '1.1']);
  ok(/main file 100/.test(o), 'the Primary file is the main one', o);
  const s2 = state([], { fileId: null, files: [{ id: 200, name: 'A', versions: [v('0.1', 'main')] }, { id: 100, name: 'B', versions: [v('1.0', 'main')] }] });
  const o2 = await go(s2, up(), ['check', '--version', '1.1']);
  ok(/set "file" in nexus\.json/.test(o2) && /\[exit 1\]/.test(o2), 'no Primary among several stops and says why', o2);
}
{ // A second file on the page, as EDGEwave Voice is.
  const voice = { name: 'Voice', category: 'optional', primary: false, modManager: true, archivePrevious: true };
  const s = state([v('1.0', 'main', true)]);
  s.files.push({ id: 200, name: 'Voice', versions: [v('0.1', 'optional', false, '02')] });
  const d = scratch(config(s, up(), { files: { voice: { ...voice, file: 200 } } }), 'same text');
  writeFileSync(join(d, 'notes.txt'), 'What changed');
  const o = await run(s, d, [...release('1.1'), '--notes', 'notes.txt', '--file', 'voice=a.zip@0.2']);
  const pv = s.posts.find((b) => b.version === '0.2');
  ok(pv?.primary_mod_manager_download === false && pv?.previous_version_id === 'v0.1', 'the other file replaces its own version and is not Primary', o);
  ok(pv?.update_mod_version === false, 'and leaves the page version alone', JSON.stringify(pv));
  ok(s.posts.find((b) => b.version === '1.1')?.primary_mod_manager_download === true, 'the main file is Primary');
  ok(s.files[0].versions.find((x) => x.version === '1.1').is_primary, 'and stays so', o);
  ok(s.changelogs === 1, 'one changelog, for the main version', o);
  ok(s.mod.version === '1.1', 'the page version is the main file\'s');

  const s2 = state([v('1.0', 'main', true)]);
  const o2 = await go(s2, up(), [...release('1.1'), '--file', 'voice=a.zip@0.1'], undefined, { files: { voice } });
  ok(s2.files.some((f) => f.name === 'Voice' && f.versions[0]?.version === '0.1'), 'a first release creates the other file, by name', o2);

  const s3 = state([v('1.0', 'main', true)]);
  const o3 = await go(s3, up(), ['check', '--version', '1.1', '--file', 'voice=0.2'], undefined, { files: { voice } });
  ok(/Voice: create the file with 0\.2/.test(o3) && s3.uploads === 0, 'check takes key=version and changes nothing', o3);

  const s4 = state([v('1.0', 'main', true)]);
  const o4 = await go(s4, up(), ['check', '--version', '1.1', '--file', 'nope=0.2']);
  ok(/no files\.nope/.test(o4) && /\[exit 1\]/.test(o4), 'an unknown key stops', o4);

  const s5 = state([v('1.0', 'main', true)]);
  const o5 = await go(s5, up(), [...release('1.1'), '--file', 'voice=missing.zip@0.2'], undefined, { files: { voice } });
  ok(/archive missing\.zip is missing/.test(o5) && s5.uploads === 0, 'a missing zip stops before any upload', o5);
}
{ // The description.
  const s = state([v('1.0', 'main', true)], { mod: mod('1.0', 'edited on Nexus') });
  const o = await go(s, up(), release('1.1'));
  ok(/\[exit 1\]/.test(o) && s.uploads === 0 && !s.pushed, 'an edit on Nexus stops the release before any upload', o);
  ok(/EDGErepo\/tools\/nexus\/nexus\.mjs pull/.test(o), 'and names the command to run', o);
  ok(/File: upload 1\.1/.test(o), 'the file plan still shows', o);

  const s2 = state([v('1.0', 'main', true)], { mod: mod('1.0', 'last pulled') });
  const hash = (await import('node:crypto')).createHash('sha256').update('lastpulled').digest('hex');
  const d2 = scratch(config(s2, up(), { pulled: { sha256: hash } }), 'new text');
  await run(s2, d2, release('1.1'));
  ok(s2.pushed === 'new text', 'the description last pulled may be replaced');

  const prefix = { tag: 'wardrobe-v' };
  const s3 = state([v('1.0', 'main', true)], { mod: mod('1.0', 'as released') });
  const d3 = scratch(config(s3, up(), prefix), 'new text', { name: 'wardrobe-v1.0', text: 'as released' });
  const o3 = await run(s3, d3, release('1.1'));
  ok(s3.pushed === 'new text', 'the description of the previous release, by the page\'s tag prefix, may be replaced', o3);
  ok(/wardrobe-v1\.0 pushed/.test(o3), 'and the plan names that tag', o3);

  const s4 = state([v('1.0', 'main', true)], { mod: mod('1.0', 'as released') });
  const d4 = scratch(config(s4, up()), 'new text', { name: 'wardrobe-v1.0', text: 'as released' });
  const o4 = await run(s4, d4, release('1.1'));
  ok(/\[exit 1\]/.test(o4) && !s4.pushed, 'a tag of another prefix does not count', o4);
}
{ // Pull.
  const voice = { name: 'Voice', category: 'optional' };
  const s = state([v('1.0', 'main', true)], { mod: mod('1.0', 'live<br />text &gt; &#92;') });
  s.files.push({ id: 200, name: 'Voice', versions: [v('0.1', 'optional')] });
  const d = scratch(config(s, up(), { files: { voice } }), 'repo text');
  await run(s, d, ['pull']);
  ok(readFileSync(join(d, 'nexus/description.bbcode'), 'utf8') === 'live\ntext > \\\n', 'pull writes the live description as plain BBCode');
  const after = JSON.parse(readFileSync(join(d, 'nexus/nexus.json'), 'utf8'));
  ok(after.file === 100 && after.files.voice.file === 200 && after.pulled.sha256, 'and the ids and hash', JSON.stringify(after));

  const s2 = state([v('1.0', 'main', true)], { mod: mod('1.0', 'live') });
  const d2 = scratch(config(s2, up()), 'repo text');
  const o2 = await run(s2, d2, ['pull', '--ids-only']);
  ok(readFileSync(join(d2, 'nexus/description.bbcode'), 'utf8') === 'repo text', '--ids-only keeps the repo\'s description', o2);
  ok(JSON.parse(readFileSync(join(d2, 'nexus/nexus.json'), 'utf8')).pulled.sha256, 'and records the live hash');
  const s3 = state([v('1.0', 'main', true)], { mod: mod('1.0', 'live') });
  s3.fileId = null;
  await run(s3, d2, release('1.1'));
  ok(s3.pushed === 'repo text', 'so the next release may push it');
}
{ // Status, and running from the wrong folder.
  const voice = { name: 'Voice', category: 'optional' };
  const s = state([v('1.0', 'main', true)]);
  const o = await go(s, up(), ['status'], undefined, { files: { voice } });
  ok(/Main file 100: 1\.0 \(primary\)/.test(o) && /voice file \(Voice\): not on the page yet/.test(o), 'status shows each file', o);
  ok(s.uploads === 0 && !s.posts.length, 'and changes nothing');

  const o2 = await run(state([]), mkdtempSync(join(tmpdir(), 'nx-')), ['status']);
  ok(/run this from the folder of the tool's repo/.test(o2) && /\[exit 1\]/.test(o2), 'the wrong folder says so', o2);
}
console.log(failed ? `${failed} failed` : 'All passed');
process.exit(failed ? 1 : 0);
