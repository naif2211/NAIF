// Harbor source for OlympusStaff / Team-X
const BASE = "https://olympustaff.com";
const PAGE_SIZE = 48;

function clean(v) { return v ? String(v).replace(/\s+/g, " ").trim() : ""; }
function abs(v) {
  if (!v) return "";
  v = String(v).trim();
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith("//")) return "https:" + v;
  return new URL(v, BASE).toString();
}
async function doc(url) {
  const r = await harbor.http(url, { responseType: "text", timeoutMs: 30000, headers: { Referer: BASE + "/" } });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return harbor.parseHtml(r.body || "");
}
function txt(e) { return clean(e?.text()); }
function attr(e, names) {
  for (const n of names) { const v = e?.attr(n); if (v) return abs(v); }
  return "";
}
function mangaId(href) {
  const m = String(href || "").match(/\/series\/([^/?#]+)\/?$/i);
  return m ? decodeURIComponent(m[1]) : null;
}
function cards(d) {
  const out = [], seen = new Set();
  for (const a of d.querySelectorAll('a[href*="/series/"]')) {
    const id = mangaId(a.attr("href"));
    const title = txt(a);
    if (!id || !title || title.length < 2 || /قائمة المانجا|الرئيسية|الفرق|الاخبار|العضويات/i.test(title) || seen.has(id)) continue;
    seen.add(id);
    const img = a.querySelector("img") || a.parentElement?.querySelector("img");
    out.push({ id, title, cover: attr(img, ["data-src", "data-lazy-src", "data-original", "src"]) });
  }
  return out;
}

// OlympusStaff chapter links are /series/<manga>/<chapter>.
// The visible label is used first, then the final numeric URL segment.
function chapterNumber(label, href) {
  const s = clean(label);
  let m = s.match(/الفصل\s*رقم\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (m) return m[1];
  m = s.match(/(?:الفصل|فصل|chapter|chap)\s*[-_.:#]*\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (m) return m[1];
  m = String(href || "").match(/\/series\/[^/?#]+\/([0-9]+(?:\.[0-9]+)?)\/?(?:\?|#|$)/i);
  return m ? m[1] : null;
}
function isChapterUrl(href) {
  return /\/series\/[^/?#]+\/[0-9]+(?:\.[0-9]+)?\/?(?:\?|#|$)/i.test(String(href || ""));
}
function getChapters(d) {
  const out = [], seen = new Set();
  for (const a of d.querySelectorAll('a[href]')) {
    const href = a.attr("href") || "";
    const label = txt(a);
    if (!href || !isChapterUrl(href)) continue;
    const n = chapterNumber(label, href);
    if (n === null) continue;
    const url = abs(href);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ id: url, chapter: n, title: label || ("الفصل " + n), volume: null, pages: 0, language: "ar" });
  }
  out.sort((a, b) => Number(b.chapter) - Number(a.chapter));
  return out;
}

function pageImages(d) {
  const out = [], seen = new Set();
  // On OlympusStaff the reader page explicitly contains the chapter images.
  // Prefer the image links/content area; do not stop after the first image.
  const selectors = [
    ".reading-content img",
    ".reading-content a img",
    ".reader-content img",
    ".chapter-content img",
    ".chapter-images img",
    ".images-content img",
    "img[alt*='episode']",
    "img[data-src]",
    "img[data-lazy-src]"
  ];
  for (const sel of selectors) {
    const nodes = d.querySelectorAll(sel);
    for (const img of nodes) {
      const u = attr(img, ["data-src", "data-lazy-src", "data-original", "src"]);
      if (!u || seen.has(u)) continue;
      if (/logo|avatar|favicon|icon|banner|ads?\b/i.test(u)) continue;
      seen.add(u);
      out.push(u);
    }
    if (out.length > 1) break;
  }
  return out;
}

return {
  id: "olympustaff",
  name: "OlympusStaff",

  async popular(offset) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    return cards(await doc(BASE + "/series?page=" + page));
  },

  async search(query, offset) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const paths = [
      "/series?search=" + encodeURIComponent(query) + "&page=" + page,
      "/series/?search=" + encodeURIComponent(query) + "&page=" + page
    ];
    for (const p of paths) {
      try {
        const r = cards(await doc(BASE + p));
        if (r.length) return r;
      } catch (_) {}
    }
    return [];
  },

  async detail(id) {
    const d = await doc(BASE + "/series/" + encodeURIComponent(id));
    const root = d.querySelector("main") || d.querySelector(".container") || d;
    const image = root.querySelector("img");
    return {
      id,
      title: txt(root.querySelector("h1")) || txt(root.querySelector("h2")) || id,
      altTitle: txt(root.querySelector(".alternative, .other-name")),
      cover: attr(image, ["data-src", "data-lazy-src", "data-original", "src"]),
      author: txt(root.querySelector(".author, .artist, .writer")),
      status: txt(root.querySelector(".status")),
      description: txt(root.querySelector(".description, .summary, .entry-content, .manga-description"))
    };
  },

  async chapters(id) {
    const d = await doc(BASE + "/series/" + encodeURIComponent(id));
    return getChapters(d);
  },

  async pageUrls(chapterId) {
    const d = await doc(abs(chapterId));
    return pageImages(d);
  },

  async tags() {
    const d = await doc(BASE + "/series");
    const out = [], seen = new Set();
    for (const a of d.querySelectorAll("a[href]")) {
      const href = a.attr("href") || "", name = txt(a);
      const m = href.match(/\/(?:genre|type|category)\/([^/?#]+)/i);
      if (!m || !name || seen.has(m[1])) continue;
      seen.add(m[1]);
      out.push({ id: decodeURIComponent(m[1]), name, group: "Genre" });
    }
    return out;
  }
};
