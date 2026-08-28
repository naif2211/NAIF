const BASE = "https://mangalik.net";
const PAGE_SIZE = 48;

function clean(v) { return v ? String(v).replace(/\s+/g, " ").trim() : ""; }
function abs(u) {
  if (!u) return undefined;
  u = String(u).trim();
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith("//")) return "https:" + u;
  if (u.startsWith("/")) return BASE + u;
  return BASE + "/" + u;
}
function pathOf(u) {
  const x = abs(u);
  return x ? x.replace(/^https?:\/\/[^/]+/i, "") : "";
}
async function get(path) {
  const r = await harbor.http(BASE + path, { responseType: "text" });
  if (!r.ok) throw new Error("HTTP " + r.status + " " + path);
  return harbor.parseHtml(r.body || "");
}
function mangaId(href) {
  const p = pathOf(href);
  const m = p.match(/^\/manga\/([^/?#]+)\/?$/i);
  return m ? decodeURIComponent(m[1]) : null;
}
function cardSummary(a) {
  const id = mangaId(a.attr("href") || "");
  if (!id) return null;
  let root = a;
  let title = clean(a.attr("title")) || clean(a.text());
  let cover;
  for (let i = 0; i < 8 && root; i++, root = root.parentElement) {
    if (!title) title = clean(root.querySelector(".post-title")?.text()) || clean(root.querySelector("h2")?.text()) || clean(root.querySelector("h3")?.text());
    if (!cover) {
      const img = root.querySelector("img");
      cover = abs(img?.attr("data-src") || img?.attr("data-lazy-src") || img?.attr("data-original") || img?.attr("src"));
    }
    if (title && cover) break;
  }
  return { id, title: title || id.replace(/[-_]+/g, " "), cover };
}
function list(doc) {
  const out = [], seen = new Set();
  for (const a of doc.querySelectorAll("a[href*='/manga/']")) {
    const x = cardSummary(a);
    if (x && !seen.has(x.id)) { seen.add(x.id); out.push(x); }
  }
  return out;
}
function chapterFrom(a) {
  const href = abs(a.attr("href") || "");
  if (!href) return null;
  const p = pathOf(href);
  const m = p.match(/^\/manga\/([^/?#]+)\/([^/?#]+)\/?$/i);
  if (!m) return null;
  const text = clean(a.text()) || clean(a.attr("title")) || m[2];
  const n = a.attr("data-number") || (text.match(/(?:chapter|ch\.?|الفصل|فصل)\s*#?\s*([0-9]+(?:\.[0-9]+)?)/i) || [])[1] || (m[2].match(/([0-9]+(?:\.[0-9]+)?)/) || [])[1] || m[2];
  return { id: href, chapter: n, title: text || "Chapter " + n, volume: null, pages: 0, language: "ar" };
}
function chapters(doc) {
  const selectors = [".wp-manga-chapter a[href]", ".listing-chapters_wrap a[href]", ".version-chap a[href]", ".c-tabs-item__content a[href]"];
  const out = [], seen = new Set();
  for (const sel of selectors) {
    for (const a of doc.querySelectorAll(sel)) {
      const c = chapterFrom(a);
      if (c && !seen.has(c.id)) { seen.add(c.id); out.push(c); }
    }
    if (out.length) break;
  }
  return out;
}
const plugin = {
  id: "mangalik",
  name: "مانجا ليك",
  async popular(offset) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    for (const p of (page === 1 ? ["/", "/manga/"] : ["/page/" + page + "/", "/manga/page/" + page + "/"])) {
      try { const r = list(await get(p)); if (r.length) return r; } catch (_) {}
    }
    return [];
  },
  async search(query, offset) {
    const q = clean(query);
    if (!q) return [];
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const e = encodeURIComponent(q);
    const paths = page === 1 ? [
      "/?s=" + e,
      "/manga/?s=" + e,
      "/?post_type=wp-manga&s=" + e,
      "/manga/?post_type=wp-manga&s=" + e
    ] : [
      "/page/" + page + "/?s=" + e,
      "/manga/page/" + page + "/?s=" + e
    ];
    for (const p of paths) {
      try {
        const r = list(await get(p));
        if (r.length) return r;
      } catch (_) {}
    }
    return [];
  },
  async detail(id) {
    const doc = await get("/manga/" + encodeURIComponent(id) + "/");
    const title = clean(doc.querySelector("h1")?.text()) || id;
    const img = doc.querySelector(".summary_image img") || doc.querySelector(".profile-manga img");
    return { id, title, cover: abs(img?.attr("data-src") || img?.attr("data-lazy-src") || img?.attr("data-original") || img?.attr("src")), description: clean(doc.querySelector(".description-summary")?.text()) || clean(doc.querySelector(".summary__content")?.text()), status: clean(doc.querySelector(".post-content_item.manga-status .summary-content")?.text()), author: clean(doc.querySelector(".post-content_item.manga-authors .summary-content")?.text()) || clean(doc.querySelector(".author-content")?.text()) };
  },
  async chapters(id) {
    const doc = await get("/manga/" + encodeURIComponent(id) + "/");
    let out = chapters(doc);
    if (!out.length) { try { out = chapters(await get("/manga/" + encodeURIComponent(id) + "/?style=list")); } catch (_) {} }
    out.sort((a,b) => parseFloat(b.chapter) - parseFloat(a.chapter));
    return out;
  },
  async pageUrls(chapterId) {
    const path = pathOf(chapterId);
    if (!path) return [];
    const doc = await get(path);
    const out = [], seen = new Set();
    for (const sel of [".reading-content img", ".page-break img", ".wp-manga-chapter-img img", ".entry-content img"]) {
      for (const img of doc.querySelectorAll(sel)) {
        const u = abs(img.attr("data-src") || img.attr("data-lazy-src") || img.attr("data-original") || img.attr("src"));
        if (u && !seen.has(u)) { seen.add(u); out.push(u); }
      }
      if (out.length) break;
    }
    return out;
  }
};
return plugin;