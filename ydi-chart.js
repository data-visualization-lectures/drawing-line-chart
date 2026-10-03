export const DEFAULTS = {
  unit: "",
  yFormat: ",.0f",
  precision: 0,
  yExtent: 1.5,
  height: 300,
  margin: { top: 20, right: 130, bottom: 40, left: 55 },
  colors: { known: "#7570b3", actual: "#1b9e77", user: "#d95f02" },
  buttonText: "答え合わせ",
  drawPrompt: ["線を描いて", "予想してみよう"],
  afterRevealHTML: "",
};

const DEFAULT_LABELS = {
  legendPrediction: "あなたの予想",
  legendActual: "実際のデータ",
  scoreGood: "ほぼ正解！",
  scoreOk: "惜しい！",
  scoreLow: "控えめな予想でした",
  scoreHigh: "攻めた予想でした",
  scoreOff: "ずれていますね",
};

function clamp(min, max, val) {
  return Math.max(min, Math.min(max, val));
}

function sketchyLinePath(points) {
  const result = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const steps = 8;
    for (let j = 0; j <= steps; j++) {
      const t = j / steps;
      const jitterScale = Math.sin(t * Math.PI) * 2.5;
      result.push([
        x0 + (x1 - x0) * t + (Math.random() - 0.5) * jitterScale,
        y0 + (y1 - y0) * t + (Math.random() - 0.5) * jitterScale,
      ]);
    }
  }
  return d3.line().curve(d3.curveBasis)(result);
}

function drawSketchyCircle(parent, cx, cy, r, fillColor) {
  const dot = d3.sketchy.circle();
  dot.radius(r).cx(cx).cy(cy).fill(fillColor).stroke(fillColor).strokeWidth(6);
  parent.append("g").call(dot);
}

function drawSketchyLine(g, points, className, color, extraStyle) {
  const first = g.append("path").attr("class", className)
    .attr("d", sketchyLinePath(points)).attr("stroke", d3.sketchy.randomColor(color, 0.03))
    .style("stroke-width", 3.5).style("opacity", 0.35);
  const second = g.append("path").attr("class", className)
    .attr("d", sketchyLinePath(points)).attr("stroke", d3.sketchy.randomColor(color, 0.03))
    .style("stroke-width", 2).style("opacity", 0.85);
  if (extraStyle) {
    first.style(extraStyle.prop, extraStyle.value);
    second.style(extraStyle.prop, extraStyle.value);
  }
}

function resolveVerticalOverlaps(items, minGap) {
  if (items.length < 2) return;
  items.sort((a, b) => a.y - b.y);
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1];
    const curr = items[i];
    const overlap = (prev.y + prev.height + minGap) - curr.y;
    if (overlap > 0) {
      curr.y = prev.y + prev.height + minGap;
      if (curr.el) curr.el.attr("y", curr.y);
      if (curr.legendG) curr.legendG.attr("transform", `translate(${curr.legendX},${curr.y})`);
    }
  }
}

function mergeConfig(cfg) {
  return {
    ...DEFAULTS,
    ...cfg,
    margin: { ...DEFAULTS.margin, ...(cfg.margin || {}) },
    colors: { ...DEFAULTS.colors, ...(cfg.colors || {}) },
  };
}

function formatXTick(d, startX, xFormat) {
  if (xFormat === "yyyymm") {
    const y = Math.floor(d);
    const m = Math.round((d - y) * 12) + 1;
    return y + "/" + String(m).padStart(2, "0");
  }
  return d === startX ? d : "'" + String(d).slice(-2);
}

function xTickValues(data, width, xFormat) {
  const allX = data.map(d => d.x);
  const tickWidth = xFormat === "yyyymm" ? 70 : 40;
  const maxTicks = Math.max(2, Math.floor(width / tickWidth));
  const step = Math.max(1, Math.ceil(allX.length / maxTicks));
  return allX.filter((_, i) => i % step === 0 || i === allX.length - 1);
}

