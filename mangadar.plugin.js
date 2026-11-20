// Harbor manga source for MangaDar (Arabic).
// HTML-based implementation: catalog, search, manga details, chapter list and reader images.

const BASE = "https://mangadar.com";
const PAGE_SIZE = 24;

function clean(v) {
  return v == null ? "" : String(v).replace(/\s+/g, " ").trim();
}
function abs(v) {
  if (!v) return undefined;
  const s = String(v).trim();
  if (!s || /^(data:|blob:|javascript:)/i.test(s)) return undefined;
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("//")) return "https:" + s;
  return new URL(s, BASE + "/").toString();
}
function pathOf(v) {
  try { return new URL(abs(v)).pathname.replace(/\/+$/, "") + "/"; }
  catch (_) { return ""; }
}
function slugFromHref(href) {
  const p = pathOf(href);
  const m = p.match(/^\/manga\/([^/]+)\/$/i);
  return m ? decodeURIComponent(m[1]) : null;
}
function chapterFromHref(href) {
  const p = pathOf(href);
  const m = p.match(/^\/manga\/([^/]+)\/([^/]+)\/$/i);
  if (!m || !/^\d+(?:\.\d+)?(?:-[^/]*)?$/.test(m[2])) return null;
  const num = m[2].match(/^\d+(?:\.\d+)?/);
  return { slug: decodeURIComponent(m[1]), number: num ? num[0] : m[2], url: BASE + p };
}
async function get(path) {
  const url = /^https?:\/\//i.test(String(path)) ? String(path) : abs(path);
  const r = await harbor.http(url, {
    responseType: "text",
    timeoutMs: 30000,
    headers: { "User-Agent": "Mozilla/5.0", "Referer": BASE + "/" }
  });
  if (!r || r.ok === false) throw new Error("MangaDar HTTP error: " + (r ? r.status : "no response"));
  return harbor.parseHtml(r.body || "");
}
function attr(el, names) {
  for (const n of names) {
    const v = el && el.attr(n);
    if (v) return v;
  }
  return "";
}
function imageOf(img) {
  return abs(attr(img, ["data-src","data-lazy-src","data-original","data-image","data-url","src","srcset"]));
}
function titleOf(a, img) {
  const parent = a && (a.parentElement || a);
  return clean(attr(a, ["title","aria-label"]) ||
    attr(img, ["alt","title"]) ||
    (parent && parent.querySelector("h1,h2,h3,h4,.title,.name,.manga-title"))?.text() ||
    a?.text());
}
function cardFromAnchor(a) {
  const href = attr(a, ["href"]);
  const slug = slugFromHref(href);
  if (!slug) return null;
  const img = a.querySelector("img") ||
    a.parentElement?.querySelector("img") ||
    a.parentElement?.parentElement?.querySelector("img");
  const title = titleOf(a, img);
  if (!title) return null;
  return { id: slug, title, cover: imageOf(img) };
}
function cards(doc) {
  const out = [], seen = new Set();
  for (const a of doc.querySelectorAll('a[href*="/manga/"]')) {
    const item = cardFromAnchor(a);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}
function chapterItems(doc, slug) {
  const out = [], seen = new Set();
  // Scan every anchor instead of relying on a slug-specific CSS selector:
  // chapter lists may contain encoded slugs, nested markup, or alternate
  // chapter URL formats, while the details page itself has a non-chapter link.
  for (const a of doc.querySelectorAll("a[href]")) {
    const href = attr(a, ["href"]);
    const c = chapterFromHref(href);
    if (!c || (slug && c.slug !== slug) || seen.has(c.url)) continue;
    const raw = clean(a.text() || attr(a, ["title","aria-label"]));
    const n = c.number;
    seen.add(c.url);
    out.push({
      id: c.url,
      chapter: n,
      title: raw || ("الفصل " + n),
      volume: null,
      pages: 0,
      language: "ar"
    });
  }
  // Deduplicate and sort numerically descending, even if the site markup is
  // interleaved with other links or has duplicate chapter cards.
  out.sort((a,b) => (parseFloat(b.chapter)||0) - (parseFloat(a.chapter)||0));
  return out;
}
function imageUrls(doc) {
  const out = [], seen = new Set();
  const selectors = [
    ".reader img", ".reading-area img", ".chapter-reader img",
    ".chapter-content img", ".reader-content img", ".reading-content img",
    ".pages img", ".page-container img", ".wp-manga-chapter-img",
    "main img", "article img"
  ];
  for (const sel of selectors) {
    for (const img of doc.querySelectorAll(sel)) {
      const u = imageOf(img);
      if (!u || seen.has(u) || /logo|avatar|icon|banner|cover/i.test(u)) continue;
      seen.add(u);
      out.push(u);
    }
    if (out.length) return out;
  }
  for (const img of doc.querySelectorAll("img")) {
    const u = imageOf(img);
    if (!u || seen.has(u) || /logo|avatar|icon|banner|cover/i.test(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}
function pageNumber(url) {
  const m = String(url).match(/\/(\d+)\/?$/);
  return m ? Number(m[1]) : 1;
}
const plugin = {
  id: "mangadar",
  name: "MangaDar",

  async popular(offset) {
    const page = Math.floor(Math.max(0, Number(offset) || 0) / PAGE_SIZE) + 1;
    const paths = page === 1
      ? ["/manga/", "/"]
      : ["/manga/page/" + page + "/", "/manga/?page=" + page, "/?post_type=manga&paged=" + page];
    let found = [];
    for (const p of paths) {
      try {
        const doc = await get(p);
        found = cards(doc);
        if (found.length) break;
      } catch (_) {}
    }
    return found;
  },

  async search(query, offset) {
    const q = clean(query);
    if (!q) return this.popular(offset);
    const page = Math.floor(Math.max(0, Number(offset) || 0) / PAGE_SIZE) + 1;
    const paths = [
      "/?s=" + encodeURIComponent(q) + "&post_type=manga&paged=" + page,
      "/search/" + encodeURIComponent(q) + "/",
      "/manga/?s=" + encodeURIComponent(q) + "&page=" + page
    ];
    for (const p of paths) {
      try {
        const found = cards(await get(p));
        if (found.length) return found;
      } catch (_) {}
    }
    // Fallback: filter the first catalog page when the site's search route is unavailable.
    const all = await this.popular(0);
    const norm = q.toLocaleLowerCase();
    return all.filter(x => x.title.toLocaleLowerCase().includes(norm));
  },

  async detail(id) {
    const slug = String(id || "").replace(/^.*\/manga\//, "").replace(/\/+$/, "");
    if (!slug || slug.includes("/")) throw new Error("Invalid MangaDar manga ID");
    const doc = await get("/manga/" + encodeURIComponent(slug) + "/");
    const h = doc.querySelector("h1") || doc.querySelector("main h2");
    const coverImg = doc.querySelector('img[alt*="' + slug + '"]') ||
      doc.querySelector(".manga-cover img,.cover img,.poster img,main img");
    const title = clean(h?.text()) || slug.replace(/[-_]/g, " ");
    const description = clean(doc.querySelector(".description,.summary,.synopsis,.manga-description,.entry-content")?.text());
    const chapters = chapterItems(doc, slug);
    const authorText = clean(doc.querySelector(".author,.manga-author")?.text());
    const statusText = clean(doc.querySelector(".status,.manga-status")?.text());
    return {
      id: slug,
      title,
      cover: imageOf(coverImg),
      description: description || undefined,
      author: authorText || undefined,
      status: statusText || undefined,
      lastChapter: chapters[0]?.title
    };
  },

  async chapters(id) {
    const slug = String(id || "").replace(/^.*\/manga\//, "").replace(/\/+$/, "");
    const doc = await get("/manga/" + encodeURIComponent(slug) + "/");
    let list = chapterItems(doc, slug);
    if (!list.length) {
      // Some pages expose the full list behind a show-all link.
      for (const a of doc.querySelectorAll('a[href*="/manga/' + slug + '/"]')) {
        const href = attr(a, ["href"]);
        if (/all|chapter|فصل/i.test(clean(a.text()) + " " + href)) {
          try {
            const extra = chapterItems(await get(href), slug);
            if (extra.length > list.length) list = extra;
          } catch (_) {}
        }
      }
    }
    return list;
  },

  async pageUrls(chapterId) {
    let url = String(chapterId || "");
    if (!/^https?:\/\//i.test(url)) url = abs(url);
    const doc = await get(url);
    return imageUrls(doc);
  }
};

return plugin;