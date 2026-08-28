// Harbor source for onma.me (rebuilt)
const BASE = "https://onma.me";
const PAGE_SIZE = 48;
const CATALOG_PAGES = 15;

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

function imageUrl(img) {
  if (!img) return undefined;
  return abs(
    img.attr("data-src") ||
    img.attr("data-lazy-src") ||
    img.attr("data-original") ||
    img.attr("data-url") ||
    img.attr("data-image") ||
    img.attr("src")
  );
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
  for (const s of selectors) {
    const x = el?.querySelector(s);
    const t = clean(x?.text());
    if (t) return t;
  }
  return undefined;
}

function firstAttr(el, selectors, attrs) {
  for (const s of selectors) {
    const x = el?.querySelector(s);
    if (!x) continue;
    for (const a of attrs) {
      const v = x.attr(a);
      if (v) return v;
    }
  }
  return undefined;
}

function nearestImage(el) {
  let cur = el;
  for (let i = 0; i < 6 && cur; i++) {
    const img = cur.querySelector("img");
    if (img) return imageUrl(img);
    cur = cur.parentElement;
  }
  return undefined;
}

function cardToSummary(el) {
  for (const a of el.querySelectorAll("a[href^='/manga/'],a[href*='/manga/']")) {
    const id = mangaIdFromHref(a.attr("href") || "");
    if (!id) continue;
    const img = a.querySelector("img") || el.querySelector("img");
    const title = clean(
      a.attr("title") ||
      a.attr("aria-label") ||
      img?.attr("alt") ||
      el.querySelector("h1,h2,h3,h4,.title,.name,.post-title")?.text() ||
      a.text()
    );
    if (title) return { id, title, cover: imageUrl(img) || nearestImage(a) };
  }
  return null;
}

function findCards(doc) {
  const out = [];
  const seen = new Set();

  for (const sel of [
    ".manga-list .item",
    ".manga-list li",
    ".manga-list article",
    ".row .item",
    ".manga-item",
    "article",
    ".item"
  ]) {
    for (const el of doc.querySelectorAll(sel)) {
      const x = cardToSummary(el);
      if (x && !seen.has(x.id)) {
        seen.add(x.id);
        out.push(x);
      }
    }
  }

  for (const a of doc.querySelectorAll("a[href^='/manga/'],a[href*='/manga/']")) {
    const id = mangaIdFromHref(a.attr("href") || "");
    if (!id || seen.has(id)) continue;
    const img = a.querySelector("img") || a.parentElement?.querySelector("img") || a.parentElement?.parentElement?.querySelector("img");
    const title = clean(a.attr("title") || a.attr("aria-label") || img?.attr("alt") || a.text());
    if (!title) continue;
    seen.add(id);
    out.push({ id, title, cover: imageUrl(img) || nearestImage(a) });
  }
  return out;
}

function normalizeQuery(s) {
  return clean(s).toLocaleLowerCase()
    .replace(/[إأآ]/g, "ا")
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/\s+/g, " ");
}

