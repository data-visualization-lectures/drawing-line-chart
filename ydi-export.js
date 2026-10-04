import { TOOL_NAME_JA } from "./ydi-config.js";

const STYLE_PROPS = [
  "fill", "stroke", "stroke-width", "stroke-dasharray", "stroke-linecap",
  "stroke-linejoin", "opacity", "fill-opacity", "stroke-opacity", "font-family",
  "font-size", "font-weight", "text-anchor", "display", "visibility",
];

let _fontCSSCache = null;
let _fontBlocksCache = null;

export async function getFontCSS() {
  if (!_fontCSSCache) {
    const res = await fetch("https://fonts.googleapis.com/css2?family=Klee+One:wght@600&display=swap");
    _fontCSSCache = await res.text();
  }
  return _fontCSSCache;
}

export async function embedFontForChars(chars) {
  const cssText = await getFontCSS();
  if (!_fontBlocksCache) {
    _fontBlocksCache = [];
    const blocks = cssText.split(/(?=\/\*)/);
    for (const block of blocks) {
      const rangeMatch = block.match(/unicode-range:\s*([^;]+);/);
      const urlMatch = block.match(/url\((https:\/\/[^)]+)\)/);
      if (rangeMatch && urlMatch) {
        const ranges = rangeMatch[1].split(",").map(s => s.trim());
        _fontBlocksCache.push({ ranges, url: urlMatch[1], block });
      }
    }
  }
  const needed = _fontBlocksCache.filter(fb => {
    return fb.ranges.some(range => {
      const m = range.match(/U\+([0-9A-Fa-f]+)(?:-([0-9A-Fa-f]+))?/);
      if (!m) return false;
      const lo = parseInt(m[1], 16), hi = m[2] ? parseInt(m[2], 16) : lo;
      return chars.some(c => { const cp = c.codePointAt(0); return cp >= lo && cp <= hi; });
    });
  });
  let result = "";
  for (const fb of needed) {
    const res = await fetch(fb.url);
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    result += fb.block.replace(fb.url, "data:font/woff2;base64," + btoa(bin)) + "\n";
  }
  return result;
}

function splitOutlinedTextForExport(srcRoot, cloneRoot) {
  const paintIsVisible = (value) => {
    const text = String(value || "").trim();
    return text !== "" && text !== "none" && text !== "transparent";
  };
  const strokeDrawnBeforeFill = (order) => {
    const tokens = String(order || "").trim().split(/\s+/).filter(Boolean);
    if (!tokens.length || tokens[0] === "normal") return false;
    const strokeAt = tokens.indexOf("stroke");
    const fillAt = tokens.indexOf("fill");
    if (strokeAt < 0) return false;
    if (fillAt < 0) return true;
    return strokeAt < fillAt;
  };
  const collect = (src, clone, pairs) => {
    if (!src || !clone || src.nodeType !== 1 || clone.nodeType !== 1) return;
    if (src.localName === "text") {
      pairs.push([src, clone]);
      return;
    }
    const count = Math.min(src.children.length, clone.children.length);
    for (let i = 0; i < count; i += 1) collect(src.children[i], clone.children[i], pairs);
  };
  const pairs = [];
  collect(srcRoot, cloneRoot, pairs);
  pairs.forEach(([src, clone]) => {
    if (!clone.parentNode || typeof window.getComputedStyle !== "function") return;
    const style = window.getComputedStyle(src);
    const order = style.getPropertyValue("paint-order") || src.getAttribute("paint-order") || "";
    const strokeWidth = parseFloat(style.getPropertyValue("stroke-width"));
    const strokeOpacity = parseFloat(style.getPropertyValue("stroke-opacity") || "1");
    if (!strokeDrawnBeforeFill(order)
      || !paintIsVisible(style.getPropertyValue("fill"))
      || !paintIsVisible(style.getPropertyValue("stroke"))
      || !(strokeWidth > 0)
      || strokeOpacity === 0) return;
    const strokeEl = clone.cloneNode(true);
    const fillEl = clone.cloneNode(true);
    const setPaint = (el, name, value) => {
      el.style.setProperty(name, value);
      el.setAttribute(name, value);
    };
    strokeEl.style.removeProperty("paint-order");
    strokeEl.removeAttribute("paint-order");
    fillEl.style.removeProperty("paint-order");
    fillEl.removeAttribute("paint-order");
    setPaint(strokeEl, "fill", "none");
    setPaint(strokeEl, "stroke", style.getPropertyValue("stroke"));
    setPaint(strokeEl, "stroke-width", style.getPropertyValue("stroke-width"));
    setPaint(strokeEl, "stroke-linejoin", style.getPropertyValue("stroke-linejoin") || "round");
    const opacity = style.getPropertyValue("stroke-opacity");
    if (opacity) setPaint(strokeEl, "stroke-opacity", opacity);
    setPaint(fillEl, "fill", style.getPropertyValue("fill"));
    setPaint(fillEl, "stroke", "none");
    fillEl.style.removeProperty("stroke-width");
    fillEl.removeAttribute("stroke-width");
    clone.replaceWith(strokeEl);
    strokeEl.after(fillEl);
  });
}

