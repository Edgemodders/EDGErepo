// Keeps a tool's Nexus Mods page in step with its repo, through Nexus's v3 API (api.mjs beside this file).
// Shared by every Edgemodders repo with a Nexus page. Run it from that repo's folder: on a PC from a
// checkout beside it, in a release workflow from a clone of EDGErepo at the shared tag (README.md).
//
//   node ../EDGErepo/tools/nexus/nexus.mjs pull   [dir] [--ids-only]
//         the live description into <dir>/description.bbcode, ids into <dir>/nexus.json; with --ids-only,
//         the ids and the live description's hash only, keeping the repo's description (it may then
//         replace the live one at the next release)
//   node ../EDGErepo/tools/nexus/nexus.mjs status [dir]
//         the page's version and files, and whether its description matches the repo
//   node ../EDGErepo/tools/nexus/nexus.mjs check  [dir] --version <v> [--file <key>=<version>]...
//         what a release would do, and whether it may: stops when the description changed on Nexus
//   node ../EDGErepo/tools/nexus/nexus.mjs release [dir] --version <v> --zip <file> [--notes <file>]
//         [--file <key>=<zip>@<version>]... [--dry-run]
//         uploads the zip as the main file's new version (the old one archived), or as the main
//         file itself on a page with no files yet; each --file the same for nexus.json's "files"
//         entry <key> (created on its first release); adds the version's changelog, and pushes
//         description.bbcode when it differs from the live one
//
// <dir> is the folder with nexus.json (default: nexus). nexus.json names the page ("page": 35419),
// how the main file is uploaded ("upload"), and any other files ("files": { key: upload settings }),
// such as EDGEwave Voice beside EDGEwave. pull adds the internal mod id, each file's id and the hash
// of the description it pulled. A file is found by its id in nexus.json ("file", or files.<key>.file);
// without one, the main file is the page's Primary one and another file goes by its name.
//
// "primary" makes the new version the page's Primary file, its default download, and is true on every
// page's main file, also with "modManager": false: sent as false, a new version never takes over and
// Primary stays on an old one. A page released with tags of its own sets their prefix
// ("tag": "wardrobe-designer-v"); without it the page's release tags are v<version>.
//
// The description is pushed only when the live one is what the repo last saw: the one pulled
// (nexus.json's hash) or the one the previous release pushed (description.bbcode at the previous
// release tag, v* or nexus.json's "tag" prefix). Anything else is an edit made on Nexus since,
// and the release stops before it uploads anything, so that edit is never overwritten: pull,
// merge, commit, and run it again.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { api, modByPage, uploadArchive } from './api.mjs';

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const options = (name) => args.flatMap((a, i) => (a === `--${name}` && args[i + 1] !== undefined ? [args[i + 1]] : []));
const valued = ['--version', '--zip', '--notes', '--file'];
const values = new Set(args.flatMap((a, i) => (valued.includes(a) ? [args[i + 1]] : [])));
const [cmd, dirArg = 'nexus'] = args.filter((a) => !a.startsWith('--') && !values.has(a));
const dryRun = args.includes('--dry-run');
const dir = resolve(dirArg);
const configFile = join(dir, 'nexus.json');
const descFile = join(dir, 'description.bbcode');

// Nexus stores a description with an HTML <br /> on each line and some characters as entities
// (&gt;, &#92; for a backslash). fromNexus turns that back into the plain BBCode the repo keeps,
// with LF line ends; a push sends plain BBCode and Nexus adds its markup again.
const lf = (s) => s.replace(/\r\n/g, '\n');
const ENTITIES = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };
const fromNexus = (s) =>
  lf(s ?? '')
    .replace(/\n?<br\s*\/?>/g, '\n')
    .replace(/&(#\d+|#x[0-9a-f]+|lt|gt|quot|apos|amp);/gi, (m, e) =>
      e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()],
    );
// The hash ignores whitespace: Nexus drops the newline after a block such as [/list] or [/quote],
// so a pushed description comes back with the same text but not the same line breaks.
const sha = (s) => createHash('sha256').update(s.replace(/\s+/g, '')).digest('hex');
function readConfig() {
  if (!existsSync(configFile)) throw new Error(`No ${configFile}: run this from the folder of the tool's repo`);
  return JSON.parse(readFileSync(configFile, 'utf8'));
}
const repoDescription = () => lf(readFileSync(descFile, 'utf8'));
/** A warning: an annotation on the run in CI, a plain line on the dev PC. */
const warn = (title, msg) => console.log(process.env.GITHUB_ACTIONS ? `::warning title=${title}::${msg}` : msg);

