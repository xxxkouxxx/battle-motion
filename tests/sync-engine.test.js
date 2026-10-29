// 実行: node outputs/battle-motion/tests/sync-engine.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const E = require('../sync-engine.js');
const battle = require('../battles/sheol-arebati-v25-b2.json');

const events = [
  { id: 'a', order: 1, demoT: 0 },
  { id: 'b', order: 2, demoT: 10 },
  { id: 'c', order: 3, demoT: 30 },
  { id: 'd', order: 4, demoT: 60 }
];
const P = (event, videoT, kind = 'visual') => ({ event, videoT, kind });
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', name); };

t('player未読込/エラーは同期点より優先', () => {
  assert.strictEqual(E.status([P('a', 5), P('c', 25)], events, 'idle').state, 'no-player');
  assert.strictEqual(E.status([P('a', 5), P('c', 25)], events, 'error').state, 'player-error');
});
t('同期点0', () => assert.strictEqual(E.status([], events, 'ready').state, 'none'));
t('同期点1は補間不可・そのイベントにはジャンプ可', () => {
  const pts = [P('b', 100)];
  assert.strictEqual(E.status(pts, events, 'ready').state, 'one');
  assert.strictEqual(E.demoToVideo(pts, events, 10), null);
  assert.deepStrictEqual(E.videoForEvent(pts, events, 'b'), { videoT: 100, estimated: false });
  assert.strictEqual(E.videoForEvent(pts, events, 'c'), null);
});
t('2点以上で双方向補間', () => {
  const pts = [P('a', 100), P('c', 160)];
  assert.strictEqual(E.status(pts, events, 'ready').state, 'synced');
  assert.strictEqual(E.videoToDemo(pts, events, 130).demoT, 15);
  assert.strictEqual(E.demoToVideo(pts, events, 10), 120);
  assert.deepStrictEqual(E.videoForEvent(pts, events, 'b'), { videoT: 120, estimated: true });
});
t('範囲外は推定しない', () => {
  const pts = [P('b', 100), P('c', 160)];
  assert.deepStrictEqual(E.videoToDemo(pts, events, 50), { inRange: false, side: 'before' });
  assert.deepStrictEqual(E.videoToDemo(pts, events, 200), { inRange: false, side: 'after' });
  assert.strictEqual(E.demoToVideo(pts, events, 0), null);
  assert.strictEqual(E.demoToVideo(pts, events, 60), null);
  assert.strictEqual(E.videoForEvent(pts, events, 'd'), null);
});
t('順序矛盾を検出し補間を止める', () => {
  const pts = [P('a', 100), P('b', 90), P('d', 200)];
  const s = E.status(pts, events, 'ready');
  assert.strictEqual(s.state, 'conflict');
  assert.deepStrictEqual(s.conflicts.sort(), ['a', 'b']);
  assert.strictEqual(E.videoToDemo(pts, events, 150).inRange, false);
  assert.strictEqual(E.demoToVideo(pts, events, 30), null);
});
t('同時刻の2点も矛盾扱い（0除算防止）', () => {
  assert.strictEqual(E.status([P('a', 100), P('b', 100)], events, 'ready').state, 'conflict');
});
t('登録前チェック: 上書きと矛盾拒否', () => {
  const pts = [P('a', 100), P('c', 160)];
  assert.strictEqual(E.tryUpsert(pts, events, P('b', 120)).ok, true);
  assert.strictEqual(E.tryUpsert(pts, events, P('b', 170)).ok, false);
  const up = E.tryUpsert(pts, events, P('c', 180));
  assert.strictEqual(up.ok, true);
  assert.strictEqual(up.points.filter(p => p.event === 'c')[0].videoT, 180);
});
t('存在しないイベントの点は無視', () => {
  assert.strictEqual(E.status([P('zz', 5)], events, 'ready').state, 'none');
});
t('Sync Set検証: ID不一致・kind不正・矛盾警告', () => {
  const b = { id: 'x', events };
  const v = { id: 'A', youtubeId: 'yt' };
  const ok = { schema: 'ffxi-battle-motion/sync@1', battleId: 'x', videoId: 'A', youtubeId: 'yt', points: [P('a', 1), P('b', 2)] };
  assert.deepStrictEqual(E.validateSyncSet(ok, b, v), { errors: [], warnings: [] });
  assert.ok(E.validateSyncSet({ ...ok, battleId: 'y' }, b, v).errors.length);
  assert.ok(E.validateSyncSet({ ...ok, videoId: 'B' }, b, v).errors.length);
  assert.ok(E.validateSyncSet({ ...ok, points: [{ event: 'a', videoT: 1, kind: 'guess' }] }, b, v).errors.length);
  assert.ok(E.validateSyncSet({ ...ok, points: [P('a', 1), P('a', 2)] }, b, v).errors.length);
  const w = E.validateSyncSet({ ...ok, points: [P('a', 5), P('b', 2)] }, b, v);
  assert.strictEqual(w.errors.length, 0); assert.strictEqual(w.warnings.length, 1);
});
t('同梱Battle Packが整合している', () => {
  assert.deepStrictEqual(E.validateBattle(battle), []);
  const roles = new Set(battle.roles.map(r => r.id));
  battle.events.forEach(e => e.actions.forEach(a => assert.ok(roles.has(a.role), `${e.id}:${a.role}`)));
  ['PLD', 'DNC', 'RDM', 'COR', 'BRD', 'BST', 'PET'].forEach(r => assert.ok(roles.has(r)));
  assert.ok(battle.events.every(e => e.demoT <= battle.demo.duration));
});
t('目録の全パックと雛形が整合している', () => {
  const idx = require('../battles/index.json');
  const files = idx.battles.map(b => b.file).concat(['battles/_template.json']);
  for (const f of files) {
    const b = require(path.join('..', f));
    assert.deepStrictEqual(E.validateBattle(b), [], f);
    const roles = new Set(b.roles.map(r => r.id));
    b.events.forEach(e => e.actions.forEach(a => assert.ok(roles.has(a.role), `${f} ${e.id}:${a.role}`)));
    const units = new Set(b.demo.units.map(u => u.id));
    b.demo.units.forEach(u => assert.ok(!u.role || roles.has(u.role), `${f} unit ${u.id}`));
    b.demo.fx.forEach(x => [x.src, x.dst, x.at].filter(Boolean).forEach(id => assert.ok(units.has(id), `${f} fx ${id}`)));
  }
});
t('同梱Sync Setが検証を通る', () => {
  for (const v of battle.videos) {
    const s = require(path.join('..', 'sync', `${battle.id}.${v.id}.json`));
    assert.deepStrictEqual(E.validateSyncSet(s, battle, v).errors, []);
  }
});
console.log(`\n${n} tests passed`);
