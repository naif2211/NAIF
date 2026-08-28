// Harbor source for mangalik.net (MangaLik)
const BASE = "https://mangalik.net";
const PAGE_SIZE = 48;

function clean(text) {
  return text ? String(text).replace(/\s+/g, " ").trim() : "";
}

function abs(url) {
  if (!url) return undefined;
  url = String(url).trim();
  if (!url || url.startsWith("data:")) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return BASE + url;
  return BASE + "/" + url;
}

function pathOf(url) {
  const u = abs(url);
  return u ? u.replace(/^https?:\/\/[^/]+/i, "") : "";
}

async function getDoc(path, options) {
  const res = await harbor.http(BASE + path, Object.assign({
    responseType: "text",
    timeoutMs: 30000,
    headers: { Referer: BASE + "/" }
  }, options || {}));
  if (!res.ok) throw new Error("http " + res.status + " for " + path);
  return harbor.parseHtml(res.body || "");
}

function mangaId(href) {
  const p = pathOf(href);
  const m = p.match(/^\/manga\/([^/?#]+)\/?$/i);
  return m ? decodeURIComponent(m[1]) : null;
}

function cardToSummary(el) {
  const links = el.querySelectorAll("a");
  for (const link of links) {
    const id = mangaId(link.attr("href") || "");
    if (!id) continue;
    const title = clean(link.attr("title")) || clean(link.text()) || clean(el.querySelector("h3")?.text()) || clean(el.querySelector("h4")?.text()) || id;
    const img = el.querySelector("img");
    return {
      id,
      title,
      cover: abs(img?.attr("data-src") || img?.attr("data-lazy-src") || img?.attr("data-original") || img?.attr("src"))
    };
  }
  return null;
}

function listFromDoc(doc) {
  const out = [];
  const seen = new Set();
  // First use common MangaLik/Madara card containers.
  const containers = [
    ".row.c-tabs-item__content",
    ".page-item-detail",
    ".item-summary",
    ".tab-thumb",
    ".c-tabs-item__content",
    "article",
    ".manga-item"
  ];
  for (const sel of containers) {
    for (const el of doc.querySelectorAll(sel)) {
      const item = cardToSummary(el);
      if (item && !seen.has(item.id)) {
        seen.add(item.id);
        out.push(item);
      }
    }
    if (out.length) return out;
  }
  // Final fallback: every manga link on the page.
  for (const a of doc.querySelectorAll("a")) {
    const id = mangaId(a.attr("href") || "");
    if (!id || seen.has(id)) continue;
    const title = clean(a.attr("title")) || clean(a.text()) || id;
    if (!title) continue;
    seen.add(id);
    let parent = a.parentElement;
    let cover;
    for (let i = 0; i < 5 && parent; i++, parent = parent.parentElement) {
      const img = parent.querySelector("img");
      if (img) {
        cover = abs(img.attr("data-src") || img.attr("data-lazy-src") || img.attr("data-original") || img.attr("src"));
        if (cover) break;
      }
    }
    out.push({ id, title, cover });
  }
  return out;
}

function chapterNumber(text, href) {
  const s = clean(text) || String(href || "");
  let m = s.match(/(?:chapter|ch\.?|الفصل|فصل)\s*#?\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (!m) m = s.match(/\/manga\/[^/]+\/([^/?#]+)\/?$/i);
  if (!m) m = s.match(/([0-9]+(?:\.[0-9]+)?)/);
  return m ? m[1] : null;
}

function chaptersFromDoc(doc) {
  const out = [];
  const seen = new Set();
  for (const a of doc.querySelectorAll("a")) {
    const href = abs(a.attr("href") || "");
    if (!href || seen.has(href)) continue;
    const p = pathOf(href);
    const m = p.match(/^\/manga\/([^/]+)\/([^/?#]+)\/?$/i);
    if (!m) continue;
    const number = a.attr("data-number") || chapterNumber(a.text(), href) || decodeURIComponent(m[2]);
    const title = clean(a.text()) || clean(a.attr("title")) || "Chapter " + number;
    seen.add(href);
    out.push({ id: href, chapter: number, title, volume: null, pages: 0, language: "ar" });
  }
  return out;
}

function sortChapters(list) {
  return list.sort((a, b) => {
    const na = parseFloat(a.chapter);
    const nb = parseFloat(b.chapter);
    if (Number.isFinite(na) && Number.isFinite(nb)) return nb - na;
    return String(b.chapter || "").localeCompare(String(a.chapter || ""));
  });
}

async function findSearch(paths) {
  for (const path of paths) {
    try {
      const items = listFromDoc(await getDoc(path));
      if (items.length) return items;
    } catch (_) {}
  }
  return [];
}

const plugin = {
  id: "mangalik",
  name: "مانجا ليك",

  async popular(offset) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const paths = page === 1
      ? ["/", "/manga/", "/latest/"]
      : ["/page/" + page + "/", "/manga/page/" + page + "/", "/latest/page/" + page + "/"];
    return findSearch(paths);
  },

  async search(query, offset) {
    const q = String(query || "").trim();
    if (!q) return [];
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const e = encodeURIComponent(q);
    const paths = [
      "/?s=" + e,
      "/?s=" + e + "&post_type=wp-manga",
      "/manga/?s=" + e,
      "/manga/?s=" + e + "&post_type=wp-manga",
      "/search/" + e + "/"
    ];
    if (page > 1) {
      paths.push("/page/" + page + "/?s=" + e);
      paths.push("/manga/page/" + page + "/?s=" + e);
    }
    return findSearch(paths);
  },

  async detail(id) {
    const doc = await getDoc("/manga/" + encodeURIComponent(id) + "/");
    const root = doc.querySelector(".site-content") || doc;
    const title = clean(root.querySelector("h1")?.text()) || id;
    const img = root.querySelector(".summary_image img") || root.querySelector(".profile-manga img") || root.querySelector("img");
    return {
      id,
      title,
      altTitle: clean(root.querySelector(".post-content_item.manga_alternative .summary-content")?.text()) || clean(root.querySelector(".alternative")?.text()),
      cover: abs(img?.attr("data-src") || img?.attr("data-lazy-src") || img?.attr("data-original") || img?.attr("src")),
      description: clean(root.querySelector(".description-summary")?.text()) || clean(root.querySelector(".summary__content")?.text()),
      status: clean(root.querySelector(".post-content_item.manga-status .summary-content")?.text()),
      author: clean(root.querySelector(".post-content_item.manga-authors .summary-content")?.text()) || clean(root.querySelector(".author-content")?.text()),
      lastChapter: clean(root.querySelector("a[href*='/manga/' ]")?.text())
    };
  },

  async chapters(id) {
    // MangaLik puts the complete chapter list on the manga detail page.
    const doc = await getDoc("/manga/" + encodeURIComponent(id) + "/");
    return sortChapters(chaptersFromDoc(doc));
  },

  async pageUrls(chapterId) {
    const path = pathOf(chapterId);
    const res = await harbor.http(BASE + path, {
      responseType: "text",
      timeoutMs: 30000,
      headers: { Referer: BASE + "/" }
    });
    if (!res.ok) throw new Error("http " + res.status + " for " + path);
    const doc = await harbor.parseHtml(res.body || "");
    const urls = [];
    const seen = new Set();
    for (const sel of [".reading-content img", ".page-break img", ".wp-manga-chapter-img img", ".entry-content img"]) {
      for (const img of doc.querySelectorAll(sel)) {
        const u = abs(img.attr("data-src") || img.attr("data-lazy-src") || img.attr("data-original") || img.attr("src"));
        if (!u || seen.has(u)) continue;
        seen.add(u);
        urls.push(u);
      }
      if (urls.length) break;
    }
    return urls;
  },

  async tags() {
    const doc = await getDoc("/manga/");
    const out = [];
    const seen = new Set();
    for (const a of doc.querySelectorAll("a")) {
      const href = a.attr("href") || "";
      const m = href.match(/\/manga-genre\/([^/?#]+)/i);
      const name = clean(a.text());
      if (!name || !m || seen.has(m[1])) continue;
      seen.add(m[1]);
      out.push({ id: decodeURIComponent(m[1]), name, group: "Genre" });
    }
    return out;
  }
};

return plugin;
