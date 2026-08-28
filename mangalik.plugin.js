// Harbor source for mangalik.net (MangaLik)
const BASE = "https://mangalik.net";
const PAGE_SIZE = 10;

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
function summaryFromLink(a) {
  const id = mangaId(a.attr("href") || "");
  if (!id) return null;
  let title = clean(a.attr("title")) || clean(a.text());
  let cover;
  let p = a;
  for (let i = 0; i < 6 && p; i++, p = p.parentElement) {
    if (!title) title = clean(p.querySelector("h1")?.text()) || clean(p.querySelector("h2")?.text()) || clean(p.querySelector("h3")?.text());
    if (!cover) {
      const img = p.querySelector("img");
      cover = abs(img?.attr("data-src") || img?.attr("data-lazy-src") || img?.attr("data-original") || img?.attr("src"));
    }
  }
  return { id, title: title || id.replace(/[-_]+/g, " "), cover };
}
function list(doc) {
  const out = [], seen = new Set();
  for (const a of doc.querySelectorAll("a[href]")) {
    const x = summaryFromLink(a);
    if (x && !seen.has(x.id)) { seen.add(x.id); out.push(x); }
  }
  return out;
}
function chapterInfo(href) {
  const p = pathOf(href);
  const m = p.match(/^\/manga\/([^/?#]+)\/([^/?#]+)\/?$/i);
  if (!m) return null;
  const slug = decodeURIComponent(m[2]);
  const n = (slug.match(/(?:chapter|ch|الفصل|فصل)[-_ ]*([0-9]+(?:\.[0-9]+)?)/i) || [])[1] || (slug.match(/([0-9]+(?:\.[0-9]+)?)/) || [])[1] || slug;
  return { id: abs(href), chapter: n };
}

const plugin = {
  id: "mangalik",
  name: "مانجا ليك",

  async popular(offset) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const paths = page === 1
      ? ["/", "/home/", "/latest/", "/manga/"]
      : ["/page/" + page + "/", "/home/page/" + page + "/", "/latest/page/" + page + "/", "/manga/page/" + page + "/"];
    for (const p of paths) {
      try { const r = list(await get(p)); if (r.length) return r; } catch (_) {}
    }
    return [];
  },

  async search(query, offset) {
    const q = clean(query);
    if (!q) return [];
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const e = encodeURIComponent(q);
    // MangaLik is a WordPress/Madara site. Search results are paginated by both
    // pretty pagination and the `paged` query parameter depending on the route.
    const paths = [
      "/manga/?s=" + e + "&post_type=wp-manga",
      "/manga/?s=" + e,
      "/?s=" + e + "&post_type=wp-manga",
      "/?s=" + e,
      "/manga/page/" + page + "/?s=" + e + "&post_type=wp-manga",
      "/page/" + page + "/?s=" + e + "&post_type=wp-manga",
      "/manga/?s=" + e + "&post_type=wp-manga&paged=" + page,
      "/?s=" + e + "&post_type=wp-manga&paged=" + page
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
    const img = doc.querySelector(".summary_image img") || doc.querySelector(".profile-manga img") || doc.querySelector("img");
    return {
      id,
      title,
      cover: abs(img?.attr("data-src") || img?.attr("data-lazy-src") || img?.attr("data-original") || img?.attr("src")),
      description: clean(doc.querySelector(".description-summary")?.text()) || clean(doc.querySelector(".summary__content")?.text()),
      status: clean(doc.querySelector(".post-content_item.manga-status .summary-content")?.text()),
      author: clean(doc.querySelector(".post-content_item.manga-authors .summary-content")?.text()) || clean(doc.querySelector(".author-content")?.text())
    };
  },

  async chapters(id) {
    const doc = await get("/manga/" + encodeURIComponent(id) + "/");
    const out = [], seen = new Set(), links = [];
    for (const s of [".wp-manga-chapter a", ".chapter-list a", ".listing-chapters_wrap a", ".c-tabs-item__content a"]) {
      for (const a of doc.querySelectorAll(s)) links.push(a);
    }
    if (!links.length) for (const a of doc.querySelectorAll("a[href]")) links.push(a);
    for (const a of links) {
      const c = chapterInfo(a.attr("href") || "");
      if (!c || seen.has(c.id)) continue;
      const text = clean(a.text()) || clean(a.attr("title"));
      const number = a.attr("data-number") || (text.match(/(?:chapter|ch\.?|الفصل|فصل)\s*#?\s*([0-9]+(?:\.[0-9]+)?)/i) || [])[1] || c.chapter;
      seen.add(c.id);
      out.push({ id: c.id, chapter: number, title: text || "Chapter " + number, volume: null, pages: 0, language: "ar" });
    }
    out.sort((a, b) => {
      const x = parseFloat(a.chapter), y = parseFloat(b.chapter);
      if (isNaN(x) || isNaN(y)) return 0;
      return y - x;
    });
    return out;
  },

  async pageUrls(chapterId) {
    const path = pathOf(chapterId);
    if (!path) return [];
    const doc = await get(path);
    const out = [], seen = new Set();
    for (const sel of [".reading-content img", ".page-break img", ".wp-manga-chapter-img img", ".entry-content img", "img") {
      for (const img of doc.querySelectorAll(sel)) {
        const u = abs(img.attr("data-src") || img.attr("data-lazy-src") || img.attr("data-original") || img.attr("src"));
        if (u && !seen.has(u) && /\.(?:jpe?g|png|webp|gif)(?:[?#].*)?$/i.test(u)) {
          seen.add(u); out.push(u);
        }
      }
      if (out.length) break;
    }
    return out;
  }
};

return plugin;
