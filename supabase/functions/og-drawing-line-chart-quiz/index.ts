// Supabase Edge Function: OGP対応クイズ共有ページ
// 常にOGPメタ付きHTMLを返し、人間のユーザーはHTML側で quiz.html へ遷移させる
//
// デプロイ: supabase functions deploy og-drawing-line-chart-quiz --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const DEPLOY_ORIGIN = "https://drawing-line-chart.dataviz.jp";
const DEFAULT_OG_IMAGE =
  "https://interactive-chart-builder.dataviz.jp/images/og-default.png";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function escapeToAsciiHtml(str: string): string {
  let result = "";
  for (const ch of str) {
    const code = ch.codePointAt(0)!;
    if (ch === "&") result += "&amp;";
    else if (ch === '"') result += "&quot;";
    else if (ch === "<") result += "&lt;";
    else if (ch === ">") result += "&gt;";
    else if (code > 127) result += `&#x${code.toString(16)};`;
    else result += ch;
  }
  return result;
}

async function resolveOgImageUrl(id: string) {
  const quizOgImage =
    `${SUPABASE_URL}/storage/v1/object/public/quiz-og-images/quiz/${id}.png`;

  try {
    const response = await fetch(quizOgImage, { method: "HEAD" });
    if (response.ok) return quizOgImage;
  } catch (_error) {
    // Fall through to the default image when storage probing fails.
  }

  return DEFAULT_OG_IMAGE;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (!id) {
    return new Response("Missing id parameter", { status: 400 });
  }

  const shareUrl = `${DEPLOY_ORIGIN}/quiz.html?id=${id}`;

  const { data: quiz } = await supabase
    .from("quiz_quizzes")
    .select("title")
    .eq("id", id)
    .single();

  const ogTitle = escapeToAsciiHtml(
    quiz?.title ||
      "\u63cf\u3044\u3066\u7b54\u3048\u308b\u6298\u308c\u7dda\u30b0\u30e9\u30d5",
  );
  const ogDesc = escapeToAsciiHtml(
    "\u6298\u308c\u7dda\u30b0\u30e9\u30d5\u3092\u4e88\u60f3\u3057\u3066\u307f\u3088\u3046",
  );
  const siteName = escapeToAsciiHtml(
    "\u63cf\u3044\u3066\u7b54\u3048\u308b\u6298\u308c\u7dda\u30b0\u30e9\u30d5",
  );
  const escapedShareUrl = escapeToAsciiHtml(shareUrl);
  const ogImage = await resolveOgImageUrl(id);
  const escapedOgImage = escapeToAsciiHtml(ogImage);

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta property="og:type" content="website">
<meta property="og:title" content="${ogTitle}">
<meta property="og:description" content="${ogDesc}">
<meta property="og:site_name" content="${siteName}">
<meta property="og:url" content="${escapedShareUrl}">
<meta property="og:image" content="${escapedOgImage}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${ogTitle}">
<meta name="twitter:description" content="${ogDesc}">
<meta name="twitter:image" content="${escapedOgImage}">
<link rel="canonical" href="${escapedShareUrl}">
<meta http-equiv="refresh" content="0;url=${escapedShareUrl}">
<title>${ogTitle}</title>
<script>
window.addEventListener('DOMContentLoaded', function () {
  window.setTimeout(function () {
    window.location.replace(${JSON.stringify(shareUrl)});
  }, 0);
});
</script>
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:24px;line-height:1.5;color:#111827;">
<p>Redirecting to the quiz...</p>
<p><a href="${escapedShareUrl}">Open the quiz</a></p>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=60, s-maxage=300",
    },
  });
});
