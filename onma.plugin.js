// Harbor source for onma.me (مانجا اون لاين)
const BASE = "https://onma.me";
const PAGE_SIZE = 48;

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

function mangaIdFromHref(href) {
  if (!href) return null;
  const s = String(href).replace(/^https?:\/\/[^/]+/i, "");
  const m = s.match(/^\/manga\/([^/?#]+)\/?$/i);
  return m ? decodeURIComponent(m[1]) : null;
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

function cardToSummary(el) {
  const link = el.querySelector("a[href^='/manga/']") || el.querySelector("a[href*='/manga/']");
  if (!link) return null;
  const href = link.attr("href") || "";
  const id = mangaIdFromHref(href);
  if (!id) return null;

  const title = clean(
    link.attr("title") ||
    link.attr("aria-label") ||
    firstText(el, ["h2", "h3", "h4", ".post-title", ".title", ".name"]) ||
    link.text()
  );
  if (!title) return null;

  const img = el.querySelector("img");
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
    ".manga-item",
    ".item-summary",
    ".row.c-tabs-item__content",
    ".c-tabs-item__content .row",
    "article",
    ".manga-list .item",
    ".manga-list li"
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
    if (out.length) return out;
  }

  // Generic fallback: collect direct manga links from any page.
  for (const a of doc.querySelectorAll("a[href^='/manga/'], a[href*='/manga/']")) {
    const id = mangaIdFromHref(a.attr("href") || "");
    const title = clean(a.attr("title") || a.text());
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    const parent = a.parentElement;
    const img = parent?.querySelector("img") || a.querySelector("img");
    out.push({
      id,
      title,
      cover: abs(img?.attr("data-src") || img?.attr("data-lazy-src") || img?.attr("data-original") || img?.attr("src"))
    });
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

function chapterFromLink(a) {
  const href = abs(a.attr("href") || "");
  if (!href) return null;
  const title = clean(a.text());
  const number = a.attr("data-number") || chapterNumber(title, href);
  if (!number) return null;
  return {
    id: href,
    chapter: number,
    title: title || "Chapter " + number,
    volume: null,
    pages: 0,
    language: "ar"
  };
}

function chaptersFromDoc(doc) {
  const out = [];
  const seen = new Set();

  const selectors = [
    ".chapter-list a[href*='/manga/']",
    ".chapters a[href*='/manga/']",
    ".wp-manga-chapter a",
    "li.wp-manga-chapter a",
    "a[href*='/manga/'][href$='/1']",
    "a[href*='/manga/']"
  ];

  for (const sel of selectors) {
    for (const a of doc.querySelectorAll(sel)) {
      const c = chapterFromLink(a);
      if (!c || seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
    }
    if (out.length) return out;
  }
  return out;
}

const plugin = {
  id: "onma",
  name: "مانجا اون لاين",

  async popular(offset) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const paths = [
      "/manga/?m_orderby=views&page=" + page,
      "/manga/?orderby=views&page=" + page,
      "/manga/?page=" + page
    ];
    for (const path of paths) {
      try {
        const list = findCards(await getDoc(path));
        if (list.length) return list;
      } catch (_) {}
    }
    return findCards(await getDoc("/"));
  },

  async search(query, offset) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const paths = [
      "/manga/?s=" + encodeURIComponent(query) + "&post_type=wp-manga&page=" + page,
      "/?s=" + encodeURIComponent(query) + "&page=" + page,
      "/manga/?s=" + encodeURIComponent(query) + "&page=" + page
    ];
    for (const path of paths) {
      try {
        const list = findCards(await getDoc(path));
        if (list.length) return list;
      } catch (_) {}
    }
    return [];
  },

  async detail(id) {
    const doc = await getDoc("/manga/" + encodeURIComponent(id));
    const root = doc.querySelector(".site-content") || doc;
    return {
      id,
      title: clean(root.querySelector("h1")?.text()) || id,
      altTitle: firstText(root, [".alternative", ".other-name", ".post-content_item.manga_alternative .summary-content"]),
      cover: abs(firstAttr(root, [".summary_image", ".profile-manga", ".thumbnail", ".cover"], ["data-src", "data-lazy-src", "data-original", "src"])),
      author: firstText(root, [".author-content", ".author", ".post-content_item.manga-authors .summary-content", ".post-content_item.manga-author .summary-content"]),
      status: firstText(root, [".post-content_item.manga-status .summary-content", ".status", ".manga-status"]),
      description: firstText(root, [".description-summary", ".description", ".summary_content", ".summary__content"]),
      lastChapter: firstText(root, [".chapter-list a", ".chapters a", "li.wp-manga-chapter a"])
    };
  },

  async chapters(id) {
    const doc = await getDoc("/manga/" + encodeURIComponent(id));
    return chaptersFromDoc(doc);
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
    const selectors = [
      ".reading-content img",
      ".chapter-content img",
      ".reader-content img",
      ".page-content img",
      ".entry-content img",
      "img[data-src]",
      "img[data-lazy-src]"
    ];

    for (const sel of selectors) {
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
    for (const a of doc.querySelectorAll(".genres-content a, .genres a, .manga-genres a, a[href*='/genre/']")) {
      const name = clean(a.text());
      const href = a.attr("href") || "";
      const m = href.match(/\/genre\/([^/?#]+)/i);
      if (!name || !m || seen.has(m[1])) continue;
      seen.add(m[1]);
      out.push({ id: decodeURIComponent(m[1]), name, group: "Genre" });
    }
    return out;
  }
};

return plugin;
