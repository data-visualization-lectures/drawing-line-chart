// CSV / series helpers for the editor. No DOM access.

const sampleRows = (rows) => rows.slice(0, Math.min(10, rows.length));

const parseNumber = (raw) => parseFloat(String(raw).replace(/,/g, ""));

// 時系列列判定: 年(4桁)、年月(6桁YYYYMM)、日付文字列を含む列
export function isTimeSeriesCol(rows, col) {
  const sample = sampleRows(rows);
  return sample.filter(r => {
    const v = String(r[col]).trim();
    return /^\d{4}$/.test(v) || /^\d{6}$/.test(v) || /\d{4}[-\/]/.test(v);
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
    return /^\d{6}$/.test(v) || /^\d{4}[\/\-]\d{1,2}$/.test(v) || /^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}$/.test(v);
  }).length > sample.length * 0.5;
  return hasMonthly ? "yyyymm" : "year";
}

// YYYYMM → 小数年に変換（例: 201003 → 2010.167）
export function parseTimeValue(raw) {
  const s = String(raw).trim();
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

// 小数年 → "YYYY/MM"
export function formatYearMonth(val) {
  const y = Math.floor(val);
  const m = Math.round((val - y) * 12) + 1;
  return y + "/" + String(m).padStart(2, "0");
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
