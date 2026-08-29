// Arcomixverse source for Harbor
// Robust Blogger parser: handles post cards, labels, lazy-loaded images,
// chapter links and Blogger pagination without requiring JavaScript.
const BASE = "https://arcomixverse.blogspot.com";
const PAGE_SIZE = 20;

async function getDoc(path) {
  const res = await harbor.http(BASE + path, { responseType: "text" });
  if (!res.ok) throw new Error("http " + res.status + " for " + path);
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

function postId(href) {
  const u = abs(href) || "";
  if (!u) return null;
  try {
    const x = new URL(u, BASE);
    if (x.hostname !== new URL(BASE).hostname) return null;
    const p = x.pathname.replace(/\/+/g, "/");
    if (!/\.html$/i.test(p)) return null;
    return p + (x.search || "");
  } catch (_) { return null; }
}

function imageUrl(img) {
  if (!img) return undefined;
  const attrs = [
    "data-src", "data-original", "data-lazy-src", "data-lazy", "data-url",
    "data-image", "data-image-src", "data-filename", "src"
  ];
  for (const a of attrs) {
    const v = img.attr(a);
    if (v && !/^data:/i.test(v)) return abs(v);
  }
  const srcset = img.attr("srcset") || img.attr("data-srcset");
  if (srcset) {
    const first = srcset.split(",")[0].trim().split(/\s+/)[0];
    return abs(first);
  }
  return undefined;
}

function titleFrom(el, fallback) {
  const selectors = [
    ".post-title a", ".entry-title a", ".post-title", ".entry-title",
    "h1 a", "h2 a", "h3 a", "h4 a", "h1", "h2", "h3", "h4",
    ".title a", ".title"
  ];
  for (const s of selectors) {
    const x = el.querySelector(s);
    const t = clean(x?.text());
    if (t) return t;
  }
  const a = el.querySelector("a[href]");
  return clean(a?.attr("title")) || clean(a?.text()) || fallback;
}

function isPostUrl(href) { return !!postId(href); }

function makeSummary(el) {
  if (!el) return null;
  let a = el.querySelector(".post-title a[href], .entry-title a[href], h1 a[href], h2 a[href], h3 a[href], h4 a[href]");
  if (!a) {
    for (const x of el.querySelectorAll("a[href]")) {
      if (isPostUrl(x.attr("href"))) { a = x; break; }
    }
  }
  if (!a) return null;
  const id = postId(a.attr("href"));
  if (!id) return null;
  return { id, title: titleFrom(el, clean(a.attr("title")) || id), cover: imageUrl(el.querySelector("img")) };
}

function summaries(doc) {
  const out = [], seen = new Set();
  const selectors = [
    ".post", ".post-outer", ".post-outer-container", ".blog-posts .post",
    ".blog-posts article", "article", ".post-item", ".blog-post", ".entry"
  ];
  for (const selector of selectors) {
    for (const el of doc.querySelectorAll(selector)) {
      const x = makeSummary(el);
      if (x && !seen.has(x.id)) { seen.add(x.id); out.push(x); }
    }
    if (out.length >= PAGE_SIZE) break;
  }
  if (!out.length) {
    for (const a of doc.querySelectorAll("a[href]")) {
      const id = postId(a.attr("href"));
      if (!id || seen.has(id)) continue;
      const parent = a.closest("article,.post,.post-outer,.post-item,.entry") || a.parentElement;
      const x = makeSummary(parent) || { id, title: clean(a.attr("title")) || clean(a.text()) || id, cover: imageUrl(parent?.querySelector("img")) };
      if (!seen.has(id)) { seen.add(id); out.push(x); }
    }
  }
  return out;
}

function chapterFrom(a) {
  const id = postId(a.attr("href"));
  if (!id) return null;
  const title = clean(a.text()) || clean(a.attr("title")) || clean(a.attr("aria-label"));
  if (!title) return null;
  const n = (title.match(/(?:chapter|chap(?:ter)?|ch\.?|issue|#|العدد|الفصل|ش\.?|ح\.?)\s*#?\s*([0-9]+(?:\.[0-9]+)?)/i) || [])[1];
  if (!n && !/(?:chapter|ch\.?|issue|الفصل|العدد)/i.test(title)) return null;
  return { id, chapter: n || null, title, volume: null, pages: 0, language: "ar" };
}

function uniqueChapters(doc, currentId) {
  const result = [], seen = new Set();
  for (const a of doc.querySelectorAll("a[href]")) {
    const c = chapterFrom(a);
    if (c && c.id !== currentId && !seen.has(c.id)) { seen.add(c.id); result.push(c); }
  }
  return result;
}

function pagePath(page) {
  if (page <= 1) return "/";
  return "/search?updated-max=2099-01-01T00:00:00%2B00:00&max-results=" + PAGE_SIZE + "&start=" + ((page - 1) * PAGE_SIZE);
}

const plugin = {
  id: "arcomixverse",
  name: "Arcomixverse",

  async popular(offset) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const paths = [
      pagePath(page),
      page === 1 ? "/search/label/مترجم" : "/search/label/مترجم?max-results=" + PAGE_SIZE + "&start=" + ((page - 1) * PAGE_SIZE),
      "/search?max-results=" + PAGE_SIZE + "&start=" + ((page - 1) * PAGE_SIZE)
    ];
    const seen = new Set(), all = [];
    for (const path of paths) {
      try {
        for (const x of summaries(await getDoc(path))) if (!seen.has(x.id)) { seen.add(x.id); all.push(x); }
        if (all.length) return all;
      } catch (_) {}
    }
    return all;
  },

  async search(query, offset) {
    const q = clean(query);
    if (!q) return [];
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const start = (page - 1) * PAGE_SIZE;
    const paths = [
      "/search?q=" + encodeURIComponent(q) + "&max-results=" + PAGE_SIZE + "&start=" + start,
      "/search/label/" + encodeURIComponent(q) + "?max-results=" + PAGE_SIZE,
      "/search?max-results=" + PAGE_SIZE + "&start=" + start + "&q=" + encodeURIComponent(q)
    ];
    const seen = new Set(), all = [];
    for (const path of paths) {
      try {
        for (const x of summaries(await getDoc(path))) if (!seen.has(x.id)) { seen.add(x.id); all.push(x); }
        if (all.length) return all;
      } catch (_) {}
    }
    return all;
  },

  async detail(id) {
    const doc = await getDoc(id);
    const title = titleFrom(doc, clean(doc.querySelector(".post-title")?.text()) || id);
    const img = doc.querySelector(".post-body img, .entry-content img, article img, .post img, img");
    const body = doc.querySelector(".post-body, .entry-content, article .post-body");
    return { id, title, cover: imageUrl(img), description: clean(body?.text()) };
  },

  async chapters(id) {
    const doc = await getDoc(id);
    const result = uniqueChapters(doc, id);
    if (!result.length) {
      const title = titleFrom(doc, id);
      const n = (title.match(/(?:chapter|ch\.?|الفصل|العدد|#)\s*#?\s*([0-9]+(?:\.[0-9]+)?)/i) || [])[1];
      return [{ id, chapter: n || null, title, volume: null, pages: 0, language: "ar" }];
    }
    return result;
  },

  async pageUrls(chapterId) {
    const doc = await getDoc(chapterId);
    const result = [], seen = new Set();
    const containers = [".post-body", ".entry-content", ".post-content", "article", ".separator", ".blog-posts"];
    for (const container of containers) {
      const root = doc.querySelector(container);
      if (!root) continue;
      for (const img of root.querySelectorAll("img")) {
        const u = imageUrl(img);
        if (u && !seen.has(u)) { seen.add(u); result.push(u); }
      }
      for (const a of root.querySelectorAll("a[href]")) {
        const href = abs(a.attr("href"));
        if (href && /\.(?:jpg|jpeg|png|webp|gif)(?:[?#].*)?$/i.test(href) && !seen.has(href)) { seen.add(href); result.push(href); }
      }
    }
    if (!result.length) for (const img of doc.querySelectorAll("img")) {
      const u = imageUrl(img);
      if (u && !seen.has(u)) { seen.add(u); result.push(u); }
    }
    return result;
  }
};

return plugin;