function chapterNumber(text, href) {
  const u = String(href || "").replace(/^https?:\/\/[^/]+/i, "");
  let m = u.match(/^\/manga\/[^/]+\/([^/?#]+)(?:\/\d+)?\/?$/i);
  if (m && /\d/.test(m[1])) return m[1];
  const s = clean(text) || u;
  m = s.match(/(?:chapter|ch\.?|الفصل|فصل|#)\s*#?\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (!m) m = s.match(/([0-9]+(?:\.[0-9]+)?)/);
  return m ? m[1] : null;
}

// ONMA uses /manga/{slug}/{chapter} for the first page and
// /manga/{slug}/{chapter}/{page} for subsequent pages. Keep the chapter
// root as the Harbor chapter id so reading never starts at a random page.
function normalizeChapterHref(href) {
  const u = abs(href || "");
  if (!u) return null;
  const path = u.replace(/^https?:\/\/[^/]+/i, "");
  const m = path.match(/^(\/manga\/[^/]+\/[^/?#]+)(?:\/\d+)?\/?(?:[?#].*)?$/i);
  return m ? BASE + m[1] : u;
}

function chapterFromLink(a) {
  const raw = a.attr("href") || "";
  const id = normalizeChapterHref(raw);
  if (!id) return null;
  const n = a.attr("data-number") || chapterNumber(a.text(), raw);
  if (!n) return null;
  return {
    id,
    chapter: n,
    title: clean(a.text()) || "Chapter " + n,
    volume: null,
    pages: 0,
    language: "ar"
  };
}

function chaptersFromDoc(doc) {
  const out = [];
  const seen = new Set();
  for (const sel of [
    "li.wp-manga-chapter a",
    ".wp-manga-chapter a",
    ".chapter-list a",
    ".chapters a"
  ]) {
    for (const a of doc.querySelectorAll(sel)) {
      const c = chapterFromLink(a);
      if (!c || seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
    }
    if (out.length) return out;
  }

  // Last fallback: only accept links that clearly contain a chapter segment.
  for (const a of doc.querySelectorAll("a[href*='/manga/']")) {
    const href = a.attr("href") || "";
    if (!/\/manga\/[^/]+\/[^/?#]+/i.test(href)) continue;
    const c = chapterFromLink(a);
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

function formEncode(obj) {
  return Object.keys(obj)
    .filter(k => obj[k] !== undefined && obj[k] !== null)
    .map(k => encodeURIComponent(k) + "=" + encodeURIComponent(String(obj[k])))
    .join("&");
}

function postId(doc) {
  for (const h of doc.querySelectorAll("div[id^='manga-chapters-holder'],.manga-chapters-holder")) {
    const id = h.attr("data-id");
    if (id) return id;
  }
  return null;
}

async function chapterList(id) {
  const mangaPath = "/manga/" + encodeURIComponent(id) + "/";
  let doc = await getDoc(mangaPath);
  let list = chaptersFromDoc(doc);
  if (list.length) return list;

  const pid = postId(doc);
  if (pid) {
    try {
      const r = await harbor.http(BASE + "/wp-admin/admin-ajax.php", {
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
      if (r.ok) {
        list = chaptersFromDoc(await harbor.parseHtml(r.body || ""));
        if (list.length) return list;
      }
    } catch (_) {}
  }

  try {
    const r = await harbor.http(BASE + mangaPath.replace(/\/$/, "") + "/ajax/chapters/", {
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
    if (r.ok) {
      list = chaptersFromDoc(await harbor.parseHtml(r.body || ""));
      if (list.length) return list;
    }
  } catch (_) {}

  return [];
}

async function catalogPage(page) {
  return findCards(await getDoc("/manga-list?page=" + page));
}

// ONMA's catalogue is paginated at /manga-list. Search is implemented as a
// real catalogue-wide lookup: it searches the site's complete manga index,
// not the currently visible home page. This also works when ONMA changes its
// advanced-search form fields.
async function searchCatalogue(query) {
  const wanted = normalizeQuery(query);
  const all = [];
  const seen = new Set();

  for (let page = 1; page <= CATALOG_PAGES; page++) {
    let items = [];
    try { items = await catalogPage(page); } catch (_) { continue; }
    for (const item of items) {
      const title = normalizeQuery(item.title);
      if (!title || !title.includes(wanted) || seen.has(item.id)) continue;
      seen.add(item.id);
      all.push(item);
    }
  }
  return all;
}

function pageLinksForChapter(doc, chapterId) {
  const root = String(chapterId).replace(/^https?:\/\/[^/]+/i, "").replace(/\/$/, "");
  const out = [];
  const seen = new Set();

  for (const a of doc.querySelectorAll("a[href*='/manga/']")) {
    const href = abs(a.attr("href") || "");
    if (!href) continue;
    const path = href.replace(/^https?:\/\/[^/]+/i, "").replace(/\/$/, "");
    if (path === root || path.startsWith(root + "/")) {
      const m = path.match(new RegExp("^" + root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?:/(\\d+))?$"));
      if (!m) continue;
      if (!seen.has(href)) {
        seen.add(href);
        out.push(href);
      }
    }
  }

  // Always include the chapter root first. ONMA's root is page 1.
  const base = BASE + root;
  if (!seen.has(base)) out.unshift(base);
  else out.sort((a, b) => {
    const na = Number((a.match(/\/(\d+)$/) || [0, 1])[1]);
    const nb = Number((b.match(/\/(\d+)$/) || [0, 1])[1]);
    return na - nb;
  });
  return out;
}

async function imagesFromPage(path) {
  const cleanPath = String(path).replace(/^https?:\/\/[^/]+/i, "");
  const doc = await getDoc(cleanPath);
  const urls = [];
  const seen = new Set();
  for (const sel of [
    ".reading-content .page-break img",
    ".reading-content img",
    ".chapter-content img",
    ".reader-content img",
    ".page-content img",
    ".page-break img",
    ".wp-manga-chapter-img img",
    ".entry-content img"
  ]) {
    for (const img of doc.querySelectorAll(sel)) {
      const u = imageUrl(img);
      if (u && !seen.has(u)) {
        seen.add(u);
        urls.push(u);
      }
    }
    if (urls.length) break;
  }
  return urls;
}

const plugin = {
  id: "onma",
  name: "مانجا اون لاين",

  async popular(offset) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    return catalogPage(Math.min(page, CATALOG_PAGES));
  },

  async search(query, offset) {
    const wanted = normalizeQuery(query);
    if (!wanted) return this.popular(offset);

    const all = await searchCatalogue(query);
    const start = Math.floor(offset / PAGE_SIZE) * PAGE_SIZE;
    return all.slice(start, start + PAGE_SIZE);
  },

  async detail(id) {
    const doc = await getDoc("/manga/" + encodeURIComponent(id) + "/");
    const root = doc.querySelector(".site-content") || doc;
    return {
      id,
      title: clean(root.querySelector("div.post-title h1")?.text()) || clean(root.querySelector("h1")?.text()) || id,
      altTitle: firstText(root, [".alternative", ".other-name", ".post-content_item.manga_alternative .summary-content"]),
      cover: abs(firstAttr(root, [".summary_image", ".profile-manga", ".tab-summary .summary_image", ".thumbnail", ".cover"], ["data-src", "data-lazy-src", "data-original", "data-url", "src"])),
      author: firstText(root, [".author-content", ".author", ".post-content_item.manga-authors .summary-content", ".post-content_item.manga-author .summary-content"]),
      status: firstText(root, [".post-content_item.manga-status .summary-content", ".post-content_item.manga_status .summary-content", ".status", ".manga-status"]),
      description: firstText(root, [".summary__content", ".description-summary .summary__content", ".description-summary", ".description", ".summary_content"]),
      lastChapter: firstText(root, [".wp-manga-chapter a", "li.wp-manga-chapter a", ".chapter-list a", ".chapters a"])
    };
  },

  async chapters(id) {
    return chapterList(id);
  },

  async pageUrls(chapterId) {
    const root = normalizeChapterHref(chapterId);
    if (!root) return [];

    let firstDoc;
    try {
      firstDoc = await getDoc(root.replace(BASE, ""));
    } catch (_) {
      return [];
    }

    const pages = pageLinksForChapter(firstDoc, root);
    const urls = [];
    const seen = new Set();

    for (const page of pages) {
      try {
        const imgs = await imagesFromPage(page);
        for (const u of imgs) {
          if (!seen.has(u)) {
            seen.add(u);
            urls.push(u);
          }
        }
      } catch (_) {}
    }

    return urls;
  },

  async tags() {
    const doc = await getDoc("/manga-list"), out = [], seen = new Set();
    for (const a of doc.querySelectorAll("a[href*='/category/'],.genres-content a,.genres a,.manga-genres a,a[href*='/genre/']")) {
      const name = clean(a.text());
      const href = a.attr("href") || "";
      const m = href.match(/\/category\/([^/?#]+)/i) || href.match(/\/genre\/([^/?#]+)/i);
      if (name && m && !seen.has(m[1])) {
        seen.add(m[1]);
        out.push({ id: decodeURIComponent(m[1]), name, group: "Genre" });
      }
    }
    return out;
  }
};

return plugin;