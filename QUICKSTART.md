# 新ツール導入ガイド

dataviz.jp の認証・プロジェクト保存機能を新しいツールに導入するためのクイックスタートガイドです。

## システム概要

各ツール（`*.dataviz.jp`）は、`auth.dataviz.jp/lib/` に配置された共通スクリプトを読み込むことで、認証とプロジェクト管理機能を利用します。

```
┌─────────────────────────────────────────────────────────────────┐
│ ツールページ（例: svg-textures.dataviz.jp）                     │
│                                                                 │
│  ┌──────────────────────────────────────────┐ ← 共通ヘッダー    │
│  │ dataviz.jp              user@example.com │    認証 + UI      │
│  ├──────────────────────────────────────────┤ ← ツールヘッダー  │
│  │ [Logo] [保存] [読込] [サンプル]     [Help]│    プロジェクト   │
│  ├──────────────────────────────────────────┤    出し入れ + UI  │
│  │                                          │                   │
│  │           ツール本体                      │                   │
│  │                                          │                   │
│  └──────────────────────────────────────────┘                   │
└─────────────────────────────────────────────────────────────────┘
```

### 3ファイルの役割

| ファイル | 役割 | 登録される Web Component |
|---|---|---|
| `supabase.js` | Supabase JS クライアント（CDN相当） | — |
| `dataviz-auth-client.js` | 認証処理、共通ヘッダー表示、ログイン/ログアウト、サブスク検証 | `<dataviz-header>` |
| `dataviz-tool-header.js` | ツール固有のサブヘッダー。プロジェクト保存/読込ボタン等のUI | `<dataviz-tool-header>` |

## Step 1: HTML にスクリプトを追加

### 1-A. 認証のみ使う場合（最小構成）

ツールの `index.html` に以下の2行を**この順番で**追加してください。

```html
<!-- 1. Supabase クライアント（最初に読み込む） -->
<script src="https://auth.dataviz.jp/lib/supabase.js"></script>

<!-- 2. 共通ヘッダー + 認証ロジック（supabase.js に依存） -->
<script src="https://auth.dataviz.jp/lib/dataviz-auth-client.js"></script>
```

### 1-B. 保存/読込UIも使う場合（フル構成）

プロジェクト保存/読込のサブヘッダーが必要な場合のみ、3行目を追加します。

```html
<!-- 1. Supabase クライアント（最初に読み込む） -->
<script src="https://auth.dataviz.jp/lib/supabase.js"></script>

<!-- 2. 共通ヘッダー + 認証ロジック（supabase.js に依存） -->
<script src="https://auth.dataviz.jp/lib/dataviz-auth-client.js"></script>

<!-- 3. ツールヘッダー（任意、defer推奨） -->
<script src="https://auth.dataviz.jp/lib/dataviz-tool-header.js" defer></script>
```

> **順序が重要です。** `dataviz-auth-client.js` は `window.supabase` を参照するため、`supabase.js` が先に読み込まれている必要があります。

### 1-C. Next.js (`next/script`) の場合

`dataviz-auth-client.js` が実行される時点で `window.supabase` が存在している必要があります。  
Next.js では次の指定を推奨します。

```tsx
<Script src="https://auth.dataviz.jp/lib/supabase.js" strategy="beforeInteractive" />
<Script src="https://auth.dataviz.jp/lib/dataviz-auth-client.js" strategy="afterInteractive" />
```

`dataviz-tool-header.js` を使う場合は、追加で次を読み込みます。

```tsx
<Script src="https://auth.dataviz.jp/lib/dataviz-tool-header.js" strategy="afterInteractive" />
```

### 読み込むだけで起きること

- `<dataviz-header>` が自動で `<body>` 先頭に挿入される
- Supabase セッション（Cookie: `sb-dataviz-auth-token`）を検証
- 未ログイン → 5秒猶予後に `auth.dataviz.jp` へリダイレクト
- ログイン済み → `/api/me` でサブスク検証 → ヘッダーにメールアドレス表示

### レイアウト調整（重なり回避）

共通ヘッダーは `position: fixed; height: 48px;` で表示されます。  
そのため、ツール本体側で上余白を確保しないと既存UIと重なります。

- 認証のみ（`dataviz-header` のみ）: 最低 `48px` の上余白を確保
- 認証 + ツールヘッダー（`dataviz-tool-header` あり）: `48px + サブヘッダー高` を確保

`dataviz-tool-header` は内容により高さが変わりますが、現行スタイルでは約 `56px` が目安です。  
そのため開始値としては `104px`（`48 + 56`）を推奨します。

```css
/* 認証のみ */
main { padding-top: 48px; }

/* 認証 + ツールヘッダー */
main { padding-top: 104px; } /* 必要に応じて増減 */
```

## Step 2: ツールヘッダーを設定（任意）

プロジェクトの保存/読込ボタンが必要な場合、ツールのJSから `setConfig()` を呼び出します。

