// Harbor source for onma.me
const BASE = "https://onma.me";
const PAGE_SIZE = 48;
const CATALOG_PAGES = 15;

function clean(v) { return v ? String(v).replace(/\s+/g, " ").trim() : ""; }

function abs(url) {
  if (!url) return undefined;
  const u = String(url).trim();
  if (!u || u.startsWith("data:")) return undefined;
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith("//")) return "https:" + u;
  if (u.startsWith("/")) return BASE + u;
  return BASE + "/" + u;
}

function imageUrl(img) {
  if (!img) return undefined;
  for (const a of ["data-src", "data-lazy-src", "data-original", "data-url", "data-image", "src"]) {
    const v = img.attr(a);
    if (v) return abs(v);
  }
  return undefined;
}

async function getDoc(path, options) {
  const p = String(path).replace(/^https?:\/\/[^/]+/i, "");
  const res = await harbor.http(BASE + p, Object.assign({
    responseType: "text",
    timeoutMs: 30000,
    headers: { Referer: BASE + "/", "User-Agent": "Mozilla/5.0" }
  }, options || {}));
  if (!res.ok) throw new Error("http " + res.status + " for " + p);
  return harbor.parseHtml(res.body || "");
}

function mangaId(href) {
  if (!href) return null;
  const p = String(href).replace(/^https?:\/\/[^/]+/i, "");
  const m = p.match(/^\/manga\/([^/?#]+)\/?$/i);
  return m ? decodeURIComponent(m[1]) : null;
}

function card(el) {
  const a = el.querySelector("a[href^='/manga/'],a[href*='/manga/']");
  if (!a) return null;
  const id = mangaId(a.attr("href"));
  if (!id) return null;
  const img = a.querySelector("img") || el.querySelector("img");
  const title = clean(a.attr("title") || a.attr("aria-label") || img?.attr("alt") || el.querySelector("h1,h2,h3,h4,.title,.name,.post-title")?.text() || a.text());
  if (!title) return null;
  return { id, title, cover: imageUrl(img) };
}

function findCards(doc) {
  const out = [], seen = new Set();
  for (const sel of [".manga-list .item", ".manga-list li", ".manga-list article", ".manga-item", "article", ".item"]) {
    for (const el of doc.querySelectorAll(sel)) {
      const x = card(el);
      if (x && !seen.has(x.id)) { seen.add(x.id); out.push(x); }
    }
  }
  for (const a of doc.querySelectorAll("a[href^='/manga/']")) {
    const id = mangaId(a.attr("href"));
    if (!id || seen.has(id)) continue;
    const img = a.querySelector("img") || a.parentElement?.querySelector("img") || a.parentElement?.parentElement?.querySelector("img");
    const title = clean(a.attr("title") || a.attr("aria-label") || img?.attr("alt") || a.text());
    if (!title) continue;
    seen.add(id); out.push({ id, title, cover: imageUrl(img) });
  }
  return out;
}

function norm(s) {
  return clean(s).toLocaleLowerCase().replace(/[إأآ]/g, "ا").replace(/[ًٌٍَُِّْـ]/g, "");
}

function chapterNumber(text, href) {
  const s = clean(text) + " " + String(href || "");
  let m = s.match(/(?:chapter|ch\.?|الفصل|فصل|#)\s*#?\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (m) return m[1];
  const p = String(href || "").replace(/^https?:\/\/[^/]+/i, "");
  m = p.match(/^\/manga\/[^/]+\/([^/?#]+)/i);
  return m && /^[0-9]+(?:\.[0-9]+)?$/.test(m[1]) ? m[1] : null;
}

// A chapter is the numeric URL /manga/{slug}/{chapter}.
// Never store /2, /3, etc. as a separate chapter.
function chapterRoot(href) {
  const u = abs(href);
  if (!u) return null;
  const p = u.replace(/^https?:\/\/[^/]+/i, "");
  const m = p.match(/^(\/manga\/[^/]+\/[^/?#]+)(?:\/\d+)?\/?(?:[?#].*)?$/i);
  return m ? BASE + m[1] : null;
}

function chapterFromAnchor(a) {
  const raw = a.attr("href") || "";
  const id = chapterRoot(raw);
  const n = a.attr("data-number") || chapterNumber(a.text(), raw);
  if (!id || !n) return null;
  return { id, chapter: n, title: clean(a.text()) || "Chapter " + n, volume: null, pages: 0, language: "ar" };
}

function chaptersFromDoc(doc) {
  const out = [], seen = new Set();
  for (const sel of ["li.wp-manga-chapter a", ".wp-manga-chapter a", ".chapter-list a", ".chapters a", "a[href^='/manga/']"]) {
    for (const a of doc.querySelectorAll(sel)) {
      const c = chapterFromAnchor(a);
      if (!c || seen.has(c.id)) continue;
      seen.add(c.id); out.push(c);
    }
    if (out.length) return out;
  }
  return out;
}

function postId(doc) {
  for (const h of doc.querySelectorAll("[id^='manga-chapters-holder'],.manga-chapters-holder")) {
    const id = h.attr("data-id");
    if (id) return id;
  }
  return null;
}

async function chapterList(id) {
  const path = "/manga/" + encodeURIComponent(id) + "/";
  let doc = await getDoc(path);
  let list = chaptersFromDoc(doc);
  if (list.length) return list;

  const pid = postId(doc);
  if (pid) {
    try {
      const r = await harbor.http(BASE + "/wp-admin/admin-ajax.php", {
        method: "POST", responseType: "text", timeoutMs: 30000,
        headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8", "x-requested-with": "XMLHttpRequest", Referer: BASE + path },
        body: "action=manga_get_chapters&manga=" + encodeURIComponent(pid)
      });
      if (r.ok) {
        list = chaptersFromDoc(await harbor.parseHtml(r.body || ""));
        if (list.length) return list;
      }
    } catch (_) {}
  }
  return [];
}

async function catalog(page) { return findCards(await getDoc("/manga-list?page=" + page)); }

async function searchAll(query) {
  const q = norm(query), result = [], seen = new Set();
  for (let page = 1; page <= CATALOG_PAGES; page++) {
    let items = [];
    try { items = await catalog(page); } catch (_) { continue; }
    for (const x of items) {
      if (!seen.has(x.id) && norm(x.title).includes(q)) { seen.add(x.id); result.push(x); }
    }
  }
  return result;
}

function imageCandidates(doc) {
  const result = [], seen = new Set();
  for (const sel of [".reading-content img", ".chapter-content img", ".reader-content img", ".page-content img", ".page-break img", ".wp-manga-chapter-img img", ".entry-content img", "img[data-src]", "img[data-lazy-src]"]) {
    for (const img of doc.querySelectorAll(sel)) {
      const u = imageUrl(img);
      if (!u || seen.has(u) || /logo|avatar|favicon|icon/i.test(u)) continue;
      seen.add(u); result.push(u);
    }
    if (result.length) break;
  }
  return result;
}

function pageLinks(doc, root) {
  const base = root.replace(/^https?:\/\/[^/]+/i, "").replace(/\/$/, "");
  const out = [], seen = new Set();
  for (const a of doc.querySelectorAll("a[href]")) {
    const href = abs(a.attr("href"));
    if (!href) continue;
    const p = href.replace(/^https?:\/\/[^/]+/i, "").replace(/\/$/, "");
    if (p === base || (p.startsWith(base + "/") && /^\d+$/.test(p.slice(base.length + 1)))) {
      if (!seen.has(href)) { seen.add(href); out.push(href); }
    }
  }
  out.sort((a, b) => {
    const ma = a.match(/\/(\d+)\/?$/), mb = b.match(/\/(\d+)\/?$/);
    return Number(ma ? ma[1] : 1) - Number(mb ? mb[1] : 1);
  });
  if (!out.length) out.push(root);
  return out;
}

const plugin = {
  id: "onma",
  name: "مانجا اون لاين",

  async popular(offset) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    return catalog(Math.min(page, CATALOG_PAGES));
  },

  async search(query, offset) {
    const q = norm(query);
    if (!q) return this.popular(offset);
    const all = await searchAll(query);
    const start = Math.floor(offset / PAGE_SIZE) * PAGE_SIZE;
    return all.slice(start, start + PAGE_SIZE);
  },

  async detail(id) {
    const doc = await getDoc("/manga/" + encodeURIComponent(id) + "/");
    const root = doc.querySelector(".site-content") || doc;
    const h1 = root.querySelector("div.post-title h1") || root.querySelector("h1");
    const img = root.querySelector(".summary_image img") || root.querySelector(".profile-manga img") || root.querySelector(".tab-summary img");
    return {
      id,
      title: clean(h1?.text()) || id,
      cover: imageUrl(img),
      altTitle: clean(root.querySelector(".alternative")?.text()),
      author: clean(root.querySelector(".author-content")?.text()),
      status: clean(root.querySelector(".manga-status,.post-content_item.manga-status .summary-content")?.text()),
      description: clean(root.querySelector(".description-summary,.summary__content,.description")?.text()),
      lastChapter: clean(root.querySelector(".wp-manga-chapter a,.chapter-list a")?.text())
    };
  },

  async chapters(id) { return chapterList(id); },

  async pageUrls(chapterId) {
    const root = chapterRoot(chapterId);
    if (!root) return [];

    let doc;
    try { doc = await getDoc(root); } catch (_) { return []; }

    const urls = [], seen = new Set();
    const add = (d) => {
      for (const u of imageCandidates(d)) {
        if (!seen.has(u)) { seen.add(u); urls.push(u); }
      }
    };

    // Page 1 is the chapter root itself.
    add(doc);

    // If ONMA splits the chapter into /2, /3, ... fetch those pages too.
    for (const page of pageLinks(doc, root)) {
      if (page === root) continue;
      try { add(await getDoc(page)); } catch (_) {}
    }

    return urls;
  },

  async tags() {
    const doc = await getDoc("/manga-list");
    const out = [], seen = new Set();
    for (const a of doc.querySelectorAll("a[href*='/genre/']")) {
      const href = a.attr("href") || "", m = href.match(/\/genre\/([^/?#]+)/i), name = clean(a.text());
      if (!m || !name || seen.has(m[1])) continue;
      seen.add(m[1]); out.push({ id: decodeURIComponent(m[1]), name, group: "Genre" });
    }
    return out;
  }
};

return plugin;