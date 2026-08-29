// Arcomixverse source for Harbor
const BASE = "https://arcomixverse.blogspot.com";
const PAGE_SIZE = 20;

async function getDoc(path) {
  const res = await harbor.http(BASE + path, { responseType: "text" });
  if (!res.ok) throw new Error("http " + res.status + " for " + path);
  return harbor.parseHtml(res.body);
}

function abs(url) {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return BASE + url;
  return BASE + "/" + url;
}

function clean(v) { return v ? String(v).replace(/\s+/g, " ").trim() : ""; }

function postId(href) {
  const u = abs(href) || "";
  if (!u.startsWith(BASE)) return null;
  return u.replace(BASE, "").split("#")[0];
}

function makeSummary(el) {
  const a = el.querySelector("a[href]");
  if (!a) return null;
  const id = postId(a.attr("href"));
  if (!id || !/^\/(?:\d{4}\/)?[^?]+\.html$/i.test(id)) return null;
  const img = el.querySelector("img");
  const title = clean(el.querySelector("h1,h2,h3,h4,.post-title,.entry-title")?.text()) || clean(a.attr("title")) || clean(a.text());
  return { id, title: title || id, cover: abs(img?.attr("data-src") || img?.attr("data-original") || img?.attr("src")) };
}

function summaries(doc) {
  const out = [], seen = new Set();
  for (const el of doc.querySelectorAll(".post,.post-outer,.blog-posts article,.post-item")) {
    const x = makeSummary(el);
    if (x && !seen.has(x.id)) { seen.add(x.id); out.push(x); }
  }
  if (out.length) return out;
  for (const a of doc.querySelectorAll("a[href]")) {
    const id = postId(a.attr("href"));
    if (!id || seen.has(id) || !/^\/(?:\d{4}\/)?[^?]+\.html$/i.test(id)) continue;
    const x = makeSummary(a) || { id, title: clean(a.text()) || id, cover: undefined };
    seen.add(id); out.push(x);
  }
  return out;
}

function chapterFrom(a) {
  const id = postId(a.attr("href"));
  if (!id || !/^\/(?:\d{4}\/)?[^?]+\.html$/i.test(id)) return null;
  const title = clean(a.text()) || clean(a.attr("title"));
  if (!title) return null;
  const n = (title.match(/(?:chapter|ch\.?|issue|#|العدد|الفصل)\s*#?\s*([0-9]+(?:\.[0-9]+)?)/i) || [])[1];
  return { id, chapter: n || null, title, volume: null, pages: 0, language: "ar" };
}

const plugin = {
  id: "arcomixverse",
  name: "Arcomixverse",

  async popular(offset) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const paths = page === 1 ? ["/", "/search/label/مترجم"] : ["/search?updated-max=2099-01-01T00:00:00%2B00:00&max-results=" + (page * PAGE_SIZE), "/p/page.html?page=" + page];
    for (const path of paths) {
      try { const r = summaries(await getDoc(path)); if (r.length) return r; } catch (_) {}
    }
    return [];
  },

  async search(query, offset) {
    const q = clean(query);
    if (!q) return [];
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const paths = page === 1 ? ["/search?q=" + encodeURIComponent(q), "/search/label/" + encodeURIComponent(q)] : ["/search?q=" + encodeURIComponent(q) + "&max-results=" + PAGE_SIZE + "&start=" + ((page - 1) * PAGE_SIZE)];
    for (const path of paths) {
      try { const r = summaries(await getDoc(path)); if (r.length) return r; } catch (_) {}
    }
    return [];
  },

  async detail(id) {
    const doc = await getDoc(id);
    const title = clean(doc.querySelector("h1.post-title,h1.entry-title,h1")?.text()) || clean(doc.querySelector(".post-title")?.text()) || id;
    const img = doc.querySelector(".post-body img") || doc.querySelector("article img") || doc.querySelector("img");
    return { id, title, cover: abs(img?.attr("data-src") || img?.attr("data-original") || img?.attr("src")), description: clean(doc.querySelector(".post-body")?.text()) };
  },

  async chapters(id) {
    const doc = await getDoc(id);
    const result = [], seen = new Set();
    for (const a of doc.querySelectorAll("a[href]")) {
      const c = chapterFrom(a);
      if (c && c.id !== id && !seen.has(c.id)) { seen.add(c.id); result.push(c); }
    }
    return result;
  },

  async pageUrls(chapterId) {
    const doc = await getDoc(chapterId);
    const result = [], seen = new Set();
    for (const img of doc.querySelectorAll(".post-body img, .separator img, article img")) {
      const u = abs(img.attr("data-src") || img.attr("data-original") || img.attr("src"));
      if (u && !seen.has(u)) { seen.add(u); result.push(u); }
    }
    return result;
  }
};

return plugin;