/**
 * @param {HTMLElement} parentEl
 * @param {object} rawConfig
 * @param {object} [options]
 * @param {"interactive"|"static"} [options.mode="interactive"]
 * @param {"none"|"outside"} [options.controls="none"]
 * @param {"editor"|"public"} [options.breakpoints="editor"]
 * @param {object} [options.labels]
 * @param {(el: HTMLElement, html: string) => void} [options.sanitizeHtml]
 */
export class ChartInstance {
  constructor(parentEl, rawConfig, options = {}) {
    this.cfg = mergeConfig(rawConfig);
    this.mode = options.mode || "interactive";
    this.controls = options.controls || "none";
    this.breakpoints = options.breakpoints || "editor";
    this.labels = { ...DEFAULT_LABELS, ...(options.labels || {}) };
    this.sanitizeHtml = options.sanitizeHtml || null;
    this.state = "idle";
    this.parentEl = parentEl;
    this.userData = null;
    this._predictionData = null;

    this._buildDOM();
    this._render();
  }

  _buildDOM() {
    const { cfg } = this;
    const wrap = document.createElement("div");
    wrap.className = "ydi-chart-wrap" + (cfg.style === "sketchy" ? " ydi-sketchy" : "");
    wrap.id = `ydi-${cfg.id}`;

    const h2 = document.createElement("h2");
    h2.textContent = cfg.title || "";
    wrap.appendChild(h2);

    const svgContainer = document.createElement("div");
    svgContainer.className = "ydi-svg-container";
    wrap.appendChild(svgContainer);
    this.parentEl.appendChild(wrap);

    if (this.controls === "outside") {
      const outerArea = document.createElement("div");
      outerArea.className = "ydi-outer-area";
      const buttonArea = document.createElement("div");
      buttonArea.className = "ydi-button-area";
      const button = document.createElement("button");
      button.className = "ydi-button";
      button.textContent = cfg.buttonText;
      buttonArea.appendChild(button);
      outerArea.appendChild(buttonArea);

      const afterReveal = document.createElement("div");
      afterReveal.className = "ydi-after-reveal";
      if (this.sanitizeHtml) this.sanitizeHtml(afterReveal, cfg.afterRevealHTML);
      outerArea.appendChild(afterReveal);
      this.parentEl.appendChild(outerArea);
      this.outerArea = outerArea;
      this.buttonEl = button;
      this.buttonEl.addEventListener("click", () => this._reveal());
    } else if (this.mode === "interactive") {
      const afterReveal = document.createElement("div");
      afterReveal.className = "ydi-after-reveal";
      if (this.sanitizeHtml) this.sanitizeHtml(afterReveal, cfg.afterRevealHTML);
      wrap.appendChild(afterReveal);
    }

    this.wrapEl = wrap;
    this.svgContainer = svgContainer;
  }

  _responsiveMargin() {
    const margin = { ...this.cfg.margin };
    if (this.breakpoints === "public") {
      if (window.innerWidth < 480) { margin.right = 70; margin.left = 40; }
      else if (window.innerWidth < 768) { margin.right = 90; margin.left = 45; }
    } else if (window.innerWidth < 600) {
      margin.right = 70;
      margin.left = 40;
    }
    return margin;
  }

  _render() {
    const { cfg } = this;
    this.svgContainer.replaceChildren();

    const totalWidth = this.svgContainer.offsetWidth || 560;
    const margin = this._responsiveMargin();
    const width = totalWidth - margin.left - margin.right;
    const height = cfg.height;
    const svgHeight = height + margin.top + margin.bottom;

    const data = cfg.data;
    const startX = data[0].x;
    const endX = data[data.length - 1].x;
    const drawStartX = cfg.drawStartX;
    const drawStartIndex = data.findIndex(d => d.x >= drawStartX);
    const xStep = data.length > 1 ? data[1].x - data[0].x : 1;

    const xScale = d3.scaleLinear().domain([startX, endX]).range([0, width]);
    const yMin = d3.min(data, d => d.y);
    const yMax = d3.max(data, d => d.y);
    const yPad = (yMax - yMin) * (cfg.yExtent - 1) || 1;
    const yDomainMin = yMin >= 0 ? 0 : yMin - yPad;
    const yDomainMax = yMax + yPad;
    const yScale = d3.scaleLinear().domain([yDomainMin, yDomainMax]).nice().range([height, 0]);
    const yFmt = d3.format(cfg.yFormat);

    const svg = d3.select(this.svgContainer).append("svg")
      .attr("width", totalWidth)
      .attr("height", svgHeight)
      .attr("viewBox", `0 0 ${totalWidth} ${svgHeight}`);
    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    this.svg = svg;
    this.g = g;
    this.xScale = xScale;
    this.yScale = yScale;
    this.width = width;
    this.height = height;
    this.margin = margin;
    this.yFmt = yFmt;
    this.xStep = xStep;
    this.endX = endX;
    this.drawStartX = drawStartX;
    this.data = data;

    const gridG = g.append("g").attr("class", "ydi-grid");
    gridG.selectAll("line.v").data(data.map(d => d.x)).join("line")
      .attr("x1", d => xScale(d)).attr("x2", d => xScale(d)).attr("y1", 0).attr("y2", height);
    gridG.selectAll("line.h").data(yScale.ticks(5)).join("line")
      .attr("x1", 0).attr("x2", width).attr("y1", d => yScale(d)).attr("y2", d => yScale(d));

    const annLabels = [];
    if (cfg.annotations && cfg.annotations.length > 0) {
      const annG = g.append("g").attr("class", "ydi-annotations");
      const sortedAnns = [...cfg.annotations].sort((a, b) => a.startX - b.startX);
      sortedAnns.forEach((ann, i) => {
        const x1 = Math.max(0, xScale(ann.startX));
        const x2 = Math.min(width, xScale(ann.endX));
        const w = x2 - x1;
        if (w <= 0) return;
        annG.append("rect")
          .attr("x", x1).attr("y", 0)
          .attr("width", w).attr("height", height)
          .attr("fill", "#000").attr("opacity", i % 2 === 0 ? 0.04 : 0.08);
        if (ann.label) annLabels.push({ x: (x1 + x2) / 2, label: ann.label });
      });
    }

    g.append("g")
      .attr("class", "axis x-axis")
      .attr("transform", `translate(0,${height})`)
      .call(
        d3.axisBottom(xScale)
          .tickValues(xTickValues(data, width, cfg.xFormat))
          .tickFormat(d => formatXTick(d, startX, cfg.xFormat))
          .tickSize(6)
      )
      .select(".domain").remove();

    g.selectAll(".ydi-y-label").data(yScale.ticks(5)).join("text")
      .attr("class", "ydi-y-label")
      .attr("x", -5).attr("y", d => yScale(d))
      .attr("dy", "0.35em").attr("text-anchor", "end")
      .attr("fill", "#888").attr("font-size", 11)
      .text(d => yFmt(d));

    g.append("line").attr("class", "ydi-divider")
      .attr("x1", xScale(drawStartX)).attr("x2", xScale(drawStartX)).attr("y1", 0).attr("y2", height);

    const line = d3.line().x(d => xScale(d.x)).y(d => yScale(d.y));
    const sketchy = cfg.style === "sketchy";
    const toPoints = (arr) => arr.map(d => [xScale(d.x), yScale(d.y)]);
    const knownData = data.filter(d => d.x <= drawStartX);
    const actualData = data.filter(d => d.x >= drawStartX);

    if (sketchy) {
      drawSketchyLine(g, toPoints(knownData), "ydi-known-line", cfg.colors.known);
    } else {
      g.append("path").attr("class", "ydi-known-line").attr("d", line(knownData)).attr("stroke", cfg.colors.known);
    }

    const hideActual = this.mode === "interactive" && this.state !== "revealed";
    let actualParent = g;
    if (this.mode === "interactive") {
      const clipId = `ydi-clip-${cfg.id}`;
      const clipWidth = hideActual ? xScale(drawStartX) : width + margin.left + margin.right + 20;
      const clipRect = svg.append("defs").append("clipPath").attr("id", clipId)
        .append("rect").attr("x", 0).attr("y", 0)
        .attr("width", clipWidth).attr("height", svgHeight);
      this.clipRect = clipRect;
      actualParent = g.append("g").attr("clip-path", `url(#${clipId})`);
    }

    if (sketchy) {
      drawSketchyLine(actualParent, toPoints(actualData), "ydi-actual-line", cfg.colors.actual);
    } else {
      actualParent.append("path").attr("class", "ydi-actual-line").attr("d", line(actualData)).attr("stroke", cfg.colors.actual);
    }

    const endPt = data[data.length - 1];
    const startPt = data[0];
    const midPt = data[drawStartIndex];
    this.actualEndValue = endPt.y;
    this.actualEndY = yScale(endPt.y);

    this._drawEndpoint(actualParent, endPt, cfg.colors.actual, sketchy);
    this.actualEndLabelEl = actualParent.append("text")
      .attr("class", "ydi-value-label")
      .attr("x", xScale(endPt.x) + 10)
      .attr("y", yScale(endPt.y))
      .attr("dy", "0.35em")
      .attr("fill", cfg.colors.actual)
      .text(yFmt(endPt.y) + cfg.unit);

    this._drawEndpoint(g, startPt, cfg.colors.known, sketchy);
    g.append("text").attr("class", "ydi-value-label")
      .attr("x", xScale(startPt.x)).attr("y", yScale(startPt.y) - 12)
      .attr("text-anchor", "middle").attr("fill", cfg.colors.known)
      .text(yFmt(startPt.y) + cfg.unit);

    this._drawEndpoint(g, midPt, cfg.colors.known, sketchy);
    const midLabelDy = drawStartIndex > 0 && midPt.y > data[drawStartIndex - 1].y ? -12 : 16;
    g.append("text").attr("class", "ydi-value-label")
      .attr("x", xScale(midPt.x) - 8)
      .attr("y", yScale(midPt.y) + midLabelDy)
      .attr("text-anchor", "end").attr("fill", cfg.colors.known)
      .text(yFmt(midPt.y) + cfg.unit);

    if (this.mode === "interactive") {
      this._ensureUserData(data, drawStartX, endX, midPt.y);
      this._drawInteractiveLayers(svg, g, svgHeight);
      this._paintUserDrawing({ animate: false });
    }

    annLabels.forEach(a => {
      g.append("text").attr("class", "ydi-annotation-label")
        .attr("x", a.x).attr("y", 12)
        .attr("text-anchor", "middle")
        .attr("fill", "#888").attr("font-size", 11)
        .text(a.label);
    });

    this._observeResize();
  }