```javascript
document.addEventListener('DOMContentLoaded', () => {
  const toolHeader = document.querySelector('dataviz-tool-header');
  if (toolHeader) {
    toolHeader.setConfig({
      logo: { type: 'text', text: 'My Tool' },
      buttons: [
        { label: '保存', action: () => saveProject() },
        { label: '読込', action: () => loadProject() },
        { label: 'ヘルプ', type: 'link', href: './help.html' }
      ]
    });
  }
});
```

> **詳細な API 仕様:** [TOOL_SIDE_FILE_SPECIFICATIONS.md](file:///Users/yuichiyazaki/Documents/GitHubRepository/Prj_DatavizJP/_app_core/_documents/api_toolbar/TOOL_SIDE_FILE_SPECIFICATIONS.md)

## Step 3: プロジェクト保存/読込 API を実装

ツール側でプロジェクトデータ（JSON + サムネイル画像）の保存/読込を実装します。

### API エンドポイント

| メソッド | パス | 用途 |
|---|---|---|
| `GET` | `/api/projects?app=ツール名` | 一覧取得 |
| `POST` | `/api/projects` | 新規作成 |
| `GET` | `/api/projects/:id` | データ取得 |
| `PUT` | `/api/projects/:id` | 更新 |
| `DELETE` | `/api/projects/:id` | 削除 |

認証は `Authorization: Bearer <access_token>` ヘッダーで行います。
アクセストークンは `window.datavizSupabase` から取得できます。

```javascript
const { data: { session } } = await window.datavizSupabase.auth.getSession();
const token = session.access_token;
```

> **詳細な API 仕様:** [API_SPECIFICATION.md](file:///Users/yuichiyazaki/Documents/GitHubRepository/Prj_DatavizJP/_app_core/_documents/api_projects/API_SPECIFICATION.md)
>
> **ツール側の実装例:** [TOOL_INTEGRATION_GUIDE.md](file:///Users/yuichiyazaki/Documents/GitHubRepository/Prj_DatavizJP/_app_core/_documents/api_projects/TOOL_INTEGRATION_GUIDE.md)

## Step 4: 開発・デバッグ

### ローカル開発

- `localhost` ではCookieドメインが自動的に `null`（ローカル専用）になり、`.dataviz.jp` ドメインのCookieは共有されません
- ローカルでの認証テストには `auth.dataviz.jp` に一度ログインした状態で行ってください

### リダイレクト回避

URLに `?auth_debug` を付けると、未ログインでもリダイレクトが抑制されます。

```
https://your-tool.dataviz.jp/?auth_debug
```

### よくあるエラー

- `Supabase client missing. Make sure supabase.js is loaded.`
  - `supabase.js` が未読み込み、または `dataviz-auth-client.js` より後に実行されています。
  - Next.js の場合は `supabase.js` を `beforeInteractive` にしてください。

## CORS について

`api.dataviz.jp` は `*.dataviz.jp` サブドメインからのアクセスを正規表現で一括許可しています（[cors.ts](file:///Users/yuichiyazaki/Documents/GitHubRepository/Prj_DatavizJP/_app_core/dataviz-api/api/_lib/cors.ts)）。

新しいツールが `*.dataviz.jp` のサブドメインであれば、**CORS の追加設定は不要**です。

## 関連ドキュメント一覧

| ドキュメント | 内容 |
|---|---|
| [API_SPECIFICATION.md](file:///Users/yuichiyazaki/Documents/GitHubRepository/Prj_DatavizJP/_app_core/_documents/api_projects/API_SPECIFICATION.md) | Projects API 仕様（CRUD） |
| [SUPABASE PUBLIC_TABLES.md](file:///Users/yuichiyazaki/Documents/GitHubRepository/Prj_DatavizJP/_app_core/_documents/api_projects/SUPABASE%20PUBLIC_TABLES.md) | DB テーブル定義 |
| [CLIENT_INTEGRATION_GUIDE.md](file:///Users/yuichiyazaki/Documents/GitHubRepository/Prj_DatavizJP/_app_core/_documents/api_projects/CLIENT_INTEGRATION_GUIDE.md) | Cookie 認証共有の設定 |
| [TOOL_INTEGRATION_GUIDE.md](file:///Users/yuichiyazaki/Documents/GitHubRepository/Prj_DatavizJP/_app_core/_documents/api_projects/TOOL_INTEGRATION_GUIDE.md) | ツール側の連携実装例 |
| [TOOL_SIDE_FILE_SPECIFICATIONS.md](file:///Users/yuichiyazaki/Documents/GitHubRepository/Prj_DatavizJP/_app_core/_documents/api_toolbar/TOOL_SIDE_FILE_SPECIFICATIONS.md) | ツールヘッダー `setConfig()` API 仕様 |
| [TRIAL_SETUP.md](file:///Users/yuichiyazaki/Documents/GitHubRepository/Prj_DatavizJP/_app_core/_documents/trial/TRIAL_SETUP.md) | トライアルユーザー運用手順 |
