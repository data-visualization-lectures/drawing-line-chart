(function () {
  const SAFE_HTML_TAGS = new Set(["A", "B", "BR", "EM", "I", "P", "SPAN", "STRONG"]);
  const SAFE_HTML_ATTRS = {
    A: new Set(["href", "target", "rel"]),
  };

  function isSafeHref(value) {
    try {
      const url = new URL(String(value || ""), window.location.href);
      return ["http:", "https:", "mailto:"].includes(url.protocol);
    } catch (_error) {
      return false;
    }
  }

  function sanitizeHtmlFragment(html) {
    const template = document.createElement("template");
    template.innerHTML = String(html || "");
    const fragment = document.createDocumentFragment();

    const appendSanitized = (sourceParent, targetParent) => {
      Array.from(sourceParent.childNodes).forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          targetParent.appendChild(document.createTextNode(node.textContent || ""));
          return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;

        const tag = node.tagName;
        if (!SAFE_HTML_TAGS.has(tag)) {
          appendSanitized(node, targetParent);
          return;
        }

        const safeEl = document.createElement(tag.toLowerCase());
        const allowedAttrs = SAFE_HTML_ATTRS[tag] || new Set();
        Array.from(node.attributes).forEach((attr) => {
          if (!allowedAttrs.has(attr.name)) return;
          if (attr.name === "href" && !isSafeHref(attr.value)) return;
          safeEl.setAttribute(attr.name, attr.value);
        });
        if (tag === "A" && safeEl.target === "_blank") {
          safeEl.rel = "noopener";
        }
        appendSanitized(node, safeEl);
        targetParent.appendChild(safeEl);
      });
    };

    appendSanitized(template.content, fragment);
    return fragment;
  }

  function appendSanitizedHtml(parent, html) {
    if (!html) return;
    parent.appendChild(sanitizeHtmlFragment(html));
  }

  function populateSelect(selectEl, items, selectedValue) {
    selectEl.replaceChildren();
    items.forEach((item) => {
      const option = document.createElement("option");
      option.value = String(item.value);
      option.textContent = String(item.label);
      if (selectedValue !== undefined && String(item.value) === String(selectedValue)) {
        option.selected = true;
      }
      selectEl.appendChild(option);
    });
  }

  function createSingleColumnTable(headerLabel, values) {
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    const th = document.createElement("th");
    th.textContent = String(headerLabel || "");
    headerRow.appendChild(th);
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    values.forEach((value) => {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.textContent = value == null ? "" : String(value);
      row.appendChild(cell);
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    return table;
  }

  window.dvzDom = {
    appendSanitizedHtml,
    createSingleColumnTable,
    populateSelect,
    sanitizeHtmlFragment,
  };
})();
