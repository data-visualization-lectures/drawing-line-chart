// Supabase Edge Function: publish saved project state into a reusable quiz row
//
// Deploy:
//   supabase functions deploy publish-drawing-line-chart-quiz --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DATAVIZ_API_URL = Deno.env.get("DATAVIZ_API_URL") ||
  "https://api.dataviz.jp";
const QUIZ_TABLE = "quiz_quizzes";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-dataviz-authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function serializeUnknownError(error: unknown) {
  if (error instanceof Error) {
    return {
      type: "Error",
      message: error.message,
      stack: error.stack || null,
    };
  }

  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    return {
      type: "Object",
      message: typeof record.message === "string"
        ? record.message
        : String(error),
      code: typeof record.code === "string" ? record.code : null,
      details: typeof record.details === "string" ? record.details : null,
      hint: typeof record.hint === "string" ? record.hint : null,
      status: typeof record.status === "number" ? record.status : null,
      name: typeof record.name === "string" ? record.name : null,
    };
  }

  return {
    type: typeof error,
    message: String(error),
  };
}

function readDatavizAccessToken(req: Request) {
  const raw = req.headers.get("x-dataviz-authorization") || "";
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function decodeJwtSubject(token: string | null) {
  if (!token) return null;

  try {
    const [, payload] = token.split(".");
    if (!payload) return null;

    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const decoded = atob(padded);
    const parsed = JSON.parse(decoded);
    return typeof parsed?.sub === "string" ? parsed.sub : null;
  } catch (_error) {
    return null;
  }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function extractProjectPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    throw new Error("invalid_project_payload");
  }

  const record = payload as Record<string, unknown>;
  const projectName = typeof record.name === "string"
    ? record.name
    : typeof (record.project as Record<string, unknown> | undefined)?.name ===
        "string"
    ? String((record.project as Record<string, unknown>).name)
    : "";

  const candidate = record.data && typeof record.data === "object"
    ? record.data as Record<string, unknown>
    : record;

  const charts = Array.isArray(candidate.charts) ? candidate.charts : null;
  const firstChart = charts?.[0];
  if (!firstChart || typeof firstChart !== "object") {
    throw new Error("invalid_project_payload");
  }

  return {
    projectName,
    chartConfig: cloneJson(firstChart as Record<string, unknown>),
  };
}

function resolveQuizTitle(
  chartConfig: Record<string, unknown>,
  fallbackTitle: string,
  projectName: string,
) {
  const candidates = [
    typeof chartConfig.title === "string" ? chartConfig.title : "",
    fallbackTitle,
    projectName,
    "描いて答える折れ線グラフ",
  ];

  return candidates.map((value) => String(value || "").trim()).find(Boolean) ||
    "描いて答える折れ線グラフ";
}

async function loadSavedProject(projectId: string, accessToken: string) {
  const response = await fetch(
    `${DATAVIZ_API_URL}/api/projects/${encodeURIComponent(projectId)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (!response.ok) {
    const errorPayload = await response.json().catch(async () => ({
      error: await response.text().catch(() => ""),
    }));
    const message = errorPayload?.error || errorPayload?.detail ||
      `Project API error: ${response.status}`;
    throw new Error(message);
  }

  return response.json();
}

async function saveQuizForProject(
  projectId: string,
  payload: Record<string, unknown>,
) {
  const { data: existingQuiz, error: lookupError } = await supabase
    .from(QUIZ_TABLE)
    .select("id")
    .eq("source_project_id", projectId)
    .maybeSingle();

  if (lookupError) {
    throw lookupError;
  }

  if (existingQuiz?.id) {
    const { data, error } = await supabase
      .from(QUIZ_TABLE)
      .update(payload)
      .eq("id", existingQuiz.id)
      .select("id, title, source_project_id")
      .single();

    if (error) {
      throw error;
    }
    return data;
  }

  const { data, error } = await supabase
    .from(QUIZ_TABLE)
    .insert(payload)
    .select("id, title, source_project_id")
    .single();

  if (error) {
    throw error;
  }
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const accessToken = readDatavizAccessToken(req);
  if (!accessToken) {
    return jsonResponse({ error: "Login required" }, 401);
  }

  const body = await req.json().catch(() => null) as
    | Record<string, unknown>
    | null;
  const projectId = String(body?.projectId || "").trim();
  const fallbackTitle = String(body?.fallbackTitle || "").trim();
  if (!projectId) {
    return jsonResponse({ error: "projectId is required" }, 400);
  }

  try {
    const savedProjectResponse = await loadSavedProject(projectId, accessToken);
    const { projectName, chartConfig } = extractProjectPayload(
      savedProjectResponse,
    );
    const title = resolveQuizTitle(chartConfig, fallbackTitle, projectName);
    const createdBy = decodeJwtSubject(accessToken);

    const payload: Record<string, unknown> = {
      title,
      chart_config: chartConfig,
      source_project_id: projectId,
    };
    if (createdBy) payload.created_by = createdBy;

    const data = await saveQuizForProject(projectId, payload);

    return jsonResponse({
      quizId: data.id,
      title: data.title,
      sourceProjectId: data.source_project_id,
    });
  } catch (error) {
    const serializedError = serializeUnknownError(error);
    console.error("[publish-drawing-line-chart-quiz] failed", {
      projectId,
      serializedError,
    });
    return jsonResponse({ error: serializedError }, 500);
  }
});
