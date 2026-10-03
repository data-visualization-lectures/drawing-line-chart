# 描いて答える折れ線グラフ

ユーザーがトレンドを描いて予想し、実データと答え合わせするクイズ型ツール。公開ホストは `drawing-line-chart.dataviz.jp`。

ビルド手順はない。静的 HTML / JS をそのまま配信する。ブランチ運用の指定もないため、作業は `main` を使う。

## 画面

| ページ | 役割 |
|---|---|
| `index.html` | 作成。CSV/JSON を読み、プレビューし、`api.dataviz.jp` にプロジェクト保存。公開は `publish-drawing-line-chart-quiz` |
| `quiz.html` | 回答。`quiz_quizzes` を読み、線を描いて答え合わせ。結果は `quiz_responses` へ |
| `share.html` | 結果閲覧。保存済みの予測線と実データを静的表示 |

サンプルデータはツールヘッダーのサンプルピッカーから読む。`data/` 配下の CSV はそのカタログ用。

## ファイル構成

```
drawing-line-chart/
├── index.html          # 作成エディタ
├── quiz.html           # 回答
├── share.html          # 結果
├── ydi-chart.js        # ChartInstance（interactive / static）
├── ydi-chart.css       # チャート共通スタイル
├── ydi-export.js       # PNG / サムネ / フォント埋め込み
├── safe-dom.js
├── d3.sketchy.js
├── data/               # ヘッダーカタログ用 CSV
└── supabase/           # クイズ公開・OGP の Edge Functions と migration
```

描画コアは 3 ページで共有する。ページ固有なのはフォーム、i18n、Supabase 入出力だけ。

クイズ公開のテーブル・RLS・Edge Function は [SUPABASE_QUIZ_GUIDE.md](SUPABASE_QUIZ_GUIDE.md) を正とする。プロジェクト横断の正本は `_app_core/_documents/機能_共有/SUPABASE_QUIZ_GUIDE.md`。

## 保存形式

プロジェクト JSON は `{ charts, version: 1 }`。`charts[0]` はフラットなチャート設定:

```javascript
{
  id: "preview",
  title: "日本の人口はどう推移した？",
  data: [{ x: 2000, y: 12600 }, /* ... */],
  drawStartX: 2010,
  unit: "万人",
  style: "sketchy",           // 省略可
  xFormat: "yyyymm",          // 省略時は年
  annotations: [{ startX, endX, label }],
  yFormat: ",.0f",
  precision: 0,
  yExtent: 1.5,
}
```

公開クイズの `quiz_quizzes.chart_config` も同じフラット形。`SETTINGS_SPEC` / `{ version, chartType, data, settings }` へは移行しない（既存クイズ互換。ROADMAP A4）。

## 描画の要点

- 既知区間（`x <= drawStartX`）は最初から表示する
- 実データは clipPath で隠し、答え合わせで左から開示する（回答ページ）
- ドラッグの飛びを線形補間で埋める
- リサイズでは SVG を描き直すが、ユーザーの描画座標は `ChartInstance` が保持して再適用する
- 結果ページは `mode: "static"` で実線を最初から出し、`renderPrediction()` で保存済み予測を載せる

## ローカル確認

モジュールを読むため、`file://` ではなく HTTP で開く。

```bash
python3 -m http.server 8765
```

`http://localhost:8765/` が作成画面。回答・結果は公開済み ID が必要（`quiz.html?id=` / `share.html?id=`）。
