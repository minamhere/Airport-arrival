const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

function app(clipboard) {
  const html = readFileSync(join(__dirname, '../public/index.html'), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/render\(\);\s*boot\(\);\s*$/, '');
  const context = vm.createContext({
    URL, URLSearchParams, Blob, console, setTimeout, clearTimeout, setInterval() {},
    navigator: { clipboard },
    ClipboardItem: class { constructor(data) { this.data = data; } },
    document: { addEventListener() {}, querySelector() { return null; } },
    window: { addEventListener() {} },
  });
  vm.runInContext(script, context);
  vm.runInContext(`
    cur = { id: 'sample-trip', name: 'Early flight', airport: { code: 'DEN', name: 'Denver International' },
      date: '2026-12-10', time: '01:00', stopType: 'lounge',
      cfg: { drive: 90, parking: 10, security: 15, walkToStop: 10, stop: 45, walkToGate: 5, preBoard: 40 } };
    toast = message => messages.push(message);
    showScheduleImage = (blob, trip) => { previews.push({ blob, trip }); };
    state.view = { name: 'trip', id: cur.id };
  `, context);
  context.messages = [];
  context.previews = [];
  return { context, run: code => vm.runInContext(code, context) };
}

test('image copying calls clipboard.write before PNG generation finishes', async () => {
  let item, resolveImage;
  const { context, run } = app({ write: async items => { item = items[0]; await item.data['image/png']; } });
  context.pendingImage = new Promise(resolve => { resolveImage = resolve; });
  run('scheduleImageBlob = () => pendingImage');
  const task = run('copyScheduleImage()');
  assert.ok(item, 'clipboard.write must run synchronously within the click gesture');
  assert.equal(item.data['image/png'], context.pendingImage);
  resolveImage(new Blob(['png'], { type: 'image/png' }));
  await task;
  assert.equal(context.messages.at(-1), 'Schedule image copied');
  assert.equal(context.previews.length, 0);
});

test('denied image clipboard opens an image preview without copying text', async () => {
  let textCopies = 0;
  const { context, run } = app({ write: async () => { throw new Error('Not allowed'); }, writeText: async () => { textCopies++; } });
  context.image = new Blob(['png'], { type: 'image/png' });
  run('scheduleImageBlob = () => Promise.resolve(image)');
  await run('copyScheduleImage()');
  assert.equal(context.previews.length, 1);
  assert.equal(context.previews[0].blob.type, 'image/png');
  assert.equal(textCopies, 0);
  assert.equal(context.messages.includes('Schedule image copied'), false);
});

test('browsers without image clipboard support still offer the PNG', async () => {
  const { context, run } = app(undefined);
  context.image = new Blob(['png'], { type: 'image/png' });
  run('scheduleImageBlob = () => Promise.resolve(image)');
  await run('copyScheduleImage()');
  assert.equal(context.previews.length, 1);
});

test('Copy text retains the full schedule and overnight dates', async () => {
  let copied;
  const { run } = app({ writeText: async text => { copied = text; } });
  await run('copyScheduleText()');
  assert.match(copied, /Early flight.*DEN/);
  assert.match(copied, /Dec 9/);
  assert.match(copied, /Leave home/);
  assert.match(copied, /Takeoff/);
});

test('a delayed clipboard rejection cannot open the old trip after navigation', async () => {
  let rejectWrite;
  const { context, run } = app({ write: () => new Promise((_, reject) => { rejectWrite = reject; }) });
  context.image = new Blob(['png'], { type: 'image/png' });
  run('scheduleImageBlob = () => Promise.resolve(image)');
  const pending = run('copyScheduleImage()');
  run("state.view = { name: 'list' }");
  rejectWrite(new Error('Denied'));
  await pending;
  assert.equal(context.previews.length, 0);
});
