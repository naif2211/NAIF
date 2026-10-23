// Harbor source for 3asq.online
const BASE = "https://3asq.online";
const PAGE_SIZE = 48;
const CHAPTER_SUFFIX = "?style=list";

function clean(text) {
  return text ? String(text).replace(/\s+/g, " ").trim() : "";
}

function abs(url) {
  if (!url) return undefined;
  url = String(url).trim();
  if (!url || url.startsWith("data:")) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return BASE + url;
  return BASE + "/" + url;
}

async function getDoc(path, options) {
  const res = await harbor.http(BASE + path, Object.assign({
    responseType: "text",
    timeoutMs: 30000,
    headers: { Referer: BASE + "/" }
  }, options || {}));
  if (!res.ok) throw new Error("http " + res.status + " for " + path);
  return harbor.parseHtml(res.body || "");
}

function firstText(el, selectors) {
  for (const sel of selectors) {
    const x = el?.querySelector(sel);
    const t = clean(x?.text());
    if (t) return t;
  }
  return undefined;
}

function firstAttr(el, selectors, attrs) {
  for (const sel of selectors) {
    const x = el?.querySelector(sel);
    if (!x) continue;
    for (const attr of attrs) {
      const v = x.attr(attr);
      if (v) return v;
    }
  }
  return undefined;
}

