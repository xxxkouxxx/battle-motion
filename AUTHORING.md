# 新しいボスの追加手順

## 1. Battle Pack を作る
1. `battles/_template.json` をコピーして `battles/<id>.json` にする（id 例：`sheol-xxxx-v25`）。
2. 記事を読んで `roles` と `events` を埋める。AIに下書きさせる場合は下のプロンプトを使う。
3. `demo`（模式図の座標・HP・攻撃線）は演出用なので、場面がわかる程度に大まかでよい。

## 2. 目録に登録
`battles/index.json` の `battles` に追加：
```json
{ "id": "<id>", "title": "表示名", "file": "battles/<id>.json" }
```

## 3. 動画の同期ファイル
動画ごとに `sync/<id>.<videoId>.json` を空で置く（`points: []`）。無くても動くが、配布時はあると便利。
同期点はツール上で登録し「JSONで保存」して差し替える。

## 4. 確認
```bash
node tests/sync-engine.test.js
```
（Arebati 以外のパックも検証したい場合は `validateBattle` を同様に呼ぶ。）ブラウザで開いて、上の「戦闘」から選べることを確認。

## AI に下書きさせるときのプロンプト例
```
次の攻略記事を読み、schema.md の Battle Pack（ffxi-battle-motion/battle@1）形式で JSON を作ってください。
- 記事に書いてある行動・きっかけ・理由だけを prov:"article" とし、src に記事の節を書く
- 記事に無いことは補完せず、必要なら prov:"unverified" で「要確認」と書く
- 位置・移動・HP推移・demoT は演出用（demo.prov:"assumption"）とし、事実として書かない
- events の order は戦術の順番、demoT は order 順に増加させる（合計 120〜180 秒程度）
- 記事URL：<URL>
- 動画：<YouTube URL>（視点ジョブがわかれば pov に、未視聴なら povProv:"unverified"）
```
