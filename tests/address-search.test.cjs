const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

function app() {
  const html = readFileSync(join(__dirname, '../public/index.html'), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/render\(\);\s*boot\(\);\s*$/, '');
  const context = vm.createContext({
    URL, URLSearchParams, console, setTimeout, clearTimeout, setInterval() {},
    document: { addEventListener() {} }, window: { addEventListener() {} },
  });
  vm.runInContext(script, context);
  return code => vm.runInContext(code, context);
}

test('matching addresses near the airport rank ahead of distant alphabetical matches', () => {
  const run = app();
  assert.equal(run(`rankByAirport([
    { id: 'far', lat: 40.7, lon: -74 },
    { id: 'near', lat: 39.74, lon: -104.99 }
  ], { lat: 39.8493, lon: -104.6738 }).map(x => x.id).join(',')`), 'near,far');
});

test('proximity ranking handles the international date line', () => {
  const run = app();
  assert.equal(run(`rankByAirport([
    { id: 'far', lat: 0, lon: 150 },
    { id: 'near', lat: 0, lon: -179.9 }
  ], { lat: 0, lon: 179.9 })[0].id`), 'near');
});

test('missing coordinates rank after usable results', () => {
  const run = app();
  assert.equal(run(`rankByAirport([
    { id: 'invalid', lat: 'bad', lon: 0 },
    { id: 'valid', lat: 39.74, lon: -104.99 }
  ], { lat: 39.8493, lon: -104.6738 })[0].id`), 'valid');
});

test('airport search bias boosts the nearby area without excluding other states', () => {
  const run = app();
  const value = run(`addressSearchURL('123 Main St & Ave', { lat: 39.8493, lon: -104.6738 })`);
  const params = new URL(value).searchParams;
  assert.equal(params.get('q'), '123 Main St & Ave');
  assert.equal(params.get('bounded'), '0');
  const [west, north, east, south] = params.get('viewbox').split(',').map(Number);
  assert.ok(west < -104.6738 && east > -104.6738);
  assert.ok(north > 39.8493 && south < 39.8493);
});

test('saved places filter by name and address, then rank by airport proximity', () => {
  const run = app();
  assert.equal(run(`matchingSavedPlaces('main', { lat: 39.8493, lon: -104.6738 }, [
    { id: 'far', name: 'Main office', label: 'New York', lat: 40.7, lon: -74 },
    { id: 'near', name: 'Home', label: '123 Main St, Denver', lat: 39.74, lon: -104.99 },
    { id: 'other', name: 'Hotel', label: 'Airport road', lat: 39.85, lon: -104.67 }
  ]).map(x => x.id).join(',')`), 'near,far');
});
