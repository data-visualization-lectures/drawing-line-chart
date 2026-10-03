# Supabase クイズ機能 実装ガイド

本ツール「描いて答える折れ線グラフ」では、dataviz.jp の共通認証・プロジェクト保存（`api.dataviz.jp`）に加えて、**Supabase を直接利用した独自のクイズ公開・回答・シェア機能**を実装しています。

このガイドは、他のプロジェクトでも同じ仕組みを実装するためのリファレンスです。

## アーキテクチャ概要

```
┌──────────────────────────────────────────────────────────────┐
│  index.html（作成画面）                                       │
│  CSV → フォーム → プロジェクト保存 (api.dataviz.jp)            │
│  → publish-drawing-line-chart-quiz が quiz_quizzes を upsert │
└──────────────┬───────────────────────────────────────────────┘
               │ quiz_id を含むURLを発行
               ▼
┌──────────────────────────────────────────────────────────────┐
│  quiz.html（回答画面）                                        │
│  chart_config を読込 → ユーザーが線を描く → [答え合わせ]       │
│  → quiz_responses に prediction_data 保存                    │
│  → OG画像を生成し Storage にアップロード                      │
│  → シェアURL を生成                                           │
└──────────────┬──────────────────────┬────────────────────────┘
               │                      │
               ▼                      ▼
┌──────────────────────┐  ┌───────────────────────────────────┐
│  share.html           │  │  og-share / og-drawing-line-chart- │
│  （結果閲覧画面）      │  │  quiz（Edge Function）             │
│  quiz_responses を     │  │  SNSボット → OGP、人間 → 302       │
│  読み込み静的表示      │  └───────────────────────────────────┘
└──────────────────────┘
```

描画は `ydi-chart.js` の `ChartInstance` を 3 ページで共有する。作成・回答は `mode: "interactive"`、結果は `mode: "static"` + `renderPrediction()`。

## 前提条件

- Supabase プロジェクトが作成済みであること
- dataviz.jp の共通認証は `/QUICKSTART.md` を参照

## Step 1: Supabase テーブル作成

### quiz_quizzes テーブル

クイズの設定（タイトル、チャート設定）を保存する。

```sql
CREATE TABLE quiz_quizzes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  chart_config JSONB NOT NULL,
  created_by UUID DEFAULT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS: SELECT は公開。INSERT は publish-drawing-line-chart-quiz（service role）が行う。
-- クライアント anon INSERT は使わない。
ALTER TABLE quiz_quizzes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read quizzes" ON quiz_quizzes FOR SELECT USING (true);
```

### quiz_responses テーブル

クイズの回答データ（ユーザーの予測、スコア）を保存する。

```sql
CREATE TABLE quiz_responses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  quiz_id UUID REFERENCES quiz_quizzes(id),
  prediction_data JSONB NOT NULL,
  score_label TEXT,
  total_error NUMERIC,
  avg_ratio NUMERIC,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS: 誰でも読み取り・作成可能
ALTER TABLE quiz_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read responses" ON quiz_responses FOR SELECT USING (true);
CREATE POLICY "Anyone can create responses" ON quiz_responses FOR INSERT WITH CHECK (true);
```

### chart_config に保存されるフィールド例

```json
{
  "id": "preview",
  "title": "米国の失業率はオバマ政権下でどう変化した？",
  "data": [{"x": 2000, "y": 4.0}, {"x": 2001, "y": 4.7}, ...],
  "drawStartX": 2008,
  "unit": "%",
  "style": "sketchy",
  "annotations": [{"startX": 2009, "endX": 2017, "label": "オバマ政権"}],
  "yFormat": ",.0f",
  "precision": 1,
  "yExtent": 1.5,
  "colors": {"known": "#7570b3", "actual": "#1b9e77", "user": "#d95f02"}
}
```

## Step 2: Supabase Storage 設定（OG画像用）

### バケット作成

Supabase ダッシュボード > Storage > New bucket:

- **バケット名**: `quiz-og-images`
- **Public bucket**: Yes（OGPクローラーがアクセスするため）

### Storage Policies

以下の3つのポリシーを `quiz-og-images` バケットに設定:

