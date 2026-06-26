// Supabase Edge Function: OGP対応シェアページ
// SNSクローラーにはOGPメタタグを返し、人間のユーザーには302リダイレクトする
//
// デプロイ: supabase functions deploy og-share --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  escapeToAsciiHtml,
  isBotUserAgent,
  readUuidSearchParam,
} from "../_shared/og.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const DEPLOY_ORIGIN = "https://drawing-line-chart.dataviz.jp";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const id = readUuidSearchParam(url);

  if (!id) {
    return new Response("Invalid or missing id parameter", { status: 400 });
  }

  const encodedId = encodeURIComponent(id);
  const shareUrl = `${DEPLOY_ORIGIN}/share.html?id=${encodedId}`;

  // 人間のブラウザには302リダイレクト
  if (!isBotUserAgent(req)) {
    return new Response(null, {
      status: 302,
      headers: {
        "Location": shareUrl,
        "Cache-Control": "public, max-age=60, s-maxage=300",
        "Vary": "User-Agent",
      },
    });
  }

  // SNSクローラーにはOGPメタタグを返す
  const { data: response } = await supabase
    .from("quiz_responses")
    .select("score_label, quiz_quizzes(title)")
    .eq("id", id)
    .single();

  const quizRelation = response?.quiz_quizzes;
  const quiz = Array.isArray(quizRelation) ? quizRelation[0] : quizRelation;
  const title = escapeToAsciiHtml(
    quiz?.title ||
      "\u63cf\u3044\u3066\u7b54\u3048\u308b\u6298\u308c\u7dda\u30b0\u30e9\u30d5",
  );
  const scoreLabel = escapeToAsciiHtml(response?.score_label || "\u7d50\u679c");
  const ogTitle = `${title} &#x2014; ${scoreLabel}`;
  const ogDesc = escapeToAsciiHtml(
    "\u6298\u308c\u7dda\u30b0\u30e9\u30d5\u306e\u4e88\u60f3\u7d50\u679c\u3092\u30c1\u30a7\u30c3\u30af\uff01\u3042\u306a\u305f\u3082\u4e88\u60f3\u3057\u3066\u307f\u3088\u3046",
  );
  const siteName = escapeToAsciiHtml(
    "\u63cf\u3044\u3066\u7b54\u3048\u308b\u6298\u308c\u7dda\u30b0\u30e9\u30d5",
  );
  const escapedShareUrl = escapeToAsciiHtml(shareUrl);
  const ogImage =
    `${SUPABASE_URL}/storage/v1/object/public/quiz-og-images/${encodedId}.png`;
  const escapedOgImage = escapeToAsciiHtml(ogImage);

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
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
<title>${ogTitle}</title>
</head>
<body></body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=60, s-maxage=300",
      "Vary": "User-Agent",
    },
  });
});
