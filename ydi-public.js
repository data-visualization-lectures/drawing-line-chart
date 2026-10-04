// Shell shared by the public quiz page (quiz.html) and result page (share.html).

export function createI18n(translations) {
  const lang = navigator.language.startsWith("ja") ? "ja" : "en";
  document.documentElement.lang = lang;
  const t = (key) => translations[lang]?.[key] ?? translations.en[key] ?? key;
  return { lang, t };
}

// ?embed=1: 背景・サイトリンクを隠し、親へ高さを通知し、リンクを新しいタブで開く
export function setupEmbedMode() {
  const isEmbed = new URLSearchParams(location.search).get("embed") === "1";
  if (!isEmbed) return false;

  document.documentElement.classList.add("dvz-embed");

  const postHeight = () => {
    window.parent.postMessage(
      { type: "dvz-resize", height: document.documentElement.scrollHeight },
      "*"
    );
  };
  new ResizeObserver(postHeight).observe(document.body);
  window.addEventListener("load", postHeight);

  const retargetLinks = () => {
    document.querySelectorAll('a[href]:not([target="_blank"])').forEach(a => {
      if (!a.href.startsWith("javascript:")) {
        a.target = "_blank";
        a.rel = "noopener";
      }
    });
  };
  retargetLinks();
  new MutationObserver(retargetLinks).observe(document.body, { childList: true, subtree: true });
  return true;
}

export function fillSiteLinks(toolName) {
  document.querySelector(".dvz-site-links a:first-child").textContent = toolName;
}

export function showLoading(message) {
  document.getElementById("dvz-loading").textContent = message;
}

export function hideLoading() {
  document.getElementById("dvz-loading").style.display = "none";
}

export function showPageError(message) {
  hideLoading();
  const errorEl = document.getElementById("dvz-error");
  errorEl.style.display = "block";
  errorEl.textContent = message;
}

// 読み込みが終わらないときにエラーを出す。戻り値で取り消す
export function startLoadTimeout(message, ms = 15000) {
  const timer = setTimeout(() => showPageError(message), ms);
  return () => clearTimeout(timer);
}
