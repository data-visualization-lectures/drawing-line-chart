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

export async function downloadChartPng(svgEl, title) {
  if (!svgEl) return;
  const clone = await cloneChartSvg(svgEl);
  const img = await loadSvgImage(clone);
  const svgW = parseFloat(svgEl.getAttribute("width")) || 640;
  const svgH = parseFloat(svgEl.getAttribute("height")) || 400;
  const canvas = document.createElement("canvas");
  canvas.width = svgW * 2;
  canvas.height = svgH * 2;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const a = document.createElement("a");
  a.download = (title || "chart") + ".png";
  a.href = canvas.toDataURL("image/png");
  a.click();
}

export async function generateThumbnailDataUri(svgEl) {
  if (!svgEl) return null;
  try {
    const clone = await cloneChartSvg(svgEl);
    const img = await loadSvgImage(clone);
    const svgW = parseFloat(svgEl.getAttribute("width")) || 640;
    const svgH = parseFloat(svgEl.getAttribute("height")) || 400;
    const canvas = document.createElement("canvas");
    canvas.width = svgW * 2;
    canvas.height = svgH * 2;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } catch (e) {
    console.warn("Thumbnail generation failed:", e);
    return null;
  }
}
