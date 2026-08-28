// MangaLik source for Harbor
const BASE = "https://mangalik.net";
const PAGE_SIZE = 48;

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

function mangaId(href) {
  const u = abs(href) || "";
  const p = u.replace(/^https?:\/\/[^/]+/i, "");
  const m = p.match(/^\/manga\/([^/?#]+)\/?$/i);
  return m ? decodeURIComponent(m[1]) : null;
}

function text(v) { return v ? String(v).replace(/\s+/g, " ").trim() : ""; }

function card(el) {
  const a = el.querySelector("a[href*='/manga/']") || el.querySelector("a");
  if (!a) return null;
  const id = mangaId(a.attr("href") || "");
  if (!id) return null;
  const img = el.querySelector("img");
  return {
    id,
    title: text(a.attr("title")) || text(el.querySelector(".post-title")?.text()) || text(el.querySelector("h2")?.text()) || text(el.querySelector("h3")?.text()) || text(a.text()) || id,
    cover: abs(img?.attr("data-src") || img?.attr("data-lazy-src") || img?.attr("src"))
  };
}

function cards(doc) {
  const result = [];
  const seen = new Set();
  const selectors = [
    ".page-item-detail.manga",
    ".row.c-tabs-item__content",
    ".c-tabs-item__content",
    ".manga-item"
  ];
  for (const selector of selectors) {
    for (const el of doc.querySelectorAll(selector)) {
      const x = card(el);
      if (x && !seen.has(x.id)) {
        seen.add(x.id);
        result.push(x);
      }
    }
    if (result.length) return result;
  }
  // Harbor's parser supports CSS selectors, so use the manga links directly as a final fallback.
  for (const a of doc.querySelectorAll("a[href]")) {
    const id = mangaId(a.attr("href") || "");
    if (!id || seen.has(id)) continue;
    const x = card(a) || {
      id,
      title: text(a.attr("title")) || text(a.text()) || id,
      cover: undefined
    };
    seen.add(id);
    result.push(x);
  }
  return result;
}

function chapter(a) {
  const href = a.attr("href") || "";
  const u = abs(href) || "";
  const p = u.replace(/^https?:\/\/[^/]+/i, "");
  // MangaLik chapter pages are /manga/<manga-slug>/<chapter>/.
  if (!/^\/manga\/[^/?#]+\/[^/?#]+\/?$/i.test(p)) return null;
  const m = p.match(/^\/manga\/([^/?#]+)\/([^/?#]+)\/?$/i);
  if (!m) return null;
  const label = text(a.text()) || text(a.attr("title")) || m[2];
  const number = (label.match(/(?:chapter|ch\.?|الفصل|فصل)\s*#?\s*([0-9]+(?:\.[0-9]+)?)/i) || [])[1]
    || (m[2].match(/([0-9]+(?:\.[0-9]+)?)/) || [])[1]
    || m[2];
  return {
    id: u,
    chapter: number,
    title: label || "Chapter " + number,
    volume: null,
    pages: 0,
    language: "ar"
  };
}

const plugin = {
  id: "mangalik",
  name: "مانجا ليك",

  async popular(offset) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const paths = page === 1 ? ["/latest/", "/"] : ["/latest/page/" + page + "/", "/page/" + page + "/"];
    for (const path of paths) {
      try {
        const result = cards(await getDoc(path));
        if (result.length) return result;
      } catch (_) {}
    }
    return [];
  },

  async search(query, offset) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const q = encodeURIComponent(text(query));
    if (!q) return [];
    const paths = page === 1
      ? ["/?s=" + q, "/manga/?s=" + q + "&post_type=wp-manga", "/?s=" + q + "&post_type=wp-manga"]
      : ["/?s=" + q + "&paged=" + page, "/manga/?s=" + q + "&post_type=wp-manga&paged=" + page];
    for (const path of paths) {
      try {
        const result = cards(await getDoc(path));
        if (result.length) return result;
      } catch (_) {}
    }
    return [];
  },

  async detail(id) {
    const doc = await getDoc("/manga/" + encodeURIComponent(id) + "/");
    const root = doc.querySelector(".profile-manga") || doc;
    const img = root.querySelector(".summary_image img") || root.querySelector("img");
    return {
      id,
      title: text(doc.querySelector("h1")?.text()) || id,
      cover: abs(img?.attr("data-src") || img?.attr("data-lazy-src") || img?.attr("src")),
      description: text(doc.querySelector(".description-summary")?.text()) || text(doc.querySelector(".summary__content")?.text()),
      status: text(doc.querySelector(".manga-status .summary-content")?.text()),
      author: text(doc.querySelector(".manga-authors .summary-content")?.text()) || text(doc.querySelector(".author-content")?.text())
    };
  },

  async chapters(id) {
    const doc = await getDoc("/manga/" + encodeURIComponent(id) + "/");
    const result = [];
    const seen = new Set();
    const selectors = [
      ".wp-manga-chapter a",
      ".listing-chapters_wrap a",
      ".c-tabs-item__content a"
    ];
    for (const selector of selectors) {
      for (const a of doc.querySelectorAll(selector)) {
        const c = chapter(a);
        if (c && !seen.has(c.id)) { seen.add(c.id); result.push(c); }
      }
      if (result.length) break;
    }
    // Fallback for MangaLik pages where the chapter links have no Madara class.
    if (!result.length) {
      for (const a of doc.querySelectorAll("a[href]")) {
        const c = chapter(a);
        if (c && !seen.has(c.id)) { seen.add(c.id); result.push(c); }
      }
    }
    result.sort((a, b) => {
      const x = parseFloat(a.chapter), y = parseFloat(b.chapter);
      if (Number.isNaN(x) || Number.isNaN(y)) return 0;
      return y - x;
    });
    return result;
  },

  async pageUrls(chapterId) {
    const u = abs(chapterId);
    if (!u) return [];
    const res = await harbor.http(u, { responseType: "text" });
    if (!res.ok) throw new Error("http " + res.status + " for chapter");
    const doc = harbor.parseHtml(res.body);
    const result = [];
    const seen = new Set();
    for (const selector of [".reading-content img", ".wp-manga-chapter-img", ".page-break img", ".entry-content img"]) {
      for (const img of doc.querySelectorAll(selector)) {
        const url = abs(img.attr("data-src") || img.attr("data-lazy-src") || img.attr("data-original") || img.attr("src"));
        if (url && !seen.has(url)) { seen.add(url); result.push(url); }
      }
      if (result.length) break;
    }
    return result;
  }
};

return plugin;
