// Harbor source for onma.me
const BASE = "https://onma.me";
const PAGE_SIZE = 18;

function clean(text) { return text ? String(text).replace(/\s+/g, " ").trim() : ""; }
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
  return abs(img.attr("data-src") || img.attr("data-lazy-src") || img.attr("data-original") || img.attr("data-url") || img.attr("data-image") || img.attr("src"));
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
function nearestImage(el) {
  let cur = el;
  for (let i = 0; i < 5 && cur; i++) {
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
      a.attr("title") || a.attr("aria-label") || img?.attr("alt") ||
      el.querySelector("h1,h2,h3,h4,.title,.name,.post-title")?.text() || a.text()
    );
    if (title) return { id, title, cover: imageUrl(img) || nearestImage(a) };
  }
  return null;
}
function findCards(doc) {
  const out = [], seen = new Set();
  for (const sel of [".manga-list .item", ".manga-list li", ".manga-list article", ".row .item", "article", ".manga-item", ".item"]) {
    for (const el of doc.querySelectorAll(sel)) {
      const x = cardToSummary(el);
      if (x && !seen.has(x.id)) { seen.add(x.id); out.push(x); }
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
function chapterNumber(text, href) {
  let m = String(href || "").match(/\/manga\/[^/]+\/([0-9]+(?:\.[0-9]+)?)\/?(?:[?#].*)?$/i);
  if (m) return m[1];
  const s = clean(text) || String(href || "");
  m = s.match(/(?:chapter|ch\.?|الفصل|فصل|#)\s*#?\s*([0-9]+(?:\.[0-9]+)?)/i) || s.match(/([0-9]+(?:\.[0-9]+)?)/);
  return m ? m[1] : null;
}
function chapterFromLink(a) {
  const href = abs(a.attr("href") || "");
  if (!href) return null;
  const n = a.attr("data-number") || chapterNumber(a.text(), href);
  if (!n) return null;
  return { id: href, chapter: n, title: clean(a.text()) || "Chapter " + n, volume: null, pages: 0, language: "ar" };
}
function chaptersFromDoc(doc) {
  const out = [], seen = new Set();
  for (const sel of ["li.wp-manga-chapter a", ".wp-manga-chapter a", ".chapter-list a", ".chapters a", "a[href*='/manga/']"]) {
    for (const a of doc.querySelectorAll(sel)) {
      const c = chapterFromLink(a);
      if (c && !seen.has(c.id)) { seen.add(c.id); out.push(c); }
    }
    if (out.length) return out;
  }
  return out;
}
function formEncode(obj) {
  return Object.keys(obj).filter(k => obj[k] !== undefined && obj[k] !== null).map(k => encodeURIComponent(k) + "=" + encodeURIComponent(String(obj[k]))).join("&");
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
        method: "POST", responseType: "text", timeoutMs: 30000,
        headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8", "x-requested-with": "XMLHttpRequest", Referer: BASE + mangaPath },
        body: formEncode({ action: "manga_get_chapters", manga: pid })
      });
      if (r.ok) { list = chaptersFromDoc(await harbor.parseHtml(r.body || "")); if (list.length) return list; }
    } catch (_) {}
  }
  try {
    const r = await harbor.http(BASE + mangaPath.replace(/\/$/, "") + "/ajax/chapters/", {
      method: "POST", responseType: "text", timeoutMs: 30000,
      headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8", "x-requested-with": "XMLHttpRequest", Referer: BASE + mangaPath },
      body: ""
    });
    if (r.ok) { list = chaptersFromDoc(await harbor.parseHtml(r.body || "")); if (list.length) return list; }
  } catch (_) {}
  return [];
}
async function catalogPage(page) {
  return findCards(await getDoc("/manga-list?page=" + page));
}

// Submit ONMA's actual advanced-search form. This discovers the form action,
// method and field names from the site instead of guessing a search URL.
async function nativeSearch(query, page) {
  const doc = await getDoc("/advanced-search");
  const form = doc.querySelector("form");
  if (!form) return [];

  const action = abs(form.attr("action") || "/advanced-search");
  const method = String(form.attr("method") || "get").toLowerCase();
  const params = {};
  let queryField = null;

  for (const input of form.querySelectorAll("input")) {
    const name = input.attr("name");
    if (!name) continue;
    const type = String(input.attr("type") || "text").toLowerCase();
    const id = String(input.attr("id") || "").toLowerCase();
    const ph = String(input.attr("placeholder") || "").toLowerCase();
    const key = name.toLowerCase();
    if (type === "hidden") {
      const value = input.attr("value");
      if (value !== undefined) params[name] = value;
      continue;
    }
    if (type !== "text" && type !== "search") continue;
    const looksLikeQuery = /search|query|keyword|title|name|manga|اسم|عنوان|بحث/.test(key + " " + id + " " + ph);
    const looksLikeAuthorYear = /author|writer|year|سنة|مؤلف/.test(key + " " + id + " " + ph);
    if (!queryField && looksLikeQuery && !looksLikeAuthorYear) queryField = name;
  }

  if (!queryField) {
    for (const input of form.querySelectorAll("input")) {
      const name = input.attr("name");
      const type = String(input.attr("type") || "text").toLowerCase();
      if (name && (type === "text" || type === "search")) { queryField = name; break; }
    }
  }
  if (!queryField) return [];
  params[queryField] = query;
  params.page = page;

  for (const select of form.querySelectorAll("select")) {
    const name = select.attr("name");
    if (!name) continue;
    const selected = select.querySelector("option[selected]");
    if (selected) {
      const value = selected.attr("value");
      if (value !== undefined && value !== "") params[name] = value;
    }
  }

  let resultDoc;
  try {
    if (method === "post") {
      const r = await harbor.http(action, {
        method: "POST", responseType: "text", timeoutMs: 30000,
        headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8", Referer: BASE + "/advanced-search" },
        body: formEncode(params)
      });
      if (!r.ok) return [];
      resultDoc = await harbor.parseHtml(r.body || "");
    } else {
      const sep = action.includes("?") ? "&" : "?";
      const r = await harbor.http(action + sep + formEncode(params), { responseType: "text", timeoutMs: 30000, headers: { Referer: BASE + "/advanced-search" } });
      if (!r.ok) return [];
      resultDoc = await harbor.parseHtml(r.body || "");
    }
  } catch (_) {
    return [];
  }

  const wanted = normalizeQuery(query);
  return findCards(resultDoc).filter(x => normalizeQuery(x.title).includes(wanted));
}

const plugin = {
  id: "onma",
  name: "مانجا اون لاين",

  async popular(offset) {
    return catalogPage(Math.floor(offset / PAGE_SIZE) + 1);
  },

  async search(query, offset) {
    const wanted = normalizeQuery(query);
    if (!wanted) return this.popular(offset);
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    return nativeSearch(query, page);
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

  async chapters(id) { return chapterList(id); },

  async pageUrls(chapterId) {
    const path = "/" + String(chapterId).replace(/^https?:\/\/[^/]+/i, "").replace(/^\//, "");
    const r = await harbor.http(BASE + path, { responseType: "text", timeoutMs: 30000, headers: { Referer: BASE + "/" } });
    if (!r.ok) throw new Error("http " + r.status + " for " + path);
    const doc = await harbor.parseHtml(r.body || ""), urls = [], seen = new Set();
    for (const sel of [".reading-content .page-break img", ".reading-content img", ".chapter-content img", ".reader-content img", ".page-content img", ".page-break img", ".wp-manga-chapter-img img", ".entry-content img"]) {
      for (const img of doc.querySelectorAll(sel)) {
        const u = imageUrl(img);
        if (u && !seen.has(u)) { seen.add(u); urls.push(u); }
      }
      if (urls.length) break;
    }
    return urls;
  },

  async tags() {
    const doc = await getDoc("/manga-list"), out = [], seen = new Set();
    for (const a of doc.querySelectorAll("a[href*='/category/'],.genres-content a,.genres a,.manga-genres a,a[href*='/genre/']")) {
      const name = clean(a.text()), href = a.attr("href") || "";
      const m = href.match(/\/category\/([^/?#]+)/i) || href.match(/\/genre\/([^/?#]+)/i);
      if (name && m && !seen.has(m[1])) { seen.add(m[1]); out.push({ id: decodeURIComponent(m[1]), name, group: "Genre" }); }
    }
    return out;
  }
};

return plugin;