# データ仕様（v1）

## Battle Pack — `battles/<id>.json`
`schema: "ffxi-battle-motion/battle@1"`

| キー | 必須 | 内容 |
|---|---|---|
| `id` | ◯ | 英数とハイフン。ファイル名・同期ファイル名に使う（例 `sheol-arebati-v25-b2`） |
| `title` `content` `boss` `tier` `fight` | ◯ | 表示用。`fight` は何戦目か（1戦のみなら 1） |
| `summary` | | 一行の作戦要約 |
| `sources[]` | ◯ | `{id, kind:"article"|"video"|"other", title, url, checked}` |
| `videos[]` | | `{id:"A", youtubeId, label, author, pov:{"1":"白魔道士","2":"ナイト"}, povProv, note}` |
| `roles[]` | ◯ | `{id, short, name, color, duty, notes[], prov, src, owner?}`。`owner` を指定するとそのジョブ選択時に一緒に強調（ペット等） |
| `events[]` | ◯ | 場面。下記 |
| `demo` | ◯ | 模式図。下記。**中身はすべて演出用** |

### events[]
```jsonc
{ "id": "e10", "order": 10, "demoT": 76,
  "phase": "40%：護衛2体目", "title": "…", "trigger": "HP40%未満",
  "summary": "…", "prov": "article", "src": "記事 §4-3",
  "actions": [ { "role": "PLD", "do": "…", "target": "…", "why": "…", "prov": "article" } ] }
```
- `order`：戦術の正しい順番（一意）。同期点の並びと矛盾判定の基準。
- `demoT`：圧縮デモ上の秒。`order` 順に**厳密に増加**させる。実戦の秒ではない。
- `prov`：`article`（記事に記載）／`visual`（動画で目視確認）／`assumption`（説明用の仮定）／`unverified`（未確認）。記事に無い行動を書くときは `article` にしない。

### demo
```jsonc
{ "prov": "assumption", "duration": 130, "note": "…",
  "map": { "width": 1000, "height": 560, "zones": [ { "label": "階段", "x": 40, "y": 110, "w": 150, "h": 300 } ] },
  "units": [
    { "id": "boss", "kind": "enemy", "label": "AREBATI", "short": "BOSS", "color": "#ff8a96", "size": 30, "keys": [[0, 700, 280]] },
    { "id": "add1", "kind": "enemy", "label": "護衛1", "short": "護1", "color": "#e3a877", "appear": 18, "keys": [[0, 640, 420]] },
    { "id": "PLD", "role": "PLD", "keys": [[0, 110, 170], [16, 600, 260]] } ],
  "hp": [[0, 75], [76, 40], [130, 0]],
  "fx": [
    { "from": 55, "to": 124, "type": "line", "src": "DNC", "dst": "boss", "style": "ws", "pulse": [7, 0.25, 0], "text": "…" },
    { "from": 76, "to": 86, "type": "label", "at": "boss", "text": "…", "color": "#ffd28a", "dy": -60 } ] }
```
- `keys`：`[demoT, x, y]` のキーフレーム。間はなめらかに補間。
- `appear`：その demoT から表示（護衛pop等）。
- `fx.style`：`move` `debuff` `hate` `ws` `aa` `ranged` `drain` `buff`
- `pulse`：`[周期秒, 表示割合, ずらし秒]` で点滅（WSの繰り返し表現）。

## Sync Set — `sync/<battleId>.<videoId>.json`
`schema: "ffxi-battle-motion/sync@1"`
```jsonc
{ "battleId": "…", "videoId": "A", "youtubeId": "…", "fight": 2,
  "points": [ { "event": "e03", "videoT": 612.4, "kind": "visual", "note": "…", "at": "ISO8601" } ] }
```
- 動画ごとに別ファイル。`kind`：`visual`（映像で確認）／`assumption`（仮置き）。
- 補間は `order` 順に並べた点と点の間だけ。外側は推定しない。`order` 順で `videoT` が増加しない点は矛盾として追従を止める。
- 読み込み時に `battleId` `videoId` `youtubeId` が違うものは拒否。
