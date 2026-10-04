// CSV / series helpers for the editor. No DOM access.

import { formatYearMonth } from "./ydi-chart.js";

const DATE_PARSER_URL = "https://id.data-viz-lectures.com/lib/dvz-date-parser.v1.mjs";
let dateParser = null;

// 共通日付パーサー（「2003年」「2003年4月」「令和6年」など）。読めなければ従来の判定だけで動く
export async function loadDateParser() {
  if (dateParser) return;
  try {
    const { createDVZDateParser } = await import(DATE_PARSER_URL);
    dateParser = createDVZDateParser(window.d3);
  } catch (error) {
    console.warn("dvz-date-parser unavailable; using built-in date rules:", error);
  }
}

function parseDate(raw) {
  if (!dateParser) return null;
  const { date, precision } = dateParser.parseDetailed(String(raw).trim());
  return date ? { date, precision } : null;
}

const sampleRows = (rows) => rows.slice(0, Math.min(10, rows.length));

const parseNumber = (raw) => parseFloat(String(raw).replace(/,/g, ""));

// 時系列列判定: 年(4桁)、年月(6桁YYYYMM)、日付文字列を含む列
export function isTimeSeriesCol(rows, col) {
  const sample = sampleRows(rows);
  return sample.filter(r => {
    const v = String(r[col]).trim();
    return /^\d{4}$/.test(v) || /^\d{6}$/.test(v) || /\d{4}[-\/]/.test(v) || !!parseDate(v);
  }).length > sample.length * 0.5;
}

// 数値列判定: 大半の行が数値に変換できる列
export function isNumericCol(rows, col) {
  const sample = sampleRows(rows);
  return sample.filter(r => !isNaN(parseNumber(r[col]))).length > sample.length * 0.5;
}

// X軸のフォーマットを決定（YYYYMM形式か年のみか）
export function detectXFormat(rows, col) {
  const sample = sampleRows(rows);
  const hasMonthly = sample.filter(r => {
    const v = String(r[col]).trim();
    if (/^\d{6}$/.test(v) || /^\d{4}[\/\-]\d{1,2}$/.test(v) || /^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}$/.test(v)) return true;
    const parsed = parseDate(v);
    return !!parsed && parsed.precision !== "year";
  }).length > sample.length * 0.5;
  return hasMonthly ? "yyyymm" : "year";
}

// YYYYMM → 小数年に変換（例: 201003 → 2010.167）
export function parseTimeValue(raw) {
  const s = String(raw).trim();
  const parsed = parseDate(s);
  if (parsed) {
    const y = parsed.date.getFullYear();
    return parsed.precision === "year" ? y : y + parsed.date.getMonth() / 12;
  }
  if (/^\d{6}$/.test(s)) {
    return parseInt(s.slice(0, 4)) + (parseInt(s.slice(4, 6)) - 1) / 12;
  }
  // YYYY/MM, YYYY-MM, YYYY/MM/DD, YYYY-MM-DD → 年月
  const ymMatch = s.match(/^(\d{4})[\/\-](\d{1,2})(?:[\/\-]\d{1,2})?$/);
  if (ymMatch) {
    return parseInt(ymMatch[1]) + (parseInt(ymMatch[2]) - 1) / 12;
  }
  let x = parseFloat(s);
  if (isNaN(x)) {
    const dateMatch = s.match(/(\d{4})/);
    if (dateMatch) x = parseInt(dateMatch[1]);
  }
  return x;
}

export function formatXValue(val, xFormat) {
  return xFormat === "yyyymm" ? formatYearMonth(val) : String(val);
}

export function rowsToSeries(rows, xCol, yCol) {
  return rows.map(d => ({ x: parseTimeValue(d[xCol]), y: parseNumber(d[yCol]) }));
}

// NaN を除き、2点以上・X重複なしを確認して X 昇順で返す
export function validateSeries(points) {
  const valid = points.filter(d => !isNaN(d.x) && !isNaN(d.y));
  if (valid.length < 2) throw new Error("有効なデータが2点未満です。列の選択を確認してください。");
  const xs = new Set(valid.map(d => d.x));
  if (xs.size !== valid.length) throw new Error("X軸に重複があります。データを整理してください。");
  return valid.sort((a, b) => a.x - b.x);
}

// アノテーション期間の選択肢（粒度: "year" | "yyyymm"）
export function annotationOptions(series, granularity) {
  if (!series || series.length < 2) return [];
  const minX = Math.floor(series[0].x);
  const maxX = Math.ceil(series[series.length - 1].x);
  const options = [];
  for (let y = minX; y <= maxX; y++) {
    if (granularity === "yyyymm") {
      for (let m = 1; m <= 12; m++) {
        const value = +(y + (m - 1) / 12).toFixed(6);
        options.push({ value, label: formatYearMonth(value) });
      }
    } else {
      options.push({ value: y, label: String(y) });
    }
  }
  return options;
}