  _drawEndpoint(parent, pt, color, sketchy) {
    const { xScale, yScale } = this;
    if (sketchy) {
      drawSketchyCircle(parent, xScale(pt.x), yScale(pt.y), 4, color);
    } else {
      parent.append("circle").attr("cx", xScale(pt.x)).attr("cy", yScale(pt.y)).attr("r", 5).attr("fill", color);
    }
  }

  _ensureUserData(data, drawStartX, endX, midY) {
    if (this.userData) return;
    this.userData = data
      .filter(d => d.x >= drawStartX && d.x <= endX)
      .map(d => ({ x: d.x, y: d.y, userY: null, defined: false }));
    this.userData[0].userY = midY;
    this.userData[0].defined = true;
  }

  _drawInteractiveLayers(svg, g, svgHeight) {
    const { xScale, cfg, userData, drawStartX, endX, xStep, height, margin } = this;
    const drawClipId = `ydi-drawclip-${cfg.id}`;
    svg.select("defs").append("clipPath").attr("id", drawClipId)
      .append("rect")
      .attr("x", xScale(drawStartX)).attr("y", 0)
      .attr("width", xScale(endX) - xScale(drawStartX) + margin.right)
      .attr("height", svgHeight);

    const flashRects = g.append("g").attr("class", "ydi-flash-rects")
      .attr("clip-path", `url(#${drawClipId})`);
    const halfStep = (xScale(xStep) - xScale(0)) / 2;
    this.flashRectsSel = flashRects.selectAll("rect")
      .data(userData.slice(1))
      .join("rect")
      .attr("class", "ydi-flash-rect ydi-pending")
      .attr("x", d => xScale(d.x) - halfStep)
      .attr("y", 0)
      .attr("width", xScale(xStep) - xScale(0))
      .attr("height", height);

    this.userLineSel = g.append("path").attr("class", "ydi-user-line").attr("stroke", cfg.colors.user);
    this.userCircleSel = g.append("circle").attr("class", "ydi-endpoint").attr("r", 5)
      .attr("fill", cfg.colors.user).attr("opacity", 0);
    this.userValueSel = g.append("text").attr("class", "ydi-value-label")
      .attr("dy", "0.35em").attr("fill", cfg.colors.user).attr("opacity", 0);

    const promptCenterX = (xScale(drawStartX + xStep) + xScale(endX)) / 2;
    const promptG = g.append("text").attr("class", "ydi-draw-prompt")
      .attr("x", promptCenterX).attr("y", height / 3);
    const promptLines = Array.isArray(cfg.drawPrompt) ? cfg.drawPrompt : [cfg.drawPrompt];
    promptLines.forEach((ln, i) => {
      promptG.append("tspan").attr("x", promptCenterX).attr("dy", i === 0 ? 0 : "1.4em").text(ln);
    });

    this.dragRect = g.append("rect").attr("class", "ydi-drag-rect")
      .attr("x", xScale(drawStartX)).attr("y", 0)
      .attr("width", xScale(endX) - xScale(drawStartX))
      .attr("height", height);
    this._bindPointerHandlers();
  }

