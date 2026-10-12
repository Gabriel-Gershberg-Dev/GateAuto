import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  cloudAutoLogLines,
  formatAutoOpenLog,
  parseAutoLog,
  type AutoLogLine,
} from '../src/telemetry/autoOpenLogFormat';

const line: AutoLogLine = {
  t: Date.parse('2026-10-12T02:00:00.000Z'),
  v: '1.0.81',
  kind: 'open',
  source: 'poll',
  reason: '',
  gate: 'g_abc',
  name: 'North gate',
  distanceM: 12,
  radiusM: 20,
  walking: 0,
  warm: 1,
  battery: 1,
};

describe('auto-open log', () => {
  it('keeps a valid line and drops junk', () => {
    const parsed = parseAutoLog(
      JSON.stringify([line, { kind: 'nope' }, { kind: 'boot', t: 'x' }]),
    );
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].name, 'North gate');
  });

  it('drops the gate name before upload', () => {
    const cloud = cloudAutoLogLines([line]);
    assert.equal('name' in cloud[0], false);
    assert.equal(cloud[0].gate, 'g_abc');
    assert.equal(cloud[0].distanceM, 12);
  });

  it('formats a readable export line with the gate name', () => {
    const text = formatAutoOpenLog([line]);
    assert.match(text, /North gate/);
    assert.match(text, /12m\/20m/);
    assert.match(text, /open poll/);
  });

  it('stores at most 300 lines and does not record coordinates', () => {
    const java = fs.readFileSync(
      path.join(__dirname, '../src/platform/android-keepalive/AutoOpenLog.java'),
      'utf8',
    );
    assert.match(java, /MAX_LINES = 300/);
    assert.doesNotMatch(java, /"lat"/);
    assert.doesNotMatch(java, /"lng"/);
    const rules = fs.readFileSync(path.join(__dirname, '../firestore.rules'), 'utf8');
    assert.match(rules, /match \/autoLog\/\{docId\}/);
    assert.match(rules, /docId == 'recent'/);
    assert.match(rules, /data\.lines\.size\(\) <= 300/);
  });
});