function inlineStyles(srcEl, cloneEl) {
  const computed = window.getComputedStyle(srcEl);
  STYLE_PROPS.forEach(prop => {
    const val = computed.getPropertyValue(prop);
    if (val) cloneEl.style.setProperty(prop, val);
  });
  for (let i = 0; i < srcEl.children.length; i++) {
    if (cloneEl.children[i]) inlineStyles(srcEl.children[i], cloneEl.children[i]);
  }
}

export async function cloneChartSvg(svgEl, { stripClipPath = false, extraText = "" } = {}) {
  const clone = svgEl.cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  inlineStyles(svgEl, clone);
  splitOutlinedTextForExport(svgEl, clone);
  clone.querySelectorAll(".ydi-flash-rect, .ydi-drag-rect, .ydi-draw-prompt").forEach(el => el.remove());
  if (stripClipPath) {
    clone.querySelectorAll("[clip-path]").forEach(el => el.removeAttribute("clip-path"));
  }
  const allText = `${extraText}${clone.textContent || ""}`;
  const chars = [...new Set(allText.split(""))];
  const fontCSS = await embedFontForChars(chars);
  if (fontCSS) {
    const styleEl = document.createElementNS("http://www.w3.org/2000/svg", "style");
    styleEl.textContent = fontCSS;
    clone.insertBefore(styleEl, clone.firstChild);
  }
  return clone;
}

function loadSvgImage(svgNode) {
  const svgData = new XMLSerializer().serializeToString(svgNode);
  const blob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("SVG render failed"));
    };
    img.src = url;
  });
}

function createWhiteCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  return { canvas, ctx };
}

// SVG ノードを白背景のキャンバスいっぱいに描く
async function rasterizeSvg(svgNode, width, height) {
  const img = await loadSvgImage(svgNode);
  const { canvas, ctx } = createWhiteCanvas(width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return canvas;
}

function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("toBlob failed")), "image/png");
  });
}

async function rasterizeChart2x(svgEl) {
  const clone = await cloneChartSvg(svgEl);
  const svgW = parseFloat(svgEl.getAttribute("width")) || 640;
  const svgH = parseFloat(svgEl.getAttribute("height")) || 400;
  return rasterizeSvg(clone, svgW * 2, svgH * 2);
}

export async function downloadChartPng(svgEl, title) {
  if (!svgEl) return;
  const canvas = await rasterizeChart2x(svgEl);
  const a = document.createElement("a");
  a.download = (title || "chart") + ".png";
  a.href = canvas.toDataURL("image/png");
  a.click();
}

export async function generateThumbnailDataUri(svgEl) {
  if (!svgEl) return null;
  try {
    const canvas = await rasterizeChart2x(svgEl);
    return canvas.toDataURL("image/png");
  } catch (e) {
    console.warn("Thumbnail generation failed:", e);
    return null;
  }
}

// ------------------------------------------------------------
//  OG images (1200×630)
// ------------------------------------------------------------
const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

// クイズ（作成画面から公開）: チャート + 下帯にタイトル
export async function renderQuizOgPng(svgEl, title) {
  if (!svgEl) return null;
  const clone = await cloneChartSvg(svgEl, { extraText: title || "" });
  const img = await loadSvgImage(clone);

  const bandHeight = 60;
  const chartHeight = OG_HEIGHT - bandHeight;
  const { canvas, ctx } = createWhiteCanvas(OG_WIDTH, OG_HEIGHT);
  const scale = Math.min(OG_WIDTH / img.naturalWidth, chartHeight / img.naturalHeight);
  const dx = (OG_WIDTH - img.naturalWidth * scale) / 2;
  const dy = (chartHeight - img.naturalHeight * scale) / 2;
  ctx.drawImage(img, dx, dy, img.naturalWidth * scale, img.naturalHeight * scale);

  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(0, chartHeight, OG_WIDTH, bandHeight);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 24px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(title || TOOL_NAME_JA, OG_WIDTH / 2, OG_HEIGHT - bandHeight / 2);

  return canvasToPngBlob(canvas);
}

