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
  url = String(url).trim();
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return BASE + url;
  return BASE + "/" + url;
}

function pathOf(url) {
  const u = abs(url);
  return u ? u.replace(/^https?:\/\/[^/]+/i, "") : "";
}

function clean(v) {
  return v ? String(v).replace(/\s+/g, " ").trim() : "";
}

// MangaLik has more than one manga URL slug in circulation.
// The id is always the exact slug from the manga page link.
function mangaId(href) {
  const p = pathOf(href);
  const m = p.match(/^\/manga\/([^/?#]+)\/?$/i);
  return m ? decodeURIComponent(m[1]) : null;
}

function summaryFromCard(el) {
  const link = el.querySelector("a");
  if (!link) return null;
  const id = mangaId(link.attr("href") || "");
  if (!id) return null;
  const img = el.querySelector("img");
  return {
    id,
    title: clean(link.attr("title")) || clean(el.querySelector("h2")?.text()) || clean(el.querySelector("h3")?.text()) || clean(link.text()) || id,
    cover: abs(img?.attr("data-src") || img?.attr("data-lazy-src") || img?.attr("data-original") || img?.attr("src")),
  };
}

function collectManga(doc) {
  const result = [];
  const seen = new Set();

  // Prefer the site's card/list containers. These selectors are deliberately simple
  // because Harbor's HTML parser is not a browser DOM implementation.
  const containers = [
    ".row.c-tabs-item__content",
    ".c-tabs-item__content",
    ".page-item-detail.manga",
    ".item-summary",
    ".row.manga-content",
    ".manga-item",
    ".item-summary"
  ];

  for (const selector of containers) {
    for (const el of doc.querySelectorAll(selector)) {
      const x = summaryFromCard(el);
      if (x && !seen.has(x.id)) {
        seen.add(x.id);
        result.push(x);
      }
    }
    if (result.length) return result;
  }

  // Final fallback: inspect every link and keep only exact /manga/<slug>/ links.
  for (const a of doc.querySelectorAll("a")) {
    const id = mangaId(a.attr("href") || "");
    if (!id || seen.has(id)) continue;
    let root = a;
    let title = clean(a.attr("title")) || clean(a.text());
    let cover;
    for (let i = 0; i < 6 && root; i++, root = root.parentElement) {
      if (!title) title = clean(root.querySelector("h2")?.text()) || clean(root.querySelector("h3")?.text());
      if (!cover) {
        const img = root.querySelector("img");
        cover = abs(img?.attr("data-src") || img?.attr("data-srcset") || img?.attr("src"));
      }
      if (title && cover) break;
    }
    seen.add(id);
    result.push({ id, title: title || id.replace(/[-_]+/g, " "), cover });
  }
  return result;
}

function chapterFromLink(a) {
  const href = a.attr("href") || "";
  const p = pathOf(href);
  const m = p.match(/^\/manga\/([^/?#]+)\/([^/?#]+)\/?$/i);
  if (!m) return null;

  const text = clean(a.text()) || clean(a.attr("title")) || m[2];
  const number =
    a.attr("data-number") ||
    (text.match(/(?:chapter|ch\.?|الفصل|فصل)\s*#?\s*([0-9]+(?:\.[0-9]+)?)/i) || [])[1] ||
    (m[2].match(/([0-9]+(?:\.[0-9]+)?)/) || [])[1] ||
    m[2];

  return {
    id: abs(href),
    chapter: number,
    title: text || "Chapter " + number,
    volume: null,
    pages: 0,
    language: "ar",
  };
}

const plugin = {
  id: "mangalik",
  name: "مانجا ليك",

  async popular(offset) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const paths = page === 1
      ? ["/", "/home/", "/mangalik/"]
      : ["/page/" + page + "/", "/home/page/" + page + "/", "/mangalik/page/" + page + "/"];

    for (const path of paths) {
      try {
        const doc = await getDoc(path);
        const result = collectManga(doc);
        if (result.length) return result;
      } catch (_) {}
    }
    return [];
  },

  async search(query, offset) {
    const q = clean(query);
    if (!q) return [];
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const e = encodeURIComponent(q);

    // MangaLik is WordPress/Madara. Try its normal WP search and the manga
    // post-type search. The first successful page with manga results wins.
    const paths = [
      "/?s=" + e,
      "/manga/?s=" + e,
      "/?post_type=wp-manga&s=" + e,
      "/manga/?post_type=wp-manga&s=" + e,
      "/?s=" + e + "&paged=" + page,
      "/manga/?s=" + e + "&paged=" + page,
      "/?post_type=wp-manga&s=" + e + "&paged=" + page,
      "/manga/?post_type=wp-manga&s=" + e + "&paged=" + page
    ];

    for (const path of paths) {
      try {
        const doc = await getDoc(path);
        const result = collectManga(doc);
        if (result.length) return result;
      } catch (_) {}
    }
    return [];
  },

  async detail(id) {
    const doc = await getDoc("/manga/" + encodeURIComponent(id) + "/");
    const title = clean(doc.querySelector("h1")?.text()) || id;
    const img = doc.querySelector(".summary_image img") || doc.querySelector(".profile-manga img");
    return {
      id,
      title,
      cover: abs(img?.attr("data-src") || img?.attr("data-lazy-src") || img?.attr("data-original") || img?.attr("src")),
      description: clean(doc.querySelector(".description-summary")?.text()) || clean(doc.querySelector(".summary__content")?.text()),
      status: clean(doc.querySelector(".manga-status .summary-content")?.text()),
      author: clean(doc.querySelector(".manga-authors .summary-content")?.text()) || clean(doc.querySelector(".author-content")?.text())
    };
  },

  async chapters(id) {
    const doc = await getDoc("/manga/" + encodeURIComponent(id) + "/");
    const result = [];
    const seen = new Set();

    // Do not depend on one Madara class. MangaLik exposes real chapter URLs
    // directly on the manga page: /manga/<chapter-slug>/<chapter-number>/.
    for (const a of doc.querySelectorAll("a")) {
      const c = chapterFromLink(a);
      if (!c || seen.has(c.id)) continue;
      seen.add(c.id);
      result.push(c);
    }

    result.sort((a, b) => {
      const na = parseFloat(a.chapter);
      const nb = parseFloat(b.chapter);
      if (Number.isNaN(na) || Number.isNaN(nb)) return 0;
      return nb - na;
    });
    return result;
  },

  async pageUrls(chapterId) {
    const path = pathOf(chapterId);
    if (!path) return [];
    const doc = await getDoc(path);
    const result = [];
    const seen = new Set();

    const selectors = [
      ".reading-content img",
      ".wp-manga-chapter-img",
      ".page-break img",
      ".entry-content img"
    ];

    for (const selector of selectors) {
      for (const img of doc.querySelectorAll(selector)) {
        const url = abs(img.attr("data-src") || img.attr("data-lazy-src") || img.attr("data-original") || img.attr("src"));
        if (url && !seen.has(url)) {
          seen.add(url);
          result.push(url);
        }
      }
      if (result.length) break;
    }
    return result;
  }
};

return plugin;