  _paintUserDrawing({ animate } = { animate: false }) {
    if (this.mode !== "interactive" || !this.userData || !this.userLineSel) return;
    const { xScale, yScale, cfg, userData } = this;
    const hasProgress = userData.some((d, i) => i > 0 && d.defined);
    if (hasProgress) {
      this.wrapEl.classList.add("ydi-drag-started");
      if (this.state === "idle") this.state = "drawing";
    }

    this.flashRectsSel.each(function(d) {
      if (d.defined) d3.select(this).classed("ydi-pending", false).attr("fill-opacity", 0);
    });

    const userLine = d3.line().defined(d => d.defined).x(d => xScale(d.x)).y(d => yScale(d.userY));
    this.userLineSel.attr("d", userLine(userData));

    const lastDefined = [...userData].reverse().find(d => d.defined);
    if (lastDefined && lastDefined.x > this.drawStartX) {
      this.userCircleSel
        .attr("cx", xScale(lastDefined.x))
        .attr("cy", yScale(lastDefined.userY))
        .attr("opacity", 1);
      const displayVal = cfg.precision
        ? this.yFmt(parseFloat(lastDefined.userY.toFixed(cfg.precision)))
        : this.yFmt(lastDefined.userY);
      this.userValueSel
        .attr("x", xScale(lastDefined.x) + 10)
        .attr("y", yScale(lastDefined.userY))
        .attr("text-anchor", "start")
        .attr("opacity", 1)
        .text(displayVal + cfg.unit);
    }

    if (userData.every(d => d.defined)) {
      if (this.state !== "revealed") this.state = "ready";
      this.wrapEl.classList.add("ydi-ready");
      this.outerArea?.classList.add("ydi-ready");
    }

    if (this.state === "revealed") {
      this._applyRevealedVisuals({ animate: !!animate });
    }
  }

  _observeResize() {
    if (this._resizeObserver) return;
    this._resizeObserver = new ResizeObserver(() => {
      clearTimeout(this._resizeTimer);
      this._resizeTimer = setTimeout(() => {
        this._render();
        if (this.mode === "static" && this._predictionData) {
          this.renderPrediction(this._predictionData);
        }
      }, 200);
    });
    this._resizeObserver.observe(this.svgContainer);
  }