async function mainFile(modId, fileId) {
  if (fileId) return { file: { id: String(fileId) }, versions: (await api('GET', `/mod-files/${fileId}/versions`)).versions };
  const { mod_files: files } = await api('GET', `/mods/${modId}/files`);
  const active = files.filter((f) => f.is_active);
  for (const f of active) {
    const { versions } = await api('GET', `/mod-files/${f.id}/versions`);
    if (versions.some((v) => v.is_primary)) return { file: f, versions };
  }
  if (active.length === 1) return { file: active[0], versions: (await api('GET', `/mod-files/${active[0].id}/versions`)).versions };
  // A new page: the first release creates its main file.
  if (!active.length) return { file: null, versions: [] };
  throw new Error('No primary file on the page, and more than one file: set "file" in nexus.json');
}

/** A file other than the main one and its versions: by its id, else by its name among the active files; empty when there is none yet. */
async function namedFile(modId, up, id) {
  if (id) return { file: { id: String(id) }, versions: (await api('GET', `/mod-files/${id}/versions`)).versions };
  const { mod_files: files } = await api('GET', `/mods/${modId}/files`);
  const named = files.filter((f) => f.is_active && f.name === up.name);
  if (named.length > 1) throw new Error(`More than one active file named "${up.name}" on the page: set its id in nexus.json`);
  if (!named.length) return { file: null, versions: [] };
  return { file: named[0], versions: (await api('GET', `/mod-files/${named[0].id}/versions`)).versions };
}

const findFile = (modId, t) => (t.key === 'main' ? mainFile(modId, t.id) : namedFile(modId, t.up, t.id));

/** The files to release: the main one, then each --file, with its settings, archive and version. */
function targets(config, version, zip) {
  const list = [{ key: 'main', up: config.upload, id: config.file, version, zip }];
  for (const spec of options('file')) {
    // key=zip@version (release) or key=version (check)
    const m = /^([a-z0-9_-]+)=(?:(.+)@)?([^@]+)$/i.exec(spec);
    if (!m) throw new Error(`--file ${spec}: expected <key>=<zip>@<version>, or <key>=<version> for check`);
    const up = config.files?.[m[1]];
    if (!up) throw new Error(`--file ${m[1]}: nexus.json has no files.${m[1]}`);
    list.push({ key: m[1], up, id: up.file, version: m[3], zip: m[2] });
  }
  return list;
}

/**
 * description.bbcode as the previous release had it, or null: the newest tag with the page's
 * prefix (nexus.json's "tag", "v" when absent) that is not this version's; any, with no version.
 */
function previousReleaseDescription(config, version) {
  const prefix = config.tag ?? 'v';
  try {
    const git = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const tag = git('tag', '--list', `${prefix}*`, '--sort=-v:refname').split('\n').find((t) => t && t !== `${prefix}${version}`);
    if (!tag) return null;
    // Relative to this folder, which git reads as written: its own --show-toplevel can spell the same
    // folder differently (a short 8.3 name such as RUNNER~1, or another drive letter case).
    return { tag, text: git('show', `${tag}:./${relative(process.cwd(), descFile).replace(/\\/g, '/')}`) };
  } catch {
    return null; // no git, no tag, or the file was not there then
  }
}

/** Whether the description may be pushed, and whether it needs to be. Throws when Nexus has an edit the repo has not seen. */
function descriptionPlan(mod, config, version) {
  const live = sha(fromNexus(mod.description));
  const repo = sha(repoDescription());
  if (live === repo) return { push: false, why: 'the repo and Nexus have the same description' };
  if (live === config.pulled?.sha256) return { push: true, why: 'the live description is the one last pulled' };
  const prev = previousReleaseDescription(config, version);
  if (prev && live === sha(prev.text)) return { push: true, why: `the live description is the one ${prev.tag} pushed` };
  throw new Error(
    'The description on Nexus has changed since the last pull and the last release, so pushing would lose that edit. ' +
      `Run node ../EDGErepo/tools/nexus/nexus.mjs pull${dirArg === 'nexus' ? '' : ` ${dirArg}`} (with --ids-only to keep the repo's), check the diff, commit, and run again.`,
  );
}