| 操作 | Target Role | 用途 |
|------|-------------|------|
| SELECT | anon | 画像の公開読み取り |
| INSERT | anon | 回答時に画像をアップロード |
| UPDATE | anon | upsert 時の上書き |

## Step 3: Supabase クライアント初期化

各HTMLページで、Quiz専用の Supabase クライアントを初期化する。
dataviz.jp の共通認証（`window.datavizSupabase`）とは**別のクライアント**として作成する。

```html
<!-- Supabase JS SDK -->
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
```

```javascript
const SUPABASE_URL = "https://xxxxxxxxxx.supabase.co";
const SUPABASE_ANON_KEY = "eyJh...";
const quizSupabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
```

> **注意**: `window.datavizSupabase`（共通認証用）と `quizSupabase`（クイズ用）は別のクライアント。共通認証の Supabase と混同しないこと。

## Step 4: クイズ公開（index.html）

「公開」は保存済みプロジェクトを `publish-drawing-line-chart-quiz` Edge Function に渡し、`quiz_quizzes` を `source_project_id` 単位で upsert する。クライアントから `quiz_quizzes` へ直接 INSERT しない。

実装は `index.html` の `publishQuizFromProject()` と `supabase/functions/publish-drawing-line-chart-quiz/index.ts` を正とする。`created_by` は Edge Function が JWT の `sub` から入れる。

## Step 5: クイズ回答（quiz.html）

### 5-1. クイズ設定の読み込み

```javascript
const quizId = new URLSearchParams(location.search).get("id");

const { data: quiz, error } = await quizSupabase
  .from("quiz_quizzes")
  .select("*")
  .eq("id", quizId)
  .single();

const cfg = { ...quiz.chart_config, id: quizId };
```

### 5-2. 回答の保存

ユーザーが「答え合わせ」した後に回答データを保存する。

```javascript
const { data: response, error } = await quizSupabase
  .from("quiz_responses")
  .insert({
    quiz_id: quizId,
    prediction_data: exportData,   // [{x, actual, prediction}, ...]
    score_label: label,            // "ほぼ正解！" 等
    total_error: totalError,       // 誤差合計
    avg_ratio: avgRatio,           // 平均比率
  })
  .select("id")
  .single();
```

### 5-3. シェアURL生成

ユーザーに表示・コピー・SNS共有するURLは、通常の公開ページURLを使用する:

```javascript
// 通常のシェアURL（直接 share.html を表示）
const shareUrl = `${location.origin}/share.html?id=${response.id}`;
```

- **URLコピー**: `shareUrl` を使用
- **OGP対応URL**: 既存URL互換のため `{SUPABASE_URL}/functions/v1/og-share?id={response_id}` は残す。将来的な削除方針は `../shared/SHARE_OGP_LEGACY.md` を参照。

## Step 6: OG画像の生成・アップロード

回答保存後、バックグラウンドでOG画像（1200x630 PNG）を生成・アップロードする。

```javascript
// SVG → Canvas → PNG Blob
async function generateOgImage(svgEl, title, scoreLabel) {
  const clone = svgEl.cloneNode(true);
  // clip-pathを除去（答え合わせ後の状態を描画）
  clone.querySelectorAll("[clip-path]").forEach(el => el.removeAttribute("clip-path"));
  // 不要要素を除去
  clone.querySelectorAll(".ydi-flash-rect, .ydi-drag-rect, .ydi-draw-prompt").forEach(el => el.remove());
  // ... SVG → Canvas → PNG 変換 ...
}

// Supabase Storage にアップロード
async function uploadOgImage(responseId, pngBlob) {
  const { error } = await quizSupabase.storage
    .from("quiz-og-images")
    .upload(`${responseId}.png`, pngBlob, {
      contentType: "image/png",
      upsert: true,
    });
  return `${SUPABASE_URL}/storage/v1/object/public/quiz-og-images/${responseId}.png`;
}
```

## Step 7: OGP用 Edge Function（og-share）

Supabase Edge Function で、SNSクローラーにはOGPメタタグを返し、人間には share.html にリダイレクトする。

### ファイル配置

```
supabase/
  functions/
    og-share/
      index.ts
```

### 実装のポイント

