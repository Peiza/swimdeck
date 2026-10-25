import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitName, parseList, matchScore, rankCandidates } from '../importer.js';

test('splitName handles the usual layouts', () => {
  assert.deepEqual(splitName('ANDERSSON Anna'), { first: 'Anna', last: 'Andersson' });
  assert.deepEqual(splitName('VON ESSEN Anna Maria'), { first: 'Anna Maria', last: 'Von Essen' });
  assert.deepEqual(splitName('Andersson, Anna'), { first: 'Anna', last: 'Andersson' });
  assert.deepEqual(splitName('Anna Andersson'), { first: 'Anna', last: 'Andersson' });
  assert.equal(splitName('Örebro'), null);
});

test('parseList reads a start list with headings, lanes, times and clubs', () => {
  const text = `
Gren 3 - 100m frisim flickor 13-14 år
Heat 1 av 2
Bana Namn Född Klubb Anm.tid
1  ANDERSSON Anna        2012  Örebro Simallians   1:05.23
2  Lind, Saga (2013) Simklubben Vågen 1:07,10
3  Maja Berg   2012   Exempelstadens SS   NT

Gren 4 - 50m ryggsim pojkar
4  ANDERSSON Anna        2012  Örebro Simallians   35.20
5  Noah Ek\t2013\tHavsörnarna SK
`;
  const { entries, groups } = parseList(text, 2026);
  assert.deepEqual(groups, ['Gren 3 - 100m frisim flickor 13-14 år', 'Gren 4 - 50m ryggsim pojkar']);
  const simple = entries.map((e) => [e.first, e.last, e.born, e.club, e.groups.length]);
  assert.deepEqual(simple, [
    ['Anna', 'Andersson', 2012, 'Örebro Simallians', 2],
    ['Saga', 'Lind', 2013, 'Simklubben Vågen', 1],
    ['Maja', 'Berg', 2012, 'Exempelstadens SS', 1],
    ['Noah', 'Ek', 2013, 'Havsörnarna SK', 1],
  ]);
});

test('parseList without birth years', () => {
  const { entries } = parseList('Anna Andersson\tÖrebro Simallians\nOlle Nilsson - Täby Sim', 2026);
  assert.deepEqual(entries.map((e) => [e.first, e.last, e.born, e.club]), [['Anna', 'Andersson', null, 'Örebro Simallians'], ['Olle', 'Nilsson', null, 'Täby Sim']]);
});

test('matching prefers same name, birth year and club', () => {
  const entry = { first: 'Anna', last: 'Andersson', born: 2012, club: 'Örebro Simallians' };
  const a = { id: 1, firstName: 'Anna', lastName: 'Andersson', born: 2012, club: 'Örebro Simallians' };
  const b = { id: 2, firstName: 'Anna', lastName: 'Andersson', born: 1985, club: 'Malmö KK' };
  const c = { id: 3, firstName: 'Annika', lastName: 'Andersson', born: 2012, club: 'Örebro Simallians' };
  assert.ok(matchScore(entry, a) > matchScore(entry, c));
  assert.ok(matchScore(entry, b) < 3.5);
  const r = rankCandidates(entry, [b, c, a]);
  assert.equal(r.candidates[0].id, 1);
  assert.equal(r.sure, true);
  assert.equal(rankCandidates({ first: 'Anna', last: 'Andersson', born: null, club: '' }, [a, b]).sure, false);
});

test('one value per line (Swimify copy) with names run together', () => {
  const text = `flag Swe
Örebro Simallians logo
Örebro Simallians
7
SelmaWalterdahl
2011
Örebro Simallians
2:45.59
9
TyraSjöstrand
2011
Örebro Simallians
2:55.81
16
AmyGidlöf Järvinen
2013
Örebro Simallians
3:19.49`;
  const { entries } = parseList(text, 2026);
  assert.deepEqual(entries.map((e) => [e.first, e.last, e.born, e.club]), [
    ['Selma', 'Walterdahl', 2011, 'Örebro Simallians'],
    ['Tyra', 'Sjöstrand', 2011, 'Örebro Simallians'],
    ['Amy', 'Gidlöf Järvinen', 2013, 'Örebro Simallians'],
  ]);
});