async function pull() {
  const config = readConfig();
  const mod = await modByPage(config.page);
  const { file } = await mainFile(mod.id, config.file);
  const files = { ...(config.files ?? {}) };
  for (const [key, up] of Object.entries(files)) {
    const f = await namedFile(mod.id, up, up.file);
    if (f.file) files[key] = { ...up, file: Number(f.file.id) };
  }
  const description = fromNexus(mod.description);
  const idsOnly = args.includes('--ids-only');
  if (!idsOnly) writeFileSync(descFile, description.endsWith('\n') ? description : description + '\n');
  const next = {
    ...config,
    mod: mod.id,
    ...(file ? { file: Number(file.id) } : {}),
    ...(Object.keys(files).length ? { files } : {}),
    pulled: { sha256: sha(description), at: new Date().toISOString(), version: mod.version },
  };
  writeFileSync(configFile, JSON.stringify(next, null, 2) + '\n');
  console.log(
    idsOnly
      ? `Pulled the ids of ${mod.name} (page ${config.page}, version ${mod.version}); kept the repo's description, which the next release pushes`
      : `Pulled ${mod.name} (page ${config.page}, version ${mod.version}): ${description.length} characters into ${descFile}`,
  );
}

async function status() {
  const config = readConfig();
  const mod = await modByPage(config.page);
  const { file, versions } = await mainFile(mod.id, config.file);
  const live = sha(fromNexus(mod.description));
  console.log(`${mod.name}: page ${config.page}, mod ${mod.id}, version ${mod.version}`);
  console.log(
    file
      ? `Main file ${file.id}: ${versions.map((v) => `${v.version}${v.is_primary ? ' (primary)' : ''}${v.category !== 'main' ? ` (${v.category})` : ''}`).join(', ')}`
      : 'No files yet: the first release creates the main file',
  );
  const prev = previousReleaseDescription(config);
  const seen =
    live === config.pulled?.sha256
      ? 'the one last pulled'
      : prev && live === sha(prev.text)
        ? `the one ${prev.tag} pushed`
        : 'CHANGED on Nexus since the last pull and the last release (pull before the next release)';
  for (const [key, up] of Object.entries(config.files ?? {})) {
    const { file: f, versions: vs } = await namedFile(mod.id, up, up.file);
    console.log(
      f
        ? `${key} file ${f.id} (${up.name}): ${vs.map((v) => `${v.version}${v.is_primary ? ' (primary)' : ''}${v.category !== 'main' ? ` (${v.category})` : ''}`).join(', ')}`
        : `${key} file (${up.name}): not on the page yet; the next release creates it`,
    );
  }
  console.log(`Description: live is ${seen}; repo ${sha(repoDescription()) === live ? 'same as live' : 'differs from live'}`);
}

/** Reads the page and says what a release of <version> would do; throws if it may not. */
async function plan(version, zip) {
  if (!version) throw new Error('--version is required');
  const config = readConfig();
  if (!config.upload) throw new Error(`nexus.json has no "upload" settings`);
  const mod = await modByPage(config.page);
  const files = [];
  for (const t of targets(config, version, zip)) {
    const { file, versions } = await findFile(mod.id, t);
    const main = t.key === 'main';
    const already = versions.find((v) => v.version === t.version);
    // The version this one replaces, and Nexus archives when archivePrevious is set: the newest still
    // in the file's category. Not simply the Primary one, which can be a version archived since (0.28.0
    // on EDGEdeck's page and 0.10.2 on REDcode's, while they uploaded with "primary": false).
    const category = t.up.category ?? 'main';
    const shown = versions.filter((v) => v.category === category && v.version !== t.version).sort((a, b) => String(b.uploaded_at).localeCompare(String(a.uploaded_at)));
    const previous = shown[0] ?? versions.find((v) => v.is_primary && v.category !== 'archived') ?? null;
    // Older ones still there: the API cannot archive a version by itself, so say so.
    const stale = shown.slice(1);
    const settings = `mod manager download ${t.up.modManager ? 'on' : 'off'}; ${t.up.primary ? 'the new Primary file' : 'not Primary'}`;
    if (main) console.log(`${mod.name} on Nexus (page ${config.page}): version ${mod.version}, ${file ? `main file ${file.id}` : 'no files yet'}`);
    const pageVersion = main ? `; the page's version becomes ${t.version}` : '';
    console.log(
      `${main ? 'File' : t.up.name}: ` +
        (already
          ? `${t.version} is already on Nexus (version ${already.id}); no upload${main ? ' and no changelog' : ''}`
          : !file
            ? `create the ${main ? 'main ' : ''}file with ${t.version}; ${settings}${pageVersion}`
            : `upload ${t.version} as the ${main ? 'main ' : ''}file's new version${previous ? `, replacing ${previous.version}${t.up.archivePrevious ? ' (archived)' : ''}` : ''}; ${settings}${pageVersion}`),
    );
    if (stale.length) console.log(`Also under ${main ? 'Main files' : t.up.name}: ${stale.map((v) => v.version).join(', ')}. Nexus's API cannot archive these; archive them on the page's Files tab (Manage files)`);
    if (main && !already && !t.up.primary) warn('Nexus Primary file', `nexus.json has "primary": false, so ${t.version} will not become the page's Primary file. Set it to true, also with "modManager": false.`);
    files.push({ ...t, file, already, previous });
  }
  // Last, so the files' plan shows even when this stops the release.
  const description = descriptionPlan(mod, config, version);
  console.log(`Description: ${description.push ? 'push' : 'no push'} (${description.why})`);
  return { config, mod, files, description };
}