function mangaIdFromHref(href) {
  if (!href) return null;
  const m = String(href).match(/\/manga\/([^/?#]+)\/?(?:[?#].*)?$/i);
  return m ? m[1] : null;
}

function cardToSummary(el) {
  const link = el.querySelector("div.post-title a") || el.querySelector(".post-title a") || el.querySelector("a");
  if (!link) return null;
  const href = link.attr("href") || "";
  const id = mangaIdFromHref(href);
  if (!id) return null;

  const img = el.querySelector("img");
  const title = clean(
    link.attr("title") ||
    firstText(el, [".post-title", ".item-summary h3", ".summary_content h3", "h3", "h4"]) ||
    link.text()
  );
  if (!title) return null;

  return {
    id,
    title,
    cover: abs(img?.attr("data-src") || img?.attr("data-lazy-src") || img?.attr("data-original") || img?.attr("src"))
  };
}

function findCards(doc) {
  const selectors = [
    "div.page-item-detail",
    ".page-item-detail.manga",
    ".manga__item",
    ".c-tabs-item__content .row.c-tabs-item__content",
    ".row.c-tabs-item__content",
    ".tab-thumb.c-tabs-item__content",
    ".manga-item",
    ".item-summary"
  ];
  const out = [];
  const seen = new Set();
  for (const sel of selectors) {
    for (const el of doc.querySelectorAll(sel)) {
      const item = cardToSummary(el);
      if (item && !seen.has(item.id)) {
        seen.add(item.id);
        out.push(item);
      }
    }
    if (out.length) break;
  }
  return out;
}

function chapterNumber(text, href) {
  const s = clean(text) || String(href || "");
  let m = s.match(/(?:chapter|ch\.?|الفصل|فصل)\s*#?\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (!m) m = s.match(/\/([0-9]+(?:\.[0-9]+)?)\/?(?:\?|#|$)/);
  if (!m) m = s.match(/([0-9]+(?:\.[0-9]+)?)/);
  return m ? m[1] : null;
}

function chapterFromLink(a, li) {
  let href = abs(a.attr("href") || "");
  if (!href) return null;
  if (CHAPTER_SUFFIX && !href.includes("?style=list")) href += CHAPTER_SUFFIX;

  const title = clean(a.text());
  const number = a.attr("data-number") || chapterNumber(title, href);
  return {
    id: href,
    chapter: number,
    title: title || (number ? "Chapter " + number : undefined),
    volume: null,
    pages: 0,
    language: "ar"
  };
}

function chaptersFromDoc(doc) {
  const out = [];
  const seen = new Set();

  const selectors = [
    ".listing-chapters_wrap ul.main li.wp-manga-chapter a",
    ".listing-chapters_wrap li.wp-manga-chapter a",
    "li.wp-manga-chapter a",
    ".version-chap li.wp-manga-chapter a",
    ".main.version-chap li a",
    "div.wp-manga-chapter a",
    "a[href*='/manga/'][href*='?style=list']"
  ];

  for (const sel of selectors) {
    for (const a of doc.querySelectorAll(sel)) {
      const c = chapterFromLink(a, a.parentElement);
      if (!c || seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
    }
    if (out.length) return out;
  }
  return out;
}

function postId(doc) {
  for (const h of doc.querySelectorAll("div[id^='manga-chapters-holder'], .manga-chapters-holder")) {
    const id = h.attr("data-id");
    if (id) return id;
  }
  return null;
}

function formEncode(obj) {
  const p = [];
  for (const k of Object.keys(obj)) {
    if (obj[k] === undefined || obj[k] === null) continue;
    p.push(encodeURIComponent(k) + "=" + encodeURIComponent(String(obj[k])));
  }
  return p.join("&");
}

async function chapterList(id) {
  const mangaPath = "/manga/" + encodeURIComponent(id) + "/";
  const collected = [];
  const seen = new Set();
  function merge(items) {
    for (const item of items) {
      if (!item || !item.id || seen.has(item.id)) continue;
      seen.add(item.id);
      collected.push(item);
    }
  }

  let doc = null;
  try {
    doc = await getDoc(mangaPath + CHAPTER_SUFFIX);
    merge(chaptersFromDoc(doc));
  } catch (_) {
    try { doc = await getDoc(mangaPath); merge(chaptersFromDoc(doc)); } catch (_) {}
  }

  // Do not return early just because the page contains a first/latest chapter.
  // The site's theme may render only a partial list in the initial HTML and load
  // the complete numbered list from its AJAX endpoint.
  const pid = doc ? postId(doc) : null;
  if (pid) {
    try {
      const res = await harbor.http(BASE + "/wp-admin/admin-ajax.php", {
        method: "POST",
        responseType: "text",
        timeoutMs: 30000,
        headers: {
          "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
          "x-requested-with": "XMLHttpRequest",
          Referer: BASE + mangaPath
        },
        body: formEncode({ action: "manga_get_chapters", manga: pid })
      });
      if (res.ok) merge(chaptersFromDoc(await harbor.parseHtml(res.body || "")));
    } catch (_) {}
  }

  try {
    const res = await harbor.http(BASE + mangaPath.replace(/\/$/, "") + "/ajax/chapters/", {
      method: "POST",
      responseType: "text",
      timeoutMs: 30000,
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-requested-with": "XMLHttpRequest",
        Referer: BASE + mangaPath
      },
      body: ""
    });
    if (res.ok) merge(chaptersFromDoc(await harbor.parseHtml(res.body || "")));
  } catch (_) {}

  collected.sort((a, b) => {
    const an = Number(String(a.chapter || "").replace(/[^0-9.]/g, ""));
    const bn = Number(String(b.chapter || "").replace(/[^0-9.]/g, ""));
    if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
    return 0;
  });
  return collected;
}

const plugin = {
  id: "3asq",
  name: "العاشق",

  async popular(offset, tagId) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    let path = "/manga/?m_orderby=views&page=" + page;
    if (tagId) path += "&genre=" + encodeURIComponent(tagId);
    return findCards(await getDoc(path));
  },

  async search(query, offset, tagId) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    let path = "/manga/?s=" + encodeURIComponent(query) + "&post_type=wp-manga&page=" + page;
    if (tagId) path += "&genre=" + encodeURIComponent(tagId);
    return findCards(await getDoc(path));
  },

  async detail(id) {
    const doc = await getDoc("/manga/" + encodeURIComponent(id) + "/" + CHAPTER_SUFFIX);
    const root = doc.querySelector(".site-content") || doc;
    return {
      id,
      title: clean(root.querySelector("div.post-title h1")?.text()) || clean(root.querySelector("h1")?.text()) || id,
      altTitle: firstText(root, [".alternative", ".post-content_item.manga_alternative .summary-content"]),
      cover: abs(
        firstAttr(root, [
          ".summary_image img", ".profile-manga img", ".tab-summary .summary_image img",
          ".summary_image", ".profile-manga", ".tab-summary .summary_image"
        ], ["data-src", "data-lazy-src", "data-original", "src", "data-cfsrc"])
        || root.querySelector("meta[property='og:image']")?.attr("content")
      ),
      author: firstText(root, [".author-content", ".post-content_item.manga-authors .summary-content", ".post-content_item.manga-author .summary-content"]),
      status: firstText(root, [".post-content_item.manga-status .summary-content", ".post-content_item.manga_status .summary-content"]),
      description: firstText(root, [".summary__content", ".description-summary .summary__content", ".description-summary"]),
      lastChapter: firstText(root, [".wp-manga-chapter a", "li.wp-manga-chapter a"])
    };
  },

  async chapters(id) {
    return chapterList(id);
  },

  async pageUrls(chapterId) {
    const path = "/" + String(chapterId).replace(/^https?:\/\/[^/]+/i, "").replace(/^\//, "");
    const res = await harbor.http(BASE + path, {
      responseType: "text",
      timeoutMs: 30000,
      headers: { Referer: BASE + "/" }
    });
    if (!res.ok) throw new Error("http " + res.status + " for " + path);
    const doc = await harbor.parseHtml(res.body || "");
    const urls = [];
    const seen = new Set();
    for (const sel of [
      ".reading-content .page-break img",
      ".reading-content img",
      ".page-break img",
      ".wp-manga-chapter-img img",
      ".entry-content img"
    ]) {
      for (const img of doc.querySelectorAll(sel)) {
        const u = abs(img.attr("data-src") || img.attr("data-lazy-src") || img.attr("data-original") || img.attr("src"));
        if (!u || seen.has(u)) continue;
        seen.add(u);
        urls.push(u);
      }
      if (urls.length) break;
    }
    return urls;
  },

  async tags() {
    const doc = await getDoc("/manga/");
    const out = [];
    const seen = new Set();
    for (const a of doc.querySelectorAll(".genres-content a, .genres a, .manga-genres a")) {
      const name = clean(a.text());
      const href = a.attr("href") || "";
      const m = href.match(/\/genre\/([^/?#]+)/i);
      if (!name || !m || seen.has(m[1])) continue;
      seen.add(m[1]);
      out.push({ id: m[1], name, group: "Genre" });
    }
    return out;
  }
};

return plugin;