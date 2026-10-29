/* Battle Motion Studio — 同期エンジン（純関数のみ。DOM・YouTubeに依存しない）
 * 動画時刻 videoT と 圧縮デモ時刻 demoT を、手動登録した同期点の間だけ区分線形補間する。
 * 同期点の外側は推定しない（null / inRange:false を返す）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SyncEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const KINDS = ['visual', 'assumption'];

  // 同期点を戦術順（event.order）に並べ、demoT を付与する。存在しないイベントの点は除外。
  function normalize(points, events) {
    const byId = new Map(events.map(e => [e.id, e]));
    return (points || [])
      .filter(p => byId.has(p.event) && Number.isFinite(p.videoT) && p.videoT >= 0)
      .map(p => ({ ...p, order: byId.get(p.event).order, demoT: byId.get(p.event).demoT }))
      .sort((a, b) => a.order - b.order);
  }

  // 戦術順に並べたとき videoT と demoT がともに厳密に増加しているか。違反した点のイベントIDを返す。
  function findConflicts(norm) {
    const bad = new Set();
    for (let i = 1; i < norm.length; i++) {
      const a = norm[i - 1], b = norm[i];
      if (!(b.videoT > a.videoT) || !(b.demoT > a.demoT)) { bad.add(a.event); bad.add(b.event); }
    }
    return [...bad];
  }

  /* 状態判定
   * player: 'idle' | 'loading' | 'ready' | 'error'
   * 返り値 state: 'player-error' | 'no-player' | 'none' | 'one' | 'conflict' | 'synced'
   */
  function status(points, events, player) {
    const norm = normalize(points, events);
    const conflicts = findConflicts(norm);
    let state;
    if (player === 'error') state = 'player-error';
    else if (player !== 'ready') state = 'no-player';
    else if (norm.length === 0) state = 'none';
    else if (conflicts.length) state = 'conflict';
    else if (norm.length === 1) state = 'one';
    else state = 'synced';
    return {
      state, count: norm.length, conflicts, points: norm,
      range: norm.length >= 2 && !conflicts.length
        ? { video: [norm[0].videoT, norm[norm.length - 1].videoT], demo: [norm[0].demoT, norm[norm.length - 1].demoT] }
        : null
    };
  }

  function lerp(norm, x, from, to) {
    if (norm.length < 2 || findConflicts(norm).length) return null;
    const first = norm[0], last = norm[norm.length - 1];
    if (x < first[from] || x > last[from]) return null;
    for (let i = 1; i < norm.length; i++) {
      const a = norm[i - 1], b = norm[i];
      if (x <= b[from]) return a[to] + (x - a[from]) / (b[from] - a[from]) * (b[to] - a[to]);
    }
    return null;
  }

  // 動画時刻 → デモ時刻。範囲外は { inRange:false, side:'before'|'after' }。
  function videoToDemo(points, events, videoT) {
    const norm = normalize(points, events);
    const v = lerp(norm, videoT, 'videoT', 'demoT');
    if (v !== null) return { inRange: true, demoT: v, exact: norm.some(p => p.videoT === videoT) };
    if (norm.length >= 2 && !findConflicts(norm).length) return { inRange: false, side: videoT < norm[0].videoT ? 'before' : 'after' };
    return { inRange: false, side: null };
  }

  // デモ時刻 → 動画時刻。範囲外・同期不成立は null。
  function demoToVideo(points, events, demoT) {
    return lerp(normalize(points, events), demoT, 'demoT', 'videoT');
  }

  // 1イベントへの直接ジャンプ（その点が登録済みなら videoT、なければ補間、どちらも無理なら null）。
  function videoForEvent(points, events, eventId) {
    const p = (points || []).find(x => x.event === eventId && Number.isFinite(x.videoT));
    if (p) return { videoT: p.videoT, estimated: false };
    const ev = events.find(e => e.id === eventId);
    if (!ev) return null;
    const v = demoToVideo(points, events, ev.demoT);
    return v === null ? null : { videoT: v, estimated: true };
  }

  // 1点を追加・上書きした結果が矛盾しないか（登録前チェック用）。
  function tryUpsert(points, events, point) {
    const next = (points || []).filter(p => p.event !== point.event).concat([point]);
    const conflicts = findConflicts(normalize(next, events));
    return { ok: conflicts.length === 0, points: next, conflicts };
  }

  // Sync Set JSON の検証。致命的な不整合は errors、順序矛盾などは warnings。
  function validateSyncSet(obj, battle, video) {
    const errors = [], warnings = [];
    if (!obj || typeof obj !== 'object') return { errors: ['JSONの形式が不正です'], warnings };
    if (obj.schema !== 'ffxi-battle-motion/sync@1') errors.push('schema が ffxi-battle-motion/sync@1 ではありません');
    if (obj.battleId !== battle.id) errors.push(`battleId が一致しません（${obj.battleId} ≠ ${battle.id}）`);
    if (obj.videoId !== video.id || obj.youtubeId !== video.youtubeId) errors.push(`動画が一致しません（${obj.videoId}/${obj.youtubeId}）`);
    if (!Array.isArray(obj.points)) errors.push('points が配列ではありません');
    if (errors.length) return { errors, warnings };
    const ids = new Set(battle.events.map(e => e.id));
    const seen = new Set();
    obj.points.forEach((p, i) => {
      if (!ids.has(p.event)) errors.push(`points[${i}] のイベント ${p.event} が存在しません`);
      if (seen.has(p.event)) errors.push(`points[${i}] のイベント ${p.event} が重複しています`);
      seen.add(p.event);
      if (!Number.isFinite(p.videoT) || p.videoT < 0) errors.push(`points[${i}] の videoT が不正です`);
      if (!KINDS.includes(p.kind)) errors.push(`points[${i}] の kind は visual / assumption のどちらかが必要です`);
    });
    if (!errors.length) {
      const c = findConflicts(normalize(obj.points, battle.events));
      if (c.length) warnings.push('戦術順と動画時刻が矛盾する同期点があります: ' + c.join(', '));
    }
    return { errors, warnings };
  }

  // Battle Pack の最低限の整合チェック（order一意・demoT非減少・prov値）。
  const PROVS = ['article', 'visual', 'assumption', 'unverified'];
  function validateBattle(b) {
    const errors = [];
    if (!b || b.schema !== 'ffxi-battle-motion/battle@1') return ['schema が ffxi-battle-motion/battle@1 ではありません'];
    const ev = [...(b.events || [])].sort((x, y) => x.order - y.order);
    const orders = new Set(), ids = new Set();
    ev.forEach((e, i) => {
      if (ids.has(e.id)) errors.push(`イベントID重複: ${e.id}`); ids.add(e.id);
      if (orders.has(e.order)) errors.push(`order重複: ${e.order}`); orders.add(e.order);
      if (i && !(e.demoT > ev[i - 1].demoT)) errors.push(`demoT が戦術順に増加していません: ${e.id}`);
      if (!PROVS.includes(e.prov)) errors.push(`prov不正: ${e.id}`);
      (e.actions || []).forEach(a => { if (!PROVS.includes(a.prov)) errors.push(`prov不正: ${e.id}/${a.role}`); });
    });
    return errors;
  }

  return { KINDS, PROVS, normalize, findConflicts, status, videoToDemo, demoToVideo, videoForEvent, tryUpsert, validateSyncSet, validateBattle };
});