```typescript
const BOT_UA_PATTERN = /Twitterbot|facebookexternalhit|Facebot|LinkedInBot|Slackbot|Discordbot|LINE|Googlebot|bingbot/i;

Deno.serve(async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  const ua = req.headers.get("user-agent") || "";
  const shareUrl = `${DEPLOY_ORIGIN}/share.html?id=${id}`;

  // 人間のブラウザ → 302リダイレクト
  if (!BOT_UA_PATTERN.test(ua)) {
    return new Response(null, { status: 302, headers: { Location: shareUrl } });
  }

  // SNSクローラー → OGPメタタグを返す
  // 注意: 日本語はHTML数値文字参照に変換する（文字化け回避）
  const ogImage = `${SUPABASE_URL}/storage/v1/object/public/quiz-og-images/${id}.png`;
  const html = `<!DOCTYPE html>
    <meta property="og:title" content="${ogTitle}">
    <meta property="og:image" content="${ogImage}">
    ...`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
});
```

### デプロイ

```bash
supabase functions deploy og-share --no-verify-jwt
```

`--no-verify-jwt` が必要（SNSクローラーは認証トークンを持たないため）。

### 文字化け回避

Edge Function のレスポンスで日本語が文字化けする場合は、非ASCII文字をHTML数値文字参照（`&#x30ea;` 等）に変換する。

```typescript
function escapeToAsciiHtml(str: string): string {
  let result = "";
  for (const ch of str) {
    const code = ch.codePointAt(0)!;
    if (ch === "&") result += "&amp;";
    else if (ch === '"') result += "&quot;";
    else if (code > 127) result += `&#x${code.toString(16)};`;
    else result += ch;
  }
  return result;
}
```

## Step 8: 結果表示（share.html）

```javascript
const responseId = new URLSearchParams(location.search).get("id");

const { data: response } = await quizSupabase
  .from("quiz_responses")
  .select("*, quiz_quizzes(*)")    // JOINで関連クイズも取得
  .eq("id", responseId)
  .single();

const cfg = { ...response.quiz_quizzes.chart_config, id: responseId };
const chart = new ChartInstance(containerEl, cfg, { mode: "static", breakpoints: "public" });
chart.renderPrediction(response.prediction_data);
```

## 全体のURL構成

| ページ | URL | パラメータ |
|--------|-----|-----------|
| クイズ作成 | `/index.html` | なし |
| クイズ回答 | `/quiz.html?id={quiz_id}` | quiz_quizzes.id |
| 結果表示 | `/share.html?id={response_id}` | quiz_responses.id |
| OGP提供（結果） | `{SUPABASE_URL}/functions/v1/og-share?id={response_id}` | quiz_responses.id |
| OGP提供（クイズ） | `{SUPABASE_URL}/functions/v1/og-drawing-line-chart-quiz?id={quiz_id}` | quiz_quizzes.id |
| OG画像 | `{SUPABASE_URL}/storage/v1/object/public/quiz-og-images/{response_id}.png` | quiz_responses.id |

## 実装時の注意点

### dataviz.jp 共通認証との使い分け

| 機能 | 使用するクライアント | 用途 |
|------|---------------------|------|
| ログイン/ログアウト | `window.datavizSupabase` | dataviz.jp 共通認証 |
| プロジェクト保存/読込 | `api.dataviz.jp` REST API | dataviz.jp 共通機能 |
| クイズ公開 | `publish-drawing-line-chart-quiz` | 保存済みプロジェクトから `quiz_quizzes` を upsert。`created_by` は JWT `sub` |
| クイズ回答/結果閲覧 | `quizSupabase` | `quiz_quizzes` / `quiz_responses` の SELECT と回答 INSERT |

### RLSポリシー

`quiz_quizzes` の SELECT は公開。INSERT は publish Edge Function の service role のみ。`quiz_responses` の SELECT / INSERT は回答者向けに anon へ開く。

### created_by（クイズ作成者）の記録

`quiz_quizzes.created_by` は `publish-drawing-line-chart-quiz` がアクセストークンの `sub` から書く。クライアントが `created_by` を直接セットする経路は使わない。

### ResizeObserver との共存

`ChartInstance` が描画状態（ユーザー線 / 保存済み予測）を `_render()` の外に持ち、リサイズ後に再適用する。ページ側で二重に ResizeObserver を組む必要はない。