  _handleDrag(rawMx, rawMy) {
    if (this.state === "revealed") return;
    const { xScale, yScale, cfg, userData } = this;
    const xStep = this.xStep;
    const xVal = clamp(cfg.drawStartX + xStep * 0.5, this.endX + xStep * 0.5, xScale.invert(rawMx));
    const yVal = clamp(yScale.domain()[0], yScale.domain()[1], yScale.invert(rawMy));

    let lastDefinedIdx = 0;
    for (let i = userData.length - 1; i >= 0; i--) {
      if (userData[i].defined) { lastDefinedIdx = i; break; }
    }

    userData.forEach((d, i) => {
      if (Math.abs(d.x - xVal) < xStep * 0.5) {
        d.userY = yVal;
        d.defined = true;
        const gap = i - lastDefinedIdx;
        if (gap > 1) {
          for (let j = 1; j < gap; j++) {
            const t = j / gap;
            userData[lastDefinedIdx + j].userY =
              userData[lastDefinedIdx].userY * (1 - t) + yVal * t;
            userData[lastDefinedIdx + j].defined = true;
          }
        }
      }
    });

    this._paintUserDrawing();
  }

  _bindPointerHandlers() {
    const self = this;
    const dragNode = this.dragRect.node();
    let active = false;

    function onPointer(e) {
      if (self.state === "revealed") return;
      e.preventDefault();
      const [mx, my] = d3.pointer(e, self.g.node());
      self._handleDrag(mx, my);
    }

    dragNode.addEventListener("pointerdown", function(e) {
      active = true;
      dragNode.setPointerCapture(e.pointerId);
      onPointer(e);
    }, { passive: false });
    dragNode.addEventListener("pointermove", function(e) {
      if (!active) return;
      onPointer(e);
    }, { passive: false });
    dragNode.addEventListener("pointerup", function() { active = false; });
    dragNode.addEventListener("pointercancel", function() { active = false; });
    dragNode.addEventListener("lostpointercapture", function() { active = false; });
  }

  _drawLegend() {
    const { g, width, height, cfg, labels } = this;
    const legendX = width + 12;
    const legendG = g.append("g")
      .attr("class", "ydi-legend")
      .attr("transform", `translate(${legendX},${height - 40})`);
    if (this.mode === "static") legendG.style("opacity", 1);

    legendG.append("line").attr("x1", 0).attr("x2", 20).attr("y1", 0).attr("y2", 0)
      .attr("stroke", cfg.colors.user).attr("stroke-width", 3)
      .attr("stroke-dasharray", "1 7").attr("stroke-linecap", "round");
    legendG.append("text").attr("class", "ydi-legend-label").attr("x", 26).attr("y", 0)
      .attr("dy", "0.35em").attr("fill", cfg.colors.user).text(labels.legendPrediction);
    legendG.append("line").attr("x1", 0).attr("x2", 20).attr("y1", 22).attr("y2", 22)
      .attr("stroke", cfg.colors.actual).attr("stroke-width", 3).attr("stroke-linecap", "round");
    legendG.append("text").attr("class", "ydi-legend-label").attr("x", 26).attr("y", 22)
      .attr("dy", "0.35em").attr("fill", cfg.colors.actual).text(labels.legendActual);
    return { legendG, legendX };
  }

  _applyRevealedVisuals({ animate }) {
    const { xScale, yScale, width, margin, userData } = this;
    this.wrapEl.classList.add("ydi-guessed");
    this.outerArea?.classList.add("ydi-guessed");

    const fullWidth = width + margin.left + margin.right + 20;
    if (this.clipRect) {
      if (animate) {
        this.clipRect.transition().duration(1000).ease(d3.easeLinear).attr("width", fullWidth);
      } else {
        this.clipRect.attr("width", fullWidth);
      }
    }

    const { legendG, legendX } = this._drawLegend();
    const userEndY = yScale(userData[userData.length - 1].userY);
    const labelItems = [
      { y: this.actualEndY, height: 14, el: this.actualEndLabelEl, id: "actual" },
      { y: userEndY, height: 14, el: this.userValueSel, id: "user" },
      { y: this.height - 40, height: 40, legendG, legendX, id: "legend" },
    ];
    resolveVerticalOverlaps(labelItems, 4);
    const userItem = labelItems.find(i => i.id === "user");
    if (animate) {
      this.userValueSel.transition().duration(300).attr("y", userItem.y);
    } else {
      this.userValueSel.attr("y", userItem.y);
    }
  }

