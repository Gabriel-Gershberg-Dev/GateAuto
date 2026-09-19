#!/usr/bin/env node
/**
 * Publish GateAuto sideload Remote Config for project gateauto-app.
 *
 * DEFAULT = beta only
 *   Updates beta_version_code, beta_version_name, beta_apk_url, beta_release_notes
 *   from app.json (and --apk-url / --notes). Production latest_version_* / apk_url /
 *   release_notes are copied from live and left unchanged so family is not notified.
 *
 * Production (family) only when explicitly asked:
 *   node scripts/publish-update.mjs --production --apk-url URL --notes "..."
 *
 * Usage:
 *   node scripts/publish-update.mjs --apk-url URL [--notes "..."]
 *   node scripts/publish-update.mjs --production --apk-url URL [--notes "..."]
 *   node scripts/publish-update.mjs --dry-run --apk-url URL
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = path.join(ROOT, 'remoteconfig.template.json');
const PROJECT = 'gateauto-app';

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  if (i < 0) return '';
  return String(process.argv[i + 1] ?? '').trim();
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function firebase(args) {
  const result = spawnSync(
    'npx',
    ['-y', 'firebase-tools@latest', ...args, '--project', PROJECT, '--non-interactive'],
    { cwd: ROOT, encoding: 'utf8', shell: true },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `firebase ${args[0]} failed`);
  }
  return result.stdout;
}

function param(value, valueType, description) {
  return {
    defaultValue: { value: String(value) },
    valueType,
    description,
  };
}

const production = hasFlag('--production');
const dryRun = hasFlag('--dry-run');
const apkUrl = argValue('--apk-url');
const notes = argValue('--notes');

if (!apkUrl && !dryRun) {
  console.error('Need --apk-url (HTTPS). Default publish still only writes beta keys.');
  process.exit(1);
}

const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
const versionName = String(appJson.expo?.version ?? '');
const versionCode = String(appJson.expo?.android?.versionCode ?? '');
if (!versionName || !versionCode) {
  console.error('app.json is missing expo.version / android.versionCode');
  process.exit(1);
}

const livePath = path.join(ROOT, 'remoteconfig.live.json');
firebase(['remoteconfig:get', '-o', livePath]);
const live = JSON.parse(fs.readFileSync(livePath, 'utf8'));
const liveParams = live.parameters || {};

function liveValue(key, fallback) {
  const fromLive = liveParams[key]?.defaultValue?.value;
  return fromLive != null && fromLive !== '' ? String(fromLive) : fallback;
}

const next = {
  parameters: {
    latest_version_code: param(
      production ? versionCode : liveValue('latest_version_code', versionCode),
      'NUMBER',
      'PRODUCTION family channel. Do not bump on a routine/dev publish — only when explicitly asked.',
    ),
    latest_version_name: param(
      production ? versionName : liveValue('latest_version_name', versionName),
      'STRING',
      'PRODUCTION family channel. Leave unchanged unless promoting a build to family.',
    ),
    apk_url: param(
      production ? apkUrl || liveValue('apk_url', '') : liveValue('apk_url', ''),
      'STRING',
      'PRODUCTION family channel. Default publish must not point this at a beta object.',
    ),
    release_notes: param(
      production
        ? notes || liveValue('release_notes', '')
        : liveValue('release_notes', ''),
      'STRING',
      'PRODUCTION family channel. Optional what\'s-new text for the in-app update sheet.',
    ),
    beta_version_code: param(
      versionCode,
      'NUMBER',
      'BETA channel. Default RC publish updates these keys only. Hidden until developer options are unlocked.',
    ),
    beta_version_name: param(
      versionName,
      'STRING',
      'BETA channel. User-facing version name for Check for beta updates.',
    ),
    beta_apk_url: param(
      apkUrl || liveValue('beta_apk_url', ''),
      'STRING',
      'BETA channel. HTTPS URL of the beta APK (separate Storage object so family production URL is not overwritten).',
    ),
    beta_release_notes: param(
      notes || liveValue('beta_release_notes', ''),
      'STRING',
      'BETA channel. Optional what\'s-new text shown only after unlock.',
    ),
  },
};

if (live.conditions) next.conditions = live.conditions;
if (live.parameterGroups) next.parameterGroups = live.parameterGroups;

const prodCode = next.parameters.latest_version_code.defaultValue.value;
const prodName = next.parameters.latest_version_name.defaultValue.value;
const betaCode = next.parameters.beta_version_code.defaultValue.value;
const betaName = next.parameters.beta_version_name.defaultValue.value;

console.log(
  production
    ? `Publishing PRODUCTION ${prodName} (${prodCode}) and beta ${betaName} (${betaCode})`
    : `Publishing BETA ${betaName} (${betaCode}) — production stays ${prodName} (${prodCode})`,
);

if (dryRun) {
  console.log(JSON.stringify(next, null, 2));
  process.exit(0);
}

fs.writeFileSync(TEMPLATE, `${JSON.stringify(next, null, 2)}\n`);
firebase(['deploy', '--only', 'remoteconfig']);
console.log('Remote Config deployed.');
