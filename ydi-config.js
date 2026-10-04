// Quiz backend constants shared by the editor, quiz, and result pages.

export const DEPLOY_ORIGIN = "https://drawing-line-chart.dataviz.jp";
export const SUPABASE_URL = "https://vebhoeiltxspsurqoxvl.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_sAjwbAhC0jnIRjNa34QuTA_CcksMYQG";
export const TOOL_NAME_JA = "描いて答える折れ線グラフ";

const OG_BUCKET = "quiz-og-images";

export function createQuizClient() {
  return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

export function quizPageUrl(quizId) {
  return `${DEPLOY_ORIGIN}/quiz.html?id=${encodeURIComponent(quizId)}`;
}

export function resultPageUrl(responseId) {
  return `${DEPLOY_ORIGIN}/share.html?id=${encodeURIComponent(responseId)}`;
}

// Storage paths are read by the OG Edge Functions; keep them in sync.
//   og-drawing-line-chart-quiz → quiz/<quizId>.png
//   og-share                   → <responseId>.png
export const quizOgPath = (quizId) => `quiz/${quizId}.png`;
export const resultOgPath = (responseId) => `${responseId}.png`;

export function ogPublicUrl(path) {
  return `${SUPABASE_URL}/storage/v1/object/public/${OG_BUCKET}/${path}`;
}

export async function uploadOgPng(client, path, pngBlob) {
  if (!pngBlob) return null;
  const { error } = await client.storage
    .from(OG_BUCKET)
    .upload(path, pngBlob, { contentType: "image/png", upsert: true });
  if (error) {
    console.warn("OG image upload failed:", error.message);
    return null;
  }
  return ogPublicUrl(path);
}