  _scoreFromUserData() {
    const { userData, cfg, labels } = this;
    const scores = userData.slice(1).map(d => d.userY / d.y);
    const totalError = d3.sum(scores, s => Math.abs(1 - s));
    const avgRatio = d3.mean(scores);
    let label, cls;
    if (totalError < 0.5) { label = labels.scoreGood; cls = "ydi-score-good"; }
    else if (totalError < 2) { label = labels.scoreOk; cls = "ydi-score-ok"; }
    else {
      label = avgRatio < 0.7 ? labels.scoreLow : avgRatio > 1.3 ? labels.scoreHigh : labels.scoreOff;
      cls = "ydi-score-off";
    }
    const exportData = userData.map(d => ({
      x: d.x,
      actual: d.y,
      prediction: cfg.precision ? parseFloat(d.userY.toFixed(cfg.precision)) : Math.round(d.userY),
    }));
    return { totalError, avgRatio, label, cls, exportData };
  }

  _reveal() {
    if (this.state !== "ready") return;
    this.state = "revealed";
    this._applyRevealedVisuals({ animate: true });

    const { totalError, avgRatio, label, cls, exportData } = this._scoreFromUserData();
    this.exportData = exportData;
    this.scoreResult = { totalError, avgRatio, label, cls };

    const afterEl = (this.outerArea || this.wrapEl).querySelector(".ydi-after-reveal");
    if (afterEl) {
      afterEl.replaceChildren();
      const scoreDiv = document.createElement("div");
      scoreDiv.className = `ydi-score ${cls}`;
      scoreDiv.textContent = label;
      afterEl.appendChild(scoreDiv);
    }

    this.wrapEl.dispatchEvent(new CustomEvent("you-draw-it:revealed", {
      bubbles: true,
      detail: { id: this.cfg.id, totalError, avgRatio, label, exportData },
    }));
  }

  renderPrediction(predictionData) {
    this._predictionData = predictionData;
    const { xScale, yScale, g, cfg, width, data } = this;
    const sketchy = cfg.style === "sketchy";
    const validPts = predictionData.filter(d => d.prediction != null);

    g.selectAll(".ydi-user-line").remove();
    if (sketchy) {
      const userPts = validPts.map(d => [xScale(d.x), yScale(d.prediction)]);
      if (userPts.length > 1) {
        drawSketchyLine(g, userPts, "ydi-user-line", cfg.colors.user, { prop: "stroke-dasharray", value: "none" });
      }
    } else {
      const userLine = d3.line().defined(d => d.prediction != null)
        .x(d => xScale(d.x)).y(d => yScale(d.prediction));
      g.append("path").attr("class", "ydi-user-line").attr("d", userLine(predictionData)).attr("stroke", cfg.colors.user);
    }

    const lastPt = predictionData[predictionData.length - 1];
    if (!lastPt) return;

    this._drawEndpoint(g, { x: lastPt.x, y: lastPt.prediction }, cfg.colors.user, sketchy);
    const displayVal = cfg.precision
      ? this.yFmt(parseFloat(lastPt.prediction.toFixed(cfg.precision)))
      : this.yFmt(lastPt.prediction);
    const userLabelEl = g.append("text").attr("class", "ydi-value-label")
      .attr("x", xScale(lastPt.x) + 10)
      .attr("y", yScale(lastPt.prediction))
      .attr("dy", "0.35em")
      .attr("fill", cfg.colors.user)
      .text(displayVal + cfg.unit);

    const { legendG, legendX } = this._drawLegend();
    const endPt = data[data.length - 1];
    const labelItems = [
      { y: yScale(endPt.y), height: 14, el: this.actualEndLabelEl, id: "actual" },
      { y: yScale(lastPt.prediction), height: 14, el: userLabelEl, id: "user" },
      { y: this.height - 40, height: 40, legendG, legendX, id: "legend" },
    ];
    resolveVerticalOverlaps(labelItems, 4);
  }
}