// 回答結果（回答ページで答え合わせ後）: タイトル + チャート + スコア
export async function renderResultOgPng(svgEl, title, scoreLabel) {
  if (!svgEl) return null;
  const ns = "http://www.w3.org/2000/svg";
  const clone = svgEl.cloneNode(true);

  // clip-pathを除去して実データ線を完全表示し、操作用の要素を除く
  clone.querySelectorAll("[clip-path]").forEach(el => el.removeAttribute("clip-path"));
  clone.querySelectorAll(".ydi-flash-rect, .ydi-drag-rect, .ydi-draw-prompt").forEach(el => el.remove());

  const origW = parseFloat(clone.getAttribute("width"));
  const origH = parseFloat(clone.getAttribute("height"));

  const wrapper = document.createElementNS(ns, "svg");
  wrapper.setAttribute("xmlns", ns);
  wrapper.setAttribute("width", OG_WIDTH);
  wrapper.setAttribute("height", OG_HEIGHT);
  wrapper.setAttribute("viewBox", `0 0 ${OG_WIDTH} ${OG_HEIGHT}`);

  const bg = document.createElementNS(ns, "rect");
  bg.setAttribute("width", OG_WIDTH);
  bg.setAttribute("height", OG_HEIGHT);
  bg.setAttribute("fill", "white");
  wrapper.appendChild(bg);

  // 使用文字のフォントsubsetを埋め込み
  const chars = [...new Set(((title || "") + (scoreLabel || "") + (clone.textContent || "")).split(""))];
  const fontCSS = await embedFontForChars(chars);
  const styleEl = document.createElementNS(ns, "style");
  styleEl.textContent = `
    ${fontCSS}
    text { font-family: 'Klee One', cursive; }
    .ydi-grid line { stroke: #e0e0e0; stroke-width: 1; }
    .axis path, .axis line { stroke: #ccc; }
    .axis text { fill: #888; font-size: 12px; }
    .ydi-known-line { fill: none; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
    .ydi-actual-line { fill: none; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
    .ydi-area { opacity: 0.12; }
    .ydi-user-line { fill: none; stroke-width: 3; stroke-dasharray: 1 7; stroke-linecap: round; }
    .ydi-value-label { font-size: 13px; font-weight: 700; }
    .ydi-divider { stroke: #ccc; stroke-width: 1; stroke-dasharray: 4 3; }
    .ydi-legend-label { font-size: 12px; font-weight: 600; }
  `;
  wrapper.appendChild(styleEl);

  const titleEl = document.createElementNS(ns, "text");
  titleEl.setAttribute("x", OG_WIDTH / 2);
  titleEl.setAttribute("y", 48);
  titleEl.setAttribute("text-anchor", "middle");
  titleEl.setAttribute("font-size", "28");
  titleEl.setAttribute("font-weight", "600");
  titleEl.setAttribute("fill", "#333");
  titleEl.textContent = title;
  wrapper.appendChild(titleEl);

  const chartG = document.createElementNS(ns, "g");
  const scale = Math.min((OG_WIDTH - 80) / origW, (OG_HEIGHT - 150) / origH);
  const dx = (OG_WIDTH - origW * scale) / 2;
  chartG.setAttribute("transform", `translate(${dx},75) scale(${scale})`);
  while (clone.firstChild) chartG.appendChild(clone.firstChild);
  wrapper.appendChild(chartG);

  const scoreEl = document.createElementNS(ns, "text");
  scoreEl.setAttribute("x", OG_WIDTH / 2);
  scoreEl.setAttribute("y", OG_HEIGHT - 28);
  scoreEl.setAttribute("text-anchor", "middle");
  scoreEl.setAttribute("font-size", "24");
  scoreEl.setAttribute("font-weight", "700");
  scoreEl.setAttribute("fill", "#555");
  scoreEl.textContent = scoreLabel;
  wrapper.appendChild(scoreEl);

  const canvas = await rasterizeSvg(wrapper, OG_WIDTH, OG_HEIGHT);
  return canvasToPngBlob(canvas);
}
