// Arcomixverse source for Harbor
// Blogger series + chapter parser. Series pages do not expose the chapter list
// as normal HTML links, so chapters are discovered from Blogger search results.
const BASE = "https://arcomixverse.blogspot.com";
const PAGE_SIZE = 20;
const MAX_CHAPTER_SEARCH_PAGES = 30;

async function getUrl(url) {
  const res = await harbor.http(url, { responseType: "text" });
  if (!res.ok) throw new Error("http " + res.status + " for " + url);
  return harbor.parseHtml(res.body);
}

async function getDoc(path) {
  return getUrl(/^https?:\/\//i.test(path) ? path : BASE + path);
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

function postId(href) {
  const u = abs(href) || "";
  if (!u) return null;
  try {
    const x = new URL(u, BASE);
    if (x.hostname !== new URL(BASE).hostname) return null;
    const p = x.pathname.replace(/\/+/g, "/");
    if (!/\.html$/i.test(p)) return null;
    return p;
  } catch (_) { return null; }
}

function imageUrl(img) {
  if (!img) return undefined;
  const attrs = ["data-src","data-original","data-lazy-src","data-lazy","data-url","data-image","data-image-src","src"];
  for (const a of attrs) {
    const v = img.attr(a);
    if (v && !/^data:/i.test(v)) return abs(v);
  }
  const srcset = img.attr("srcset") || img.attr("data-srcset");
  if (srcset) return abs(srcset.split(",")[0].trim().split(/\s+/)[0]);
  return undefined;
}

function titleFrom(el, fallback) {
  if (!el) return fallback;
  const selectors = [".post-title a",".entry-title a",".post-title",".entry-title","h1 a","h2 a","h3 a","h4 a","h1","h2","h3","h4",".title a",".title"];
  for (const s of selectors) {
    const x = el.querySelector(s);
    const t = clean(x?.text());
    if (t) return t;
  }
  const a = el.querySelector("a[href]");
  return clean(a?.attr("title")) || clean(a?.text()) || fallback;
}

function chapterNumber(title) {
  const t = clean(title);
  const m = t.match(/(?:العدد|الفصل|chapter|ch\.?|issue)\s*#?\s*([0-9]+(?:\.[0-9]+)?)/i) || t.match(/#\s*([0-9]+(?:\.[0-9]+)?)/);
  return m ? m[1] : null;
}

function looksLikeChapter(title) {
  const t = clean(title);
  return !!chapterNumber(t) || /(?:العدد|الفصل|chapter|ch\.?|issue)\s*#?/i.test(t);
}

function makeSummary(el) {
  if (!el) return null;
  let a = el.querySelector(".post-title a[href],.entry-title a[href],h1 a[href],h2 a[href],h3 a[href],h4 a[href]");
  if (!a) for (const x of el.querySelectorAll("a[href]")) if (postId(x.attr("href"))) { a = x; break; }
  if (!a) return null;
  const id = postId(a.attr("href"));
  if (!id) return null;
  const title = titleFrom(el, clean(a.attr("title")) || clean(a.text()) || id);
  if (looksLikeChapter(title)) return null;
  return { id, title, cover: imageUrl(el.querySelector("img")) };
}

function summaries(doc, includeChapters) {
  const out = [], seen = new Set();
  const add = x => {
    if (!x || seen.has(x.id)) return;
    if (!includeChapters && looksLikeChapter(x.title)) return;
    seen.add(x.id); out.push(x);
  };

  // The current homepage has explicit "اقرأ السلسلة" cards. Prefer these.
  for (const a of doc.querySelectorAll("a[href]")) {
    const text = clean(a.text());
    if (!/اقرأ\s+السلسلة/i.test(text)) continue;
    const id = postId(a.attr("href"));
    if (!id) continue;
    const box = a.closest("article,.item,.post,.card,.series,.item-list,.blog-posts") || a.parentElement;
    add({ id, title: titleFrom(box, clean(a.attr("title")) || id), cover: imageUrl(box?.querySelector("img")) });
  }

  // Standard Blogger post cards.
  for (const selector of [".post",".post-outer",".post-outer-container",".blog-posts article","article",".post-item",".entry"]) {
    for (const el of doc.querySelectorAll(selector)) add(makeSummary(el));
    if (out.length >= PAGE_SIZE) break;
  }

  // Generic fallback. Only use post links whose visible title is not a chapter.
  if (!out.length) {
    for (const a of doc.querySelectorAll("a[href]")) {
      const id = postId(a.attr("href"));
      if (!id) continue;
      const parent = a.parentElement;
      const title = clean(a.attr("title")) || clean(a.text());
      if (!title || looksLikeChapter(title)) continue;
      add({ id, title, cover: imageUrl(parent?.querySelector("img")) });
    }
  }
  return out;
}

function chapterFromSummary(x, seriesTitle) {
  if (!x || !x.id) return null;
  const title = clean(x.title);
  const n = chapterNumber(title);
  if (!n) return null;
  if (seriesTitle) {
    const a = clean(seriesTitle).toLowerCase();
    const b = title.toLowerCase();
    // Require the series name to occur in the chapter title. This prevents
    // search results for other series with the same issue number.
    if (!b.includes(a)) return null;
  }
  return { id: x.id, chapter: n, title, volume: null, pages: 0, language: "ar" };
}

function searchPath(q, start) {
  return "/search?q=" + encodeURIComponent(q) + "&max-results=" + PAGE_SIZE + "&start=" + start;
}

async function discoverChapters(seriesTitle) {
  const result = [], seen = new Set();
  const q = clean(seriesTitle);
  if (!q) return result;

  // Search several pages because a series such as INVINCIBLE has 144 issues.
  for (let page = 0; page < MAX_CHAPTER_SEARCH_PAGES; page++) {
    const start = page * PAGE_SIZE;
    let found = [];
    try { found = summaries(await getDoc(searchPath(q, start)), true); } catch (_) { break; }
    let added = 0;
    for (const x of found) {
      const c = chapterFromSummary(x, q);
      if (c && !seen.has(c.id)) { seen.add(c.id); result.push(c); added++; }
    }
    // Once a search page stops returning posts, there is no more pagination.
    if (!found.length || (found.length < PAGE_SIZE && added === 0)) break;
  }

  result.sort((a,b) => {
    const na = parseFloat(a.chapter), nb = parseFloat(b.chapter);
    if (Number.isNaN(na)) return 1;
    if (Number.isNaN(nb)) return -1;
    return na - nb;
  });
  return result;
}

function extractUrlsFromText(text, result, seen) {
  if (!text) return;
  const re = /https?:\\/\\/[^\"'<>\\s]+/gi;
  for (const m of String(text).match(re) || []) {
    const u = m.replace(/[),;]+$/g, "");
    if (/\.(?:jpg|jpeg|png|webp|gif)(?:[?#].*)?$/i.test(u) && !seen.has(u)) {
      seen.add(u); result.push(u);
    }
  }
}

async function extractPages(doc) {
  const result = [], seen = new Set();
  const add = u => { u = abs(u); if (u && !seen.has(u) && !/^data:/i.test(u)) { seen.add(u); result.push(u); } };

  // Normal HTML images.
  for (const root of [doc.querySelector(".post-body"),doc.querySelector(".entry-content"),doc.querySelector(".post-content"),doc.querySelector("article"),doc]) {
    if (!root) continue;
    for (const img of root.querySelectorAll("img")) add(imageUrl(img));
    for (const a of root.querySelectorAll("a[href]")) {
      const u = abs(a.attr("href"));
      if (u && /\.(?:jpg|jpeg|png|webp|gif)(?:[?#].*)?$/i.test(u)) add(u);
    }
  }

  // The site uses an embedded reader. Harbor cannot execute that reader's JS,
  // but the iframe/script can still contain image URLs in static HTML.
  for (const frame of doc.querySelectorAll("iframe")) {
    const src = frame.attr("src") || frame.attr("data-src");
    if (!src) continue;
    try {
      const child = await getUrl(abs(src));
      for (const img of child.querySelectorAll("img")) add(imageUrl(img));
      for (const s of child.querySelectorAll("script")) extractUrlsFromText(s.text(), result, seen);
    } catch (_) {}
  }
  for (const s of doc.querySelectorAll("script")) extractUrlsFromText(s.text(), result, seen);
  return result;
}

const plugin = {
  id: "arcomixverse",
  name: "Arcomixverse",

  async popular(offset) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const seen = new Set(), all = [];
    const paths = [];
    if (page === 1) paths.push("/");
    paths.push("/search?max-results=" + PAGE_SIZE + "&start=" + ((page - 1) * PAGE_SIZE));
    for (const label of ["MARVEL","DC","IMAGE","Indie","BOOM","CROSSOVER","GHOST%20MACHINE"]) {
      if (page === 1) paths.push("/search/label/" + label + "?max-results=" + PAGE_SIZE);
    }
    for (const path of paths) {
      try {
        const xs = summaries(await getDoc(path), false);
        for (const x of xs) if (!seen.has(x.id)) { seen.add(x.id); all.push(x); }
      } catch (_) {}
      if (all.length >= PAGE_SIZE) break;
    }
    return all.slice(0, PAGE_SIZE);
  },

  async search(query, offset) {
    const q = clean(query);
    if (!q) return [];
    const start = Math.floor(offset / PAGE_SIZE) * PAGE_SIZE;
    const doc = await getDoc(searchPath(q, start));
    // Search should return series, not individual issue posts.
    return summaries(doc, false).slice(0, PAGE_SIZE);
  },

  async detail(id) {
    const doc = await getDoc(id);
    const title = clean(doc.querySelector("h1.post-title,h1.entry-title,h1")?.text()) || id;
    const img = doc.querySelector(".post-body img,.entry-content img,article img,.post img,img");
    const body = doc.querySelector(".post-body,.entry-content,article .post-body");
    return { id, title, cover: imageUrl(img), description: clean(body?.text()) };
  },

  async chapters(id) {
    const doc = await getDoc(id);
    const seriesTitle = clean(doc.querySelector("h1.post-title,h1.entry-title,h1")?.text()) || clean(id);
    const found = await discoverChapters(seriesTitle);
    if (found.length) return found;

    // Fallback to links on the detail page if the theme exposes them.
    const result = [], seen = new Set();
    for (const a of doc.querySelectorAll("a[href]")) {
      const c = chapterFromSummary({ id: postId(a.attr("href")), title: clean(a.text()) || clean(a.attr("title")) }, seriesTitle);
      if (c && !seen.has(c.id)) { seen.add(c.id); result.push(c); }
    }
    return result;
  },

  async pageUrls(chapterId) {
    return await extractPages(await getDoc(chapterId));
  }
};

return plugin;