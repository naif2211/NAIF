// StellarSaber source for Harbor
// WordPress/Madara-style manga site.
const BASE = "https://stellarsaber.pro";
const PAGE_SIZE = 20;

async function getDoc(path) {
  const url = /^https?:\/\//i.test(path) ? path : BASE + path;
  const res = await harbor.http(url, { responseType: "text" });
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
  return harbor.parseHtml(res.body);
}

function abs(url) {
  if (!url) return undefined;
  url = String(url).trim();
  if (!url || /^data:/i.test(url)) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return BASE + url;
  return BASE + "/" + url;
}

function clean(v) { return v ? String(v).replace(/\s+/g, " ").trim() : ""; }

function mangaId(href) {
  const u = abs(href);
  if (!u) return null;
  try {
    const x = new URL(u, BASE);
    if (x.hostname !== new URL(BASE).hostname) return null;
    const p = x.pathname.replace(/\/+/g, "/");
    const m = p.match(/^\/manga\/([^/]+)\/?$/i);
    return m ? "/manga/" + m[1] + "/" : null;
  } catch (_) { return null; }
}

function chapterId(href) {
  const u = abs(href);
  if (!u) return null;
  try {
    const x = new URL(u, BASE);
    if (x.hostname !== new URL(BASE).hostname) return null;
    const p = x.pathname.replace(/\/+/g, "/");
    if (/^\/chapter\//i.test(p)) return p;
    // Older StellarSaber chapter URLs are also used by the site.
    if (/الفصل|chapter|ch[-_]?/i.test(p) && !/^\/manga\//i.test(p)) return p;
    return null;
  } catch (_) { return null; }
}

function imageUrl(img) {
  if (!img) return undefined;
  for (const a of ["data-src","data-original","data-lazy-src","data-lazy","src"]) {
    const v = img.attr(a);
    if (v && !/^data:/i.test(v)) return abs(v);
  }
  const ss = img.attr("srcset") || img.attr("data-srcset");
  if (ss) return abs(ss.split(",")[0].trim().split(/\s+/)[0]);
  return undefined;
}

function titleOf(el, fallback) {
  if (!el) return fallback;
  for (const s of [".post-title a",".entry-title a",".post-title",".entry-title",".manga-title a",".manga-title","h1 a","h1","h2 a","h2","h3 a","h3"]) {
    const n = el.querySelector(s);
    const t = clean(n?.text());
    if (t) return t;
  }
  return fallback;
}

function card(el) {
  if (!el) return null;
  let a = el.querySelector("a[href*='/manga/']");
  if (!a) return null;
  const id = mangaId(a.attr("href"));
  if (!id) return null;
  const title = titleOf(el, clean(a.attr("title")) || clean(a.text()) || id);
  const img = el.querySelector("img");
  return { id, title, cover: imageUrl(img) };
}

function mangaList(doc) {
  const out = [], seen = new Set();
  const add = x => { if (x && !seen.has(x.id)) { seen.add(x.id); out.push(x); } };
  for (const s of [
    ".c-tabs-item__content", ".page-item-detail.manga", ".item-summary", ".row.c-tabs-item__content",
    ".tab-summary", ".page-item-detail", ".manga-item", ".manga", "article"
  ]) for (const el of doc.querySelectorAll(s)) add(card(el));
  if (!out.length) {
    for (const a of doc.querySelectorAll("a[href*='/manga/']")) {
      const id = mangaId(a.attr("href"));
      if (!id || seen.has(id)) continue;
      const box = a.closest("article,.page-item-detail,.item-summary,.manga-item,.manga") || a.parentElement;
      add({ id, title: clean(a.attr("title")) || clean(a.text()) || titleOf(box, id), cover: imageUrl(box?.querySelector("img")) });
    }
  }
  return out;
}

function chapterNumber(text) {
  const t = clean(text);
  const m = t.match(/(?:chapter|ch\.?|الفصل|العدد)\s*#?\s*([0-9]+(?:\.[0-9]+)?)/i) || t.match(/#\s*([0-9]+(?:\.[0-9]+)?)/);
  return m ? m[1] : null;
}

function chaptersFromDoc(doc) {
  const out = [], seen = new Set();
  for (const a of doc.querySelectorAll("a[href]")) {
    const id = chapterId(a.attr("href"));
    if (!id || seen.has(id)) continue;
    const title = clean(a.text()) || clean(a.attr("title")) || id;
    const n = chapterNumber(title) || chapterNumber(id);
    // Keep chapter links even when the site's visible text is just a number.
    if (!n && !/\/chapter\//i.test(id)) continue;
    seen.add(id);
    out.push({ id, chapter: n || title.replace(/^.*?\/(?:chapter\/)?/i, ""), title, volume: null, pages: 0, language: "ar" });
  }
  out.sort((a,b) => {
    const na = parseFloat(a.chapter), nb = parseFloat(b.chapter);
    if (Number.isNaN(na)) return 1;
    if (Number.isNaN(nb)) return -1;
    return nb - na;
  });
  return out;
}

function imageFromAnchor(a) {
  const href = a?.attr("href");
  return /\.(?:jpg|jpeg|png|webp|gif)(?:[?#].*)?$/i.test(href || "") ? abs(href) : undefined;
}

async function pageUrls(doc) {
  const out = [], seen = new Set();
  const add = u => { u = abs(u); if (u && !seen.has(u) && !/^data:/i.test(u)) { seen.add(u); out.push(u); } };
  const roots = [
    doc.querySelector(".reading-content"),
    doc.querySelector(".reading-content-wrap"),
    doc.querySelector(".chapter-content"),
    doc.querySelector(".c-page__content"),
    doc.querySelector(".entry-content"),
    doc.querySelector(".post-content"),
    doc.querySelector("article"),
    doc
  ];
  for (const root of roots) {
    if (!root) continue;
    for (const img of root.querySelectorAll("img")) add(imageUrl(img));
    for (const a of root.querySelectorAll("a[href]")) add(imageFromAnchor(a));
  }
  return out;
}

const plugin = {
  id: "stellarsaber",
  name: "StellarSaber",

  async popular(offset) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const paths = [
      page === 1 ? "/" : "/page/" + page + "/",
      "/manga/?status=ongoing&page=" + page,
      "/manga/?page=" + page
    ];
    for (const p of paths) {
      try {
        const r = mangaList(await getDoc(p));
        if (r.length) return r.slice(0, PAGE_SIZE);
      } catch (_) {}
    }
    return [];
  },

  async search(query, offset) {
    const q = clean(query);
    if (!q) return [];
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const paths = [
      "/?s=" + encodeURIComponent(q) + "&post_type=wp-manga",
      "/page/" + page + "/?s=" + encodeURIComponent(q) + "&post_type=wp-manga",
      "/?s=" + encodeURIComponent(q)
    ];
    for (const p of paths) {
      try {
        const r = mangaList(await getDoc(p));
        if (r.length) return r.slice(0, PAGE_SIZE);
      } catch (_) {}
    }
    return [];
  },

  async detail(id) {
    const doc = await getDoc(id);
    const title = clean(doc.querySelector(".post-title h1,.post-title,h1.entry-title,h1")?.text()) || titleOf(doc, id);
    const cover = imageUrl(doc.querySelector(".summary_image img,.summary_image a img,.manga-thumb img,.summary_content img,img"));
    const desc = clean(doc.querySelector(".summary__content,.description-summary,.summary_content,.post-content,.entry-content")?.text());
    return { id, title, cover, description: desc };
  },

  async chapters(id) {
    const doc = await getDoc(id);
    let result = chaptersFromDoc(doc);
    // If the manga page is paginated, follow its chapter pagination links.
    const pages = [];
    for (const a of doc.querySelectorAll("a[href]")) {
      const href = abs(a.attr("href"));
      if (href && /\/manga\/[^/]+\/(?:page|\?)/i.test(href)) pages.push(href);
    }
    const seenPages = new Set();
    for (const p of pages) {
      if (seenPages.has(p)) continue;
      seenPages.add(p);
      try { result = result.concat(chaptersFromDoc(await getDoc(p))); } catch (_) {}
    }
    const seen = new Set();
    result = result.filter(x => !seen.has(x.id) && seen.add(x.id));
    result.sort((a,b) => {
      const na = parseFloat(a.chapter), nb = parseFloat(b.chapter);
      if (Number.isNaN(na)) return 1;
      if (Number.isNaN(nb)) return -1;
      return nb - na;
    });
    return result;
  },

  async pageUrls(chapterId) {
    return await pageUrls(await getDoc(chapterId));
  }
};

return plugin;