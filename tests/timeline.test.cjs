const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

function app(time = '14:30') {
  const html = readFileSync(join(__dirname, '../public/index.html'), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/render\(\);\s*boot\(\);\s*$/, '');
  const context = vm.createContext({ URL, URLSearchParams, console, setTimeout, clearTimeout,
    setInterval() {}, document: { addEventListener() {} }, window: { addEventListener() {} } });
  vm.runInContext(script, context);
  vm.runInContext(`const sample = { date: '2026-12-10', time: '${time}', stopType: 'lounge',
    cfg: { drive: 90, parking: 10, security: 15, walkToStop: 10, stop: 45, walkToGate: 5, preBoard: 40 } };`, context);
  return code => vm.runInContext(code, context);
}

test('chronological timeline starts at leaving home and ends at takeoff', () => {
  const run = app();
  assert.equal(run(`plainStepLabel(groupTimelineRows([...computeSchedule(sample).rows].reverse())[0].rows[0].label)`), 'Leave home');
  assert.equal(run(`plainStepLabel(groupTimelineRows([...computeSchedule(sample).rows].reverse()).at(-1).rows.at(-1).label)`), 'Takeoff');
});

test('overnight timeline uses one group per day and preserves all steps', () => {
  const run = app('01:00');
  assert.equal(run(`groupTimelineRows([...computeSchedule(sample).rows].reverse()).length`), 2);
  assert.equal(run(`groupTimelineRows([...computeSchedule(sample).rows].reverse()).map(g => isoDate(g.date)).join(',')`), '2026-12-09,2026-12-10');
  assert.equal(run(`groupTimelineRows([...computeSchedule(sample).rows].reverse()).reduce((n,g) => n + g.rows.length, 0)`), run('computeSchedule(sample).rows.length'));
});

test('zero-length segments retain their logical order without dropping equal times', () => {
  const run = app();
  run('Object.keys(sample.cfg).forEach(k => sample.cfg[k] = 0)');
  assert.equal(run(`groupTimelineRows([...computeSchedule(sample).rows].reverse()).length`), 1);
  assert.equal(run(`plainStepLabel(groupTimelineRows([...computeSchedule(sample).rows].reverse())[0].rows[0].label)`), 'Leave home');
  assert.equal(run(`plainStepLabel(groupTimelineRows([...computeSchedule(sample).rows].reverse())[0].rows.at(-1).label)`), 'Takeoff');
});

test('plain timeline labels remove leading emoji while preserving direction arrows', () => {
  const run = app();
  assert.equal(run(`plainStepLabel('🚶 Leave lounge → gate')`), 'Leave lounge → gate');
});
