// A small client for Nexus Mods' v3 API (https://api.nexusmods.com/openapi.yaml), for nexus.mjs
// beside this file, on a PC and in the release workflows.
//
// The key: in CI the NEXUS_KEY environment variable (the Edgemodders organization's secret). On
// the dev PC, %APPDATA%\Edgemodders\nexus-key.txt, made once with
//   Read-Host 'Nexus API key' -AsSecureString | ConvertFrom-SecureString | Set-Content "$env:APPDATA\Edgemodders\nexus-key.txt"
// which Windows encrypts for this user (DPAPI). The key goes only into the apikey header: never
// printed, never on a command line.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export const BASE = process.env.NEXUS_API_BASE || 'https://api.nexusmods.com/v3';
export const GAME = 'cyberpunk2077';

let key = null;

function loadKey() {
  if (key) return key;
  if (process.env.NEXUS_KEY) return (key = process.env.NEXUS_KEY.trim());
  const file = join(process.env.APPDATA || '', 'Edgemodders', 'nexus-key.txt');
  if (process.platform !== 'win32' || !existsSync(file)) {
    throw new Error(`No Nexus key: set NEXUS_KEY, or make ${file} (see EDGErepo's tools/nexus/api.mjs)`);
  }
  // PowerShell decrypts the file for this Windows user and writes the key to our pipe only.
  const script =
    `$s = Get-Content -LiteralPath $env:NEXUS_KEY_FILE | ConvertTo-SecureString; ` +
    `[Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, NEXUS_KEY_FILE: file },
    encoding: 'utf8',
  });
  const out = (r.stdout || '').trim();
  if (r.status !== 0 || !out) throw new Error(`Could not decrypt ${file} (made by another Windows user or machine?)`);
  return (key = out);
}

/** Calls the API and returns its `data` (or the whole body when there is none). Throws with Nexus's message on an error. */
export async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      apikey: loadKey(),
      accept: 'application/json',
      'user-agent': 'Edgemodders-release/1.0',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // not JSON: keep the text for the error
  }
  if (!res.ok) {
    const why = json?.message || json?.error || json?.errors?.map?.((e) => e.message || e.detail).join('; ') || text.slice(0, 300);
    throw new Error(`${method} ${path}: ${res.status} ${why}`);
  }
  return json && 'data' in json ? json.data : json;
}

/** A mod by the number in its page URL (35419), with its internal id, description and version. */
export const modByPage = (pageId) => api('GET', `/games/${GAME}/mods/${pageId}`);

const MiB = 1024 * 1024;

/**
 * Uploads an archive and returns its upload id once Nexus has it ready (state "available"), to be
 * made a mod file version. Always as S3's multipart upload, as Nexus's own upload action does:
 * required above 100 MiB, and a small file is one part. (The single-part PUT is signed for
 * content-type and content-md5 values the API does not document; it failed with
 * SignatureDoesNotMatch on 2026-10-25.)
 */
export async function uploadArchive(file, log = console.log) {
  const data = readFileSync(file);
  const filename = basename(file);
  const upload = await api('POST', '/uploads/multipart', { size_bytes: data.length, filename });
  const size = upload.part_size_bytes;
  const etags = [];
  for (let i = 0; i < upload.part_presigned_urls.length; i++) {
    const part = data.subarray(i * size, Math.min((i + 1) * size, data.length));
    const res = await fetch(upload.part_presigned_urls[i], {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream', 'content-length': String(part.length) },
      body: part,
    });
    if (!res.ok) throw new Error(`Upload of ${filename}, part ${i + 1}: ${res.status} ${(await res.text()).slice(0, 1500)}`);
    etags.push(res.headers.get('etag'));
  }
  const xml =
    '<CompleteMultipartUpload>' +
    etags.map((tag, i) => `<Part><PartNumber>${i + 1}</PartNumber><ETag>${tag}</ETag></Part>`).join('') +
    '</CompleteMultipartUpload>';
  const done = await fetch(upload.complete_presigned_url, { method: 'POST', headers: { 'content-type': 'application/xml' }, body: xml });
  if (!done.ok) throw new Error(`Completing the upload of ${filename}: ${done.status} ${(await done.text()).slice(0, 1500)}`);
  log(`Uploaded ${filename} (${(data.length / MiB).toFixed(1)} MiB) in ${etags.length} part${etags.length === 1 ? '' : 's'}`);
  await api('POST', `/uploads/${upload.id}/finalise`);
  // Nexus checks the archive before it can become a version: wait for "available", up to 10 minutes.
  for (let waited = 0; ; waited += 5) {
    const { state } = await api('GET', `/uploads/${upload.id}`);
    if (state === 'available') break;
    if (waited >= 600) throw new Error(`Upload ${upload.id} still "${state}" after 10 minutes`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  log(`Upload ${upload.id} is available`);
  return upload.id;
}
