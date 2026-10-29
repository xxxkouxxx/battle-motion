/* Battle Motion Studio — UI。データは battles/*.json と sync/*.json から読み込む。
 * 描画はすべて textContent / setAttribute（外部JSONを innerHTML に流さない）。
 */
(() => {
  'use strict';
  const E = window.SyncEngine;
  const $ = id => document.getElementById(id);
  const SVGNS = 'http://www.w3.org/2000/svg';
  const LS_JOB = 'bms:v1:job';
  const lsKey = (b, v) => `bms:v1:sync:${b}:${v}`;
  const PROV_LABEL = { article: '記事', visual: '映像', assumption: '演出用', unverified: '未確認' };
  const KIND_LABEL = { visual: '映像で確認', assumption: '仮置き' };
  const FX_STYLE = {
    move:   { color: '#8eb4ff', dash: '6 5', w: 2.5, arrow: true },
    debuff: { color: '#ff9a90', dash: '4 4', w: 2.2, arrow: true },
    hate:   { color: '#8eb4ff', dash: '',    w: 3,   arrow: true },
    ws:     { color: '#ff7f88', dash: '',    w: 3.2, arrow: true },
    aa:     { color: '#c5d4e4', dash: '3 6', w: 1.2, arrow: false },
    ranged: { color: '#ffc35c', dash: '1 6', w: 2,   arrow: true },
    drain:  { color: '#75f5c6', dash: '6 4', w: 3,   arrow: true },
    buff:   { color: '#b49bff', dash: '4 3', w: 2.4, arrow: true }
  };

  // ---------- helpers ----------
  const h = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (const c of kids.flat()) if (c != null) n.append(c instanceof Node ? c : String(c));
    return n;
  };
  const s = (tag, attrs = {}, text) => {
    const n = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text != null) n.textContent = text;
    return n;
  };
  const mmss = v => { if (!Number.isFinite(v)) return '--:--'; v = Math.max(0, Math.floor(v)); return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`; };
  const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* 保存不可環境でも動作は継続 */ } };
  const provBadge = p => h('span', { class: `prov ${p}`, title: PROV_LABEL[p] || p }, PROV_LABEL[p] || p);
  const fetchJSON = async url => { const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json(); };

  // ---------- state ----------
  const st = {
    index: null, battle: null, roles: new Map(), events: [],
    videoId: null, points: [], pointsSrc: 'bundled', bundled: {},
    job: lsGet(LS_JOB) || 'ALL',
    time: 0, playing: false, speed: 1, trails: true, last: 0,
    player: null, playerState: 'idle', videoPlaying: false, outside: false, lastIx: -1
  };
  const video = () => st.battle.videos.find(v => v.id === st.videoId);
  const sorted = () => st.events;
  const currentIndex = t => { let ix = 0; st.events.forEach((e, i) => { if (e.demoT <= t + 1e-6) ix = i; }); return ix; };
  const syncStatus = () => E.status(st.points, st.events, st.playerState);
  // 選択中ジョブの行動か（ペットなど owner 指定のロールは持ち主のジョブに含める）
  const isMine = rid => st.job !== 'ALL' && (rid === st.job || (st.roles.get(rid) || {}).owner === st.job);

  // ---------- boot ----------
  async function boot() {
    if (location.protocol === 'file:') {
      $('title').textContent = 'HTTPサーバーで開いてください';
      $('summary').textContent = 'このツールは file:// ではデータと動画を読み込めません。フォルダで「python -m http.server 8765」を実行し、http://localhost:8765/ を開いてください。';
      return;
    }
    try {
      st.index = await fetchJSON('battles/index.json');
      const sel = $('battleSel');
      sel.replaceChildren(...st.index.battles.map(b => h('option', { value: b.id }, b.title)));
      const want = new URLSearchParams(location.search).get('battle');
      const first = st.index.battles.find(b => b.id === want) || st.index.battles[0];
      sel.value = first.id;
      sel.onchange = () => { const u = new URL(location.href); u.searchParams.set('battle', sel.value); location.href = u.toString(); };
      await loadBattle(first);
    } catch (e) {
      $('title').textContent = 'データを読み込めませんでした';
      $('summary').textContent = String(e.message || e);
      return;
    }
    wire();
    requestAnimationFrame(now => { st.last = now; requestAnimationFrame(loop); });
  }

  async function loadBattle(entry) {
    const b = await fetchJSON(entry.file);
    const errs = E.validateBattle(b);
    if (errs.length) throw new Error('戦闘データの不整合: ' + errs.join(' / '));
    st.battle = b;
    st.events = [...b.events].sort((x, y) => x.order - y.order);
    st.roles = new Map(b.roles.map(r => [r.id, r]));
    if (st.job !== 'ALL' && !st.roles.has(st.job)) st.job = 'ALL';
    for (const v of b.videos) {
      try {
        const sy = await fetchJSON(`sync/${b.id}.${v.id}.json`);
        const chk = E.validateSyncSet(sy, b, v);
        st.bundled[v.id] = chk.errors.length ? [] : sy.points;
      } catch { st.bundled[v.id] = []; }
    }
    document.title = `${b.title} 予習`;
    $('title').textContent = `${b.title} 予習`;
    $('summary').textContent = b.summary || '';
    const art = b.sources.find(x => x.kind === 'article');
    if (art) $('articleLink').href = art.url; else $('articleLink').hidden = true;
    $('disclaimer').textContent = `図の位置・動き・HP・秒数は説明用の仮のものです（${b.demo.note}）。動画との対応は人が目で見て登録した範囲だけ動きます。`;
    $('bossName').textContent = b.boss;
    $('seek').max = b.demo.duration;
    $('dTotal').textContent = mmss(b.demo.duration);
    $('credits').replaceChildren(
      '出典：', ...b.sources.map(x => h('a', { href: x.url, target: '_blank', rel: 'noopener' }, x.title)),
      ' ／ 動画：', ...b.videos.flatMap((v, i) => [i ? '・' : '', h('a', { href: `https://www.youtube.com/watch?v=${v.youtubeId}`, target: '_blank', rel: 'noopener' }, `${v.label}（${v.author}）`)]),
      '。FFXIのゲーム素材や動画は複製していません。動画はYouTube公式プレイヤーで再生します。'
    );
    buildJobChips(); buildLegend(); buildTimeline(); buildEventSelect(); buildZones();
    buildVideoTabs();
    switchVideo(b.videos[0].id);
    selectJob(st.job);
  }

  // ---------- job ----------
  function buildJobChips() {
    const all = [{ id: 'ALL', short: '全体', name: '全体を見る', color: '#9db0c4' }, ...st.battle.roles];
    $('jobChips').replaceChildren(...all.map(r => h('button', {
      class: 'chip', 'data-id': r.id, 'aria-pressed': 'false', title: r.name, onclick: () => selectJob(r.id)
    }, h('i', { style: { background: r.color } }), r.id === 'ALL' ? r.short : r.name)));
  }
  function selectJob(id) {
    st.job = id; lsSet(LS_JOB, id);
    for (const b of $('jobChips').children) b.setAttribute('aria-pressed', String(b.dataset.id === id));
    buildSheet(); buildTimeline(); st.lastIx = -1; render();
  }
  function buildLegend() {
    $('legend').replaceChildren(...st.battle.roles.map(r => h('span', {}, h('i', { style: { background: r.color } }), r.name)));
  }

  function buildSheet() {
    const box = $('sheet');
    if (st.job === 'ALL') {
      $('sheetTitle').textContent = 'ジョブ別の役割';
      box.replaceChildren(...st.battle.roles.map(r => h('div', { style: { margin: '0 0 10px' } },
        h('span', { class: 'role', style: { background: r.color } }, r.short), ' ', h('b', {}, r.name), '：', r.duty, ' ', provBadge(r.prov))),
        h('p', { class: 'small' }, '上でジョブを選ぶと、そのジョブのやること一覧（印刷用）になります。'));
      return;
    }
    const r = st.roles.get(st.job);
    $('sheetTitle').textContent = `${r.name}のやること一覧`;
    const steps = [];
    for (const e of st.events) for (const a of e.actions) if (isMine(a.role)) steps.push({ e, a });
    box.replaceChildren(
      h('div', {}, h('b', {}, '役割：'), r.duty, ' ', provBadge(r.prov), r.src ? h('span', { class: 'small' }, `（${r.src}）`) : null),
      h('ul', {}, r.notes.map(n => h('li', {}, n))),
      h('ol', {}, steps.length ? steps.map(({ e, a }) => h('li', {},
        h('b', {}, `${e.phase}｜`), a.role !== r.id ? `[${st.roles.get(a.role).name}] ` : '', a.do, a.target ? `（→${a.target}）` : '', ' ', provBadge(a.prov),
        h('div', { class: 'small' }, `きっかけ：${e.trigger}　理由：${a.why || '—'}`))) : h('li', {}, '記事に固有の行動の記載がありません。'))
    );
  }

  // ---------- timeline ----------
  function buildTimeline() {
    if (!st.battle) return;
    $('timeline').replaceChildren(...st.events.map((e, i) => {
      const mine = st.job !== 'ALL' && e.actions.some(a => isMine(a.role));
      return h('li', {}, h('button', { 'data-ix': i, onclick: () => jumpToEvent(e) },
        h('span', { class: 't' }, mmss(e.demoT)),
        h('span', { class: 'ttl' }, e.title, mine ? h('span', { class: 'star' }, '★あなた') : null),
        h('span', { class: 'ph' }, e.phase),
        h('span', { class: 'vt', 'data-vt': e.id })));
    }));
    updateTimelineVideoTimes();
  }
  function updateTimelineVideoTimes() {
    for (const el of $('timeline').querySelectorAll('[data-vt]')) {
      const r = E.videoForEvent(st.points, st.events, el.dataset.vt);
      el.textContent = r ? `動画 ${mmss(r.videoT)}${r.estimated ? '（推定）' : ''}` : '';
    }
  }

  // ---------- video ----------
  function buildVideoTabs() {
    $('videoTabs').replaceChildren(...st.battle.videos.map(v => h('button', {
      'data-id': v.id, 'aria-pressed': 'false', onclick: () => switchVideo(v.id)
    }, v.label)));
  }
  function loadPointsFor(v) {
    const raw = lsGet(lsKey(st.battle.id, v.id));
    if (raw) {
      try {
        const obj = JSON.parse(raw);
        if (!E.validateSyncSet(obj, st.battle, v).errors.length) { st.points = obj.points; st.pointsSrc = 'local'; return; }
      } catch { /* 壊れた保存は無視して同梱データへ */ }
    }
    st.points = (st.bundled[v.id] || []).map(p => ({ ...p }));
    st.pointsSrc = 'bundled';
  }
  function switchVideo(id) {
    st.videoId = id;
    const v = video();
    for (const b of $('videoTabs').children) b.setAttribute('aria-pressed', String(b.dataset.id === id));
    $('vLink').href = `https://www.youtube.com/watch?v=${v.youtubeId}`;
    $('vPov').replaceChildren(`2戦目の視点：${v.pov[String(st.battle.fight)] || '—'} `, provBadge(v.povProv));
    loadPointsFor(v);
    if (st.player && st.playerState === 'ready') { st.player.cueVideoById(v.youtubeId); st.videoPlaying = false; }
    refreshSync();
  }
  function loadVideo() {
    if (st.playerState === 'ready' || st.playerState === 'loading') return;
    st.playerState = 'loading';
    $('phText').textContent = 'YouTubeの公式プレイヤーを読み込んでいます…';
    $('loadVideo').disabled = true;
    const create = () => {
      try {
        st.player = new YT.Player('yt', {
          videoId: video().youtubeId,
          playerVars: { playsinline: 1, rel: 0, origin: location.origin },
          events: {
            onReady: () => { st.playerState = 'ready'; $('ph').hidden = true; refreshSync(); },
            onStateChange: e => { st.videoPlaying = e.data === YT.PlayerState.PLAYING; updatePlayBtn(); },
            onError: e => failVideo(`YouTube側で再生できません（エラー ${e.data}）。埋め込みが制限されている可能性があります。「YouTubeで開く」から視聴し、下の図は単独で再生できます。`)
          }
        });
      } catch (err) { failVideo('プレイヤーを作成できませんでした：' + err.message); }
    };
    if (window.YT && window.YT.Player) return create();
    window.onYouTubeIframeAPIReady = create;
    const sc = document.createElement('script');
    sc.src = 'https://www.youtube.com/iframe_api';
    sc.onerror = () => failVideo('YouTube APIを読み込めません（オフラインまたはブロック）。「YouTubeで開く」から視聴し、下の図は単独で再生できます。');
    document.head.appendChild(sc);
    setTimeout(() => { if (st.playerState === 'loading') failVideo('YouTubeプレイヤーの読み込みがタイムアウトしました。'); }, 15000);
  }
  function failVideo(msg) {
    st.playerState = 'error';
    $('ph').hidden = false;
    $('phText').textContent = msg;
    $('loadVideo').disabled = false;
    $('loadVideo').textContent = 'もう一度読み込む';
    $('loadVideo').onclick = () => { st.playerState = 'idle'; if (st.player) { try { st.player.destroy(); } catch { } st.player = null; } loadVideo(); };
    refreshSync();
  }
  const vNow = () => { try { return st.player.getCurrentTime(); } catch { return NaN; } };

  // ---------- sync UI ----------
  function refreshSync(msg) {
    const ss = syncStatus();
    const b = $('syncBanner');
    const v = video();
    const range = ss.range ? `動画 ${mmss(ss.range.video[0])}〜${mmss(ss.range.video[1])}` : '';
    const map = {
      'player-error': ['err', '動画を再生できません。図は単独で再生できます。'],
      'no-player': ['warn', ss.count >= 2 && !ss.conflicts.length
        ? `${v.label}：同期点 ${ss.count} 個あり。動画を読み込むと、${range} の間で図が動画に追従します。`
        : `${v.label}：${ss.count ? `同期点 ${ss.count} 個（2個以上で追従）` : 'まだ動画との同期点がありません'}。図は単独で再生できます。`],
      none: ['warn', `${v.label}：まだ動画との同期点がありません。図は単独で再生できます（編集者向けの欄から登録できます）。`],
      one: ['warn', `${v.label}：同期点が1個だけです。その場面へのジャンプのみ可能で、追従にはもう1個必要です。`],
      conflict: ['err', `${v.label}：同期点の順番が戦術の順番と食い違っています（${ss.conflicts.join(', ')}）。編集者向けの欄で直してください。追従は止めています。`],
      synced: ['ok', `${v.label}：同期中（${ss.count}点・${range}）。点と点の間は推定です。この範囲の外では図は動きません。`]
    };
    const [cls, text] = map[ss.state];
    b.className = `banner ${cls}`;
    b.textContent = text;
    renderPoints(ss);
    updateTimelineVideoTimes();
    updatePlayBtn();
    if (msg) editMsg(msg);
  }
  function editMsg(text, cls = 'warn') {
    const m = $('editMsg');
    m.style.display = text ? '' : 'none';
    m.className = `banner ${cls}`;
    m.textContent = text || '';
  }
  function renderPoints(ss) {
    $('srcLabel').textContent = st.pointsSrc === 'local' ? 'この端末で編集中' : '同梱データ';
    const list = $('points');
    if (!ss.points.length) { list.replaceChildren(h('li', { class: 'empty' }, '登録なし')); return; }
    const evById = new Map(st.events.map(e => [e.id, e]));
    list.replaceChildren(...ss.points.map(p => h('li', { class: ss.conflicts.includes(p.event) ? 'bad' : '' },
      h('span', {}, h('b', {}, mmss(p.videoT)), ` → ${evById.get(p.event).title} `, h('span', { class: `prov ${p.kind}` }, KIND_LABEL[p.kind]), p.note ? h('span', { class: 'small' }, ` ${p.note}`) : null),
      h('span', { style: { display: 'flex', gap: '6px' } },
        h('button', { onclick: () => seekVideo(p.videoT) }, '見る'),
        h('button', { onclick: () => { p.kind = p.kind === 'visual' ? 'assumption' : 'visual'; savePoints(); } }, '区分切替'),
        h('button', { onclick: () => { st.points = st.points.filter(x => x.event !== p.event); savePoints(); } }, '削除')))));
  }
  function savePoints() {
    const v = video();
    lsSet(lsKey(st.battle.id, v.id), JSON.stringify(syncSetObj()));
    st.pointsSrc = 'local';
    refreshSync();
  }
  const syncSetObj = () => {
    const v = video();
    return {
      schema: 'ffxi-battle-motion/sync@1', battleId: st.battle.id, videoId: v.id, youtubeId: v.youtubeId,
      fight: st.battle.fight, exported: new Date().toISOString(),
      note: 'kind=visual は映像で目視確認、assumption は演出用の仮置き。動画からの自動推定は行っていない。',
      points: st.points.map(({ event, videoT, kind, note, at }) => ({ event, videoT, kind, ...(note ? { note } : {}), ...(at ? { at } : {}) }))
    };
  };

  function buildEventSelect() {
    $('evSel').replaceChildren(...st.events.map(e => h('option', { value: e.id }, `${String(e.order).padStart(2, '0')}. ${e.title}（${e.phase}）`)));
  }

  // ---------- seeking ----------
  function seekVideo(vt) {
    if (st.playerState !== 'ready') { editMsg('先に動画を読み込んでください。'); return; }
    st.player.seekTo(vt, true);
  }
  function setDemo(t) {
    st.time = Math.min(st.battle.demo.duration, Math.max(0, t));
    render();
  }
  // 図側の操作。同期中なら動画も動かす。範囲外なら図だけ動かして理由を出す。
  function seekDemo(t) {
    setDemo(t);
    const ss = syncStatus();
    if (ss.state === 'synced') {
      const vt = E.demoToVideo(st.points, st.events, st.time);
      if (vt !== null) { st.player.seekTo(vt, true); st.outside = false; st.hold = null; hideOutside(); }
      else showOutside('この場面は動画との同期範囲の外です（図だけ表示しています。動画を動かすと追従に戻ります）', true);
    }
  }
  function jumpToEvent(e) {
    $('evSel').value = e.id;
    const ss = syncStatus();
    if (st.playerState === 'ready' && (ss.state === 'synced' || ss.state === 'one')) {
      const r = E.videoForEvent(st.points, st.events, e.id);
      if (r) { st.player.seekTo(r.videoT, true); setDemo(e.demoT); st.outside = false; st.hold = null; hideOutside(); return; }
    }
    setDemo(e.demoT);
    if (ss.state === 'synced') showOutside('この場面は動画との同期範囲の外です（図だけ表示しています。動画を動かすと追従に戻ります）', true);
  }
  function showOutside(text, hold = false) {
    const o = $('outside'); o.textContent = text; o.classList.add('on');
    if (hold && st.playerState === 'ready') { st.hold = vNow(); st.outside = true; }
  }
  function hideOutside() { $('outside').classList.remove('on'); }

  function updatePlayBtn() {
    const follow = syncStatus().state === 'synced';
    const on = follow ? st.videoPlaying : st.playing;
    $('play').textContent = on ? '❚❚ 一時停止' : '▶ 再生';
    $('play').title = follow ? '動画を再生・一時停止（図は動画に追従）' : '図のデモを再生・一時停止';
    $('speed').disabled = follow;
  }

  // ---------- map ----------
  function buildZones() {
    const g = $('gZones'); g.replaceChildren();
    const m = st.battle.demo.map;
    $('map').setAttribute('viewBox', `0 0 ${m.width} ${m.height}`);
    for (const z of m.zones || []) {
      g.append(s('rect', { x: z.x, y: z.y, width: z.w, height: z.h, rx: 12, fill: '#ffffff', 'fill-opacity': '.04', stroke: '#9db0c4', 'stroke-opacity': '.35', 'stroke-dasharray': '6 6' }));
      g.append(s('text', { x: z.x + 10, y: z.y - 8, fill: '#9db0c4', 'font-size': 14 }, z.label));
    }
    g.append(s('text', { x: m.width - 12, y: m.height - 12, fill: '#9db0c4', 'font-size': 12, 'text-anchor': 'end', opacity: '.8' }, '模式図：距離・方向は実際のBFと無関係'));
  }
  const ease = q => q * q * (3 - 2 * q);
  function posAt(keys, t) {
    if (t <= keys[0][0]) return [keys[0][1], keys[0][2]];
    for (let i = 1; i < keys.length; i++) {
      if (t <= keys[i][0]) {
        const [ta, xa, ya] = keys[i - 1], [tb, xb, yb] = keys[i];
        const q = ease((t - ta) / (tb - ta));
        return [xa + (xb - xa) * q, ya + (yb - ya) * q];
      }
    }
    const k = keys[keys.length - 1]; return [k[1], k[2]];
  }
  function hpAt(t) {
    const p = st.battle.demo.hp;
    if (t <= p[0][0]) return p[0][1];
    for (let i = 1; i < p.length; i++) if (t <= p[i][0]) return p[i - 1][1] + (p[i][1] - p[i - 1][1]) * (t - p[i - 1][0]) / (p[i][0] - p[i - 1][0]);
    return p[p.length - 1][1];
  }
  function unitInfo(u) {
    if (u.role) { const r = st.roles.get(u.role); return { color: r.color, short: r.short, label: r.name, size: u.size || 19, ally: true }; }
    return { color: u.color, short: u.short, label: u.label, size: u.size || 20, ally: false };
  }
  function renderMap() {
    const d = st.battle.demo, t = st.time, sel = st.job;
    const pos = {};
    const vis = d.units.filter(u => u.appear == null || t >= u.appear);
    for (const u of vis) pos[u.id] = posAt(u.keys, t);
    const gT = $('gTrails'), gF = $('gFx'), gU = $('gUnits'), gL = $('gLabels');
    gT.replaceChildren(); gF.replaceChildren(); gU.replaceChildren(); gL.replaceChildren();

    if (st.trails) for (const u of vis) if (u.role) {
      const pts = u.keys.filter(k => k[0] <= t).map(k => [k[1], k[2]]); pts.push(pos[u.id]);
      if (pts.length > 1) {
        const mine = isMine(u.role);
        gT.append(s('polyline', { points: pts.map(p => p.join(',')).join(' '), fill: 'none', stroke: unitInfo(u).color, 'stroke-width': mine ? 2.6 : 1.2, opacity: mine ? .7 : .25, 'stroke-dasharray': '5 6' }));
      }
    }

    const labels = [];
    for (const f of d.fx) {
      if (t < f.from || t > f.to) continue;
      if (f.pulse) { const [per, duty, off] = f.pulse; if (((t + off) % per) / per >= duty) continue; }
      if (f.type === 'line') {
        const a = pos[f.src], b = pos[f.dst]; if (!a || !b) continue;
        const stl = FX_STYLE[f.style] || FX_STYLE.move;
        const srcRole = (d.units.find(u => u.id === f.src) || {}).role;
        const focus = sel === 'ALL' || isMine(srcRole);
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        const rb = unitInfo(d.units.find(u => u.id === f.dst)).size + 6;
        const ra = unitInfo(d.units.find(u => u.id === f.src)).size + 2;
        gF.append(s('line', {
          x1: a[0] + Math.cos(ang) * ra, y1: a[1] + Math.sin(ang) * ra, x2: b[0] - Math.cos(ang) * rb, y2: b[1] - Math.sin(ang) * rb,
          stroke: stl.color, 'stroke-width': focus ? stl.w + (sel !== 'ALL' ? 1 : 0) : stl.w * .7, 'stroke-dasharray': stl.dash,
          'stroke-linecap': 'round', opacity: focus ? .95 : .25, ...(stl.arrow ? { 'marker-end': 'url(#arw)' } : {})
        }));
        if (f.text && focus) labels.push({ x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 - 14, text: f.text, color: stl.color });
      } else if (f.type === 'label') {
        const p = pos[f.at]; if (!p) continue;
        labels.push({ x: p[0], y: p[1] + (f.dy || -50), text: f.text, color: f.color || '#fff' });
      }
    }

    for (const u of vis) {
      const inf = unitInfo(u), p = pos[u.id], mine = u.role && isMine(u.role), dim = u.role && sel !== 'ALL' && !mine;
      const g = s('g', { opacity: dim ? .55 : 1 });
      if (u.role) { g.setAttribute('style', 'cursor:pointer'); g.addEventListener('click', () => selectJob(u.role)); }
      if (mine) g.append(s('circle', { cx: p[0], cy: p[1], r: inf.size + 14, fill: inf.color, 'fill-opacity': .12, stroke: inf.color, 'stroke-width': 2, 'stroke-dasharray': '5 4' }));
      if (!inf.ally) g.append(s('circle', { cx: p[0], cy: p[1], r: inf.size + 7, fill: inf.color, 'fill-opacity': .12, stroke: inf.color, 'stroke-opacity': .6, 'stroke-dasharray': '4 4' }));
      g.append(s('circle', { cx: p[0], cy: p[1], r: inf.size, fill: inf.ally ? '#112132' : '#4e2332', stroke: inf.color, 'stroke-width': mine ? 3.5 : 2.2 }));
      g.append(s('text', { x: p[0], y: p[1] + (inf.size > 22 ? 5 : 5), 'text-anchor': 'middle', fill: '#fff', 'font-size': inf.short.length > 2 ? 11 : (inf.size > 22 ? 15 : 15), 'font-weight': 800 }, inf.short));
      if (!inf.ally || mine) g.append(s('text', { x: p[0], y: p[1] + inf.size + 18, 'text-anchor': 'middle', fill: inf.ally ? inf.color : '#ffcbd0', 'font-size': 12, 'font-weight': 700 }, inf.label));
      gU.append(g);
    }

    for (const l of labels) {
      const w = Math.max(70, Math.min(360, l.text.length * 13 + 20));
      const x = Math.min(d.map.width - w / 2 - 4, Math.max(w / 2 + 4, l.x));
      const y = Math.max(24, l.y);
      gL.append(s('rect', { x: x - w / 2, y: y - 18, width: w, height: 26, rx: 7, fill: '#0a1c2d', stroke: l.color, 'stroke-opacity': .9 }));
      gL.append(s('text', { x, y: y, 'text-anchor': 'middle', fill: l.color, 'font-size': 13, 'font-weight': 800 }, l.text));
    }

    const hp = hpAt(t);
    $('hpText').textContent = `${Math.round(hp)}%`;
    $('hpBar').style.width = `${hp}%`;
  }

  // ---------- scene ----------
  function actRow(a, dim) {
    const r = st.roles.get(a.role);
    return h('div', { class: `act${dim ? ' dim' : ''}` },
      h('span', { class: 'role', style: { background: r.color } }, r.short),
      h('span', { class: 'do' }, a.do, ' ', provBadge(a.prov)),
      h('span', { class: 'meta' }, `対象：${a.target || '—'}　理由：${a.why || '—'}`));
  }
  function renderScene(ix) {
    const e = st.events[ix];
    $('sPhase').textContent = e.phase;
    $('sNo').textContent = `場面 ${ix + 1} / ${st.events.length}`;
    $('sProv').replaceChildren(provBadge(e.prov), e.src ? h('span', { class: 'small' }, ` ${e.src}`) : '');
    $('sTitle').textContent = e.title;
    $('sTrigger').textContent = `きっかけ：${e.trigger}`;
    $('sSummary').textContent = e.summary;
    const mine = $('mine');
    if (st.job === 'ALL') {
      mine.hidden = true;
    } else {
      mine.hidden = false;
      const r = st.roles.get(st.job);
      const acts = e.actions.filter(a => isMine(a.role));
      mine.replaceChildren(h('h3', {}, `${r.name}（あなた）のやること`),
        ...(acts.length ? acts.map(a => actRow(a, false))
          : [h('div', { class: 'small' }, `この場面で${r.name}固有の行動は記事にありません。基本の役割：${r.duty}`)]));
    }
    $('sActs').replaceChildren(...e.actions.map(a => actRow(a, st.job !== 'ALL' && !isMine(a.role))));
    for (const b of $('timeline').querySelectorAll('button')) b.classList.toggle('active', Number(b.dataset.ix) === ix);
  }

  function render() {
    if (!st.battle) return;
    const ix = currentIndex(st.time);
    if (ix !== st.lastIx) { renderScene(ix); st.lastIx = ix; }
    renderMap();
    $('seek').value = st.time;
    $('dClock').textContent = mmss(st.time);
  }

  // ---------- loop ----------
  function loop(now) {
    const dt = Math.min((now - st.last) / 1000, .1); st.last = now;
    const ss = syncStatus();
    if (st.playerState === 'ready') $('vClock').textContent = mmss(vNow());
    if (ss.state === 'synced') {
      const vt = vNow();
      // 同期範囲外の場面を図だけで見ている間は、動画が動くまで追従を保留する
      if (st.hold != null && Math.abs(vt - st.hold) < .5) { requestAnimationFrame(loop); return; }
      if (st.hold != null) { st.hold = null; }
      const r = Number.isFinite(vt) ? E.videoToDemo(st.points, st.events, vt) : { inRange: false };
      if (r.inRange) {
        if (st.outside) { st.outside = false; hideOutside(); }
        if (Math.abs(r.demoT - st.time) > .03) setDemo(r.demoT);
      } else if (st.videoPlaying || !st.outside) {
        st.outside = true;
        showOutside(r.side === 'before'
          ? `動画 ${mmss(vt)} は同期範囲より前です（未同期区間）。1戦目や準備の場面の可能性があります。`
          : `動画 ${mmss(vt)} は同期範囲より後です（未同期区間）。`);
      }
    } else {
      if (st.outside) { st.outside = false; hideOutside(); }
      if (st.playing) {
        setDemo(st.time + dt * st.speed);
        if (st.time >= st.battle.demo.duration) { st.playing = false; updatePlayBtn(); }
      }
    }
    requestAnimationFrame(loop);
  }

  // ---------- wiring ----------
  function wire() {
    $('loadVideo').onclick = loadVideo;
    $('play').onclick = togglePlay;
    $('back').onclick = () => seekDemo(st.time - 5);
    $('prev').onclick = () => { const ix = currentIndex(st.time); const e = st.events[st.time - st.events[ix].demoT > 1 ? ix : Math.max(0, ix - 1)]; jumpToEvent(e); };
    $('next').onclick = () => { const e = st.events.find(x => x.demoT > st.time + .2); if (e) jumpToEvent(e); };
    $('seek').addEventListener('input', ev => seekDemo(Number(ev.target.value)));
    $('speed').onclick = () => { st.speed = st.speed === 1 ? 2 : st.speed === 2 ? 0.5 : 1; $('speed').textContent = `${st.speed}×`; };
    $('trail').onclick = () => { st.trails = !st.trails; $('trail').setAttribute('aria-pressed', String(st.trails)); render(); };
    $('printBtn').onclick = () => window.print();

    $('markBtn').onclick = () => {
      if (st.playerState !== 'ready') return editMsg('先に動画を読み込んでください。');
      const vt = vNow();
      if (!Number.isFinite(vt) || vt < 0) return editMsg('動画の再生位置を取得できません。');
      const kind = document.querySelector('input[name=kind]:checked').value;
      const pt = { event: $('evSel').value, videoT: Number(vt.toFixed(2)), kind, note: $('ptNote').value.trim() || undefined, at: new Date().toISOString() };
      const r = E.tryUpsert(st.points, st.events, pt);
      if (!r.ok) return editMsg(`前後の同期点と順番が食い違うため登録しませんでした（${r.conflicts.join(', ')}）。時刻か場面を見直してください。`, 'err');
      st.points = r.points; $('ptNote').value = '';
      savePoints(); editMsg(`${mmss(pt.videoT)} を登録しました。`, 'ok');
    };
    $('unmarkBtn').onclick = () => { const id = $('evSel').value; st.points = st.points.filter(p => p.event !== id); savePoints(); editMsg('登録を消しました。', 'ok'); };
    $('exportBtn').onclick = () => {
      const blob = new Blob([JSON.stringify(syncSetObj(), null, 2) + '\n'], { type: 'application/json' });
      const a = h('a', { href: URL.createObjectURL(blob), download: `${st.battle.id}.${st.videoId}.json` });
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
    $('importBtn').onclick = () => $('importFile').click();
    $('importFile').onchange = async ev => {
      const f = ev.target.files[0]; ev.target.value = '';
      if (!f) return;
      try {
        const obj = JSON.parse(await f.text());
        const chk = E.validateSyncSet(obj, st.battle, video());
        if (chk.errors.length) return editMsg('読み込めません：' + chk.errors.join(' / '), 'err');
        st.points = obj.points.map(p => ({ ...p }));
        savePoints();
        editMsg(chk.warnings.length ? '読み込みました。ただし ' + chk.warnings.join(' / ') : '読み込みました。', chk.warnings.length ? 'warn' : 'ok');
      } catch (e) { editMsg('JSONとして読めません：' + e.message, 'err'); }
    };
    $('resetBtn').onclick = () => {
      if (!confirm('この端末での編集を捨てて同梱データに戻しますか？')) return;
      lsSet(lsKey(st.battle.id, st.videoId), null); loadPointsFor(video()); refreshSync(); editMsg('同梱データに戻しました。', 'ok');
    };

    window.addEventListener('keydown', ev => {
      if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(ev.target.tagName)) return;
      if (ev.code === 'Space') { ev.preventDefault(); togglePlay(); }
      else if (ev.key === 'ArrowRight') $('next').click();
      else if (ev.key === 'ArrowLeft') $('prev').click();
    });
  }
  function togglePlay() {
    if (syncStatus().state === 'synced') {
      if (st.videoPlaying) st.player.pauseVideo(); else st.player.playVideo();
      return;
    }
    if (st.time >= st.battle.demo.duration) setDemo(0);
    st.playing = !st.playing; st.last = performance.now(); updatePlayBtn();
  }

  boot();
})();