async function check() {
  await plan(option('version'));
}

async function release() {
  const version = option('version');
  const zip = option('zip');
  const notesFile = option('notes');
  if (!zip || !existsSync(zip)) throw new Error(`--zip must name the archive to upload (got ${zip})`);
  const p = await plan(version, zip);
  for (const f of p.files) if (!f.already && (!f.zip || !existsSync(f.zip))) throw new Error(`${f.up.name}: the archive ${f.zip} is missing`);
  if (dryRun) return console.log('Dry run: nothing changed on Nexus');

  for (const f of p.files) {
    if (f.already) continue;
    const up = f.up;
    const main = f.key === 'main';
    const fields = {
      name: up.name,
      description: up.description ? up.description.replaceAll('{version}', f.version) : null,
      version: f.version,
      file_category: up.category ?? 'main',
      primary_mod_manager_download: !!up.primary,
      allow_mod_manager_download: !!up.modManager,
      // Only the main file sets the page's version; another file has its own.
      update_mod_version: main,
    };
    const uploadId = await uploadArchive(f.zip);
    if (!f.file) {
      // A new page or file: create it from the upload (later releases add versions to it).
      const created = await api('POST', '/mod-files', { upload_id: uploadId, mod_id: p.mod.id, ...fields });
      console.log(`Created the ${main ? 'main file' : `file ${up.name}`} ${created.id ?? created.mod_file?.id} with ${f.version}`);
    } else {
      const created = await api('POST', `/mod-files/${f.file.id}/versions`, {
        upload_id: uploadId,
        ...fields,
        archive_existing_file: !!up.archivePrevious,
        previous_version_id: f.previous?.id ?? null,
      });
      console.log(`Made version ${f.version} of file ${f.file.id} (${created.version?.id})`);
    }
  }

  const main = p.files[0];
  if (!main.already) {
    // Changelogs only add: posted once, with the version it belongs to, so a rerun never doubles it.
    const notes = notesFile ? readFileSync(notesFile, 'utf8').trim() : '';
    if (notes) {
      await api('POST', `/mods/${p.mod.id}/changelogs`, { version, changelog: notes });
      console.log(`Added the changelog for ${version} (${notes.split('\n').length} lines)`);
    }
  }

  if (p.description.push) {
    await api('PATCH', `/mods/${p.mod.id}`, { description: repoDescription() });
    const after = await modByPage(p.config.page);
    const same = sha(fromNexus(after.description)) === sha(repoDescription());
    console.log(same ? 'Pushed the description' : 'Pushed the description, but Nexus answers with a different text: check the page');
  }

  if (!main.already) {
    // What Nexus made of the upload, read back: update_mod_version is the API's only way to set the
    // page's version, and whether "primary" takes with Mod Manager Download off is unverified.
    const after = await modByPage(p.config.page);
    if (after.version === version) console.log(`The page's version is ${version}`);
    else warn('Nexus page version', `The page's version is still ${after.version}, not ${version}: set it by hand on Nexus (Edit mod page, Version). The API has no other way to set it.`);
    const { versions } = await mainFile(p.mod.id, main.file?.id ?? p.config.file);
    if (versions.find((v) => v.version === version)?.is_primary) console.log(`${version} is the page's Primary file`);
    else if (main.up.primary) warn('Nexus Primary file', `${version} is not the page's Primary file, though nexus.json asks for it: set it by hand on the page's Files tab (Manage files).`);
  }
}

const commands = { pull, status, check, release };
if (!commands[cmd]) {
  console.error('usage: node nexus.mjs <pull|status|check|release> [dir] [--ids-only] [--version <v>] [--zip <file>] [--notes <file>] [--file <key>=<zip>@<version>] [--dry-run]');
  process.exit(1);
}
// exitCode, not exit(): on Windows, exit() right after a fetch trips an assertion in Node (a crash code, not 1).
await commands[cmd]().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
