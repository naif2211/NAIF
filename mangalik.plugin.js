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
  if (!u) return "";
  return u.replace(/^https?:\/\/[^/]+/i, "");
}

async function getDoc(path, options) {
  const res = await harbor.http(BASE + path, Object.assign({
    responseType: "text",
    timeoutMs: 30000,
    headers: { Referer: BASE + "/", "User-Agent": "Mozilla/5.0" }
  }, options || {}));
  if (!res.ok) throw new Error("http " + res.status + " for " + path);
  return harbor.parseHtml(res.body || "");
}

function mangaIdFromHref(href) {
  const p = pathOf(href);
  if (!p) return null;
  // A manga work has exactly one path segment after /manga/.
  const m = p.match(/^\/manga\/([^/?#]+)\/?(?:[?#].*)?$/i);
  return m ? decodeURIComponent(m[1]) : null;
}

function findCover(link) {
  let el = link;
  for (let i = 0; i < 6 && el; i++, el = el.parentElement) {
    const img = el.querySelector("img");
    if (!img) continue;
    const u = img.attr("data-src") || img.attr("data-lazy-src") || img.attr("data-original") || img.attr("src");
    if (u) return abs(u);
  }
  return undefined;
}

function findTitle(link) {
  const direct = clean(link.attr("title"));
  if (direct) return direct;
  let text = clean(link.text());
  if (text) return text;
  let el = link;
  for (let i = 0; i < 6 && el; i++, el = el.parentElement) {
    for (const sel of [".post-title", ".item-summary h3", ".summary_content h3", "h3", "h4", ".manga-title"]) {
      const x = el.querySelector(sel);
      const t = clean(x?.text());
      if (t) return t;
    }
  }
  return undefined;
}

function findMangaLinks(doc) {
  const out = [];
  const seen = new Set();
  // MangaLik pages expose work links as /manga/<slug>/.
  for (const a of doc.querySelectorAll("a")) {
    const href = a.attr("href") || "";
    const id = mangaIdFromHref(href);
    if (!id || seen.has(id)) continue;
    const title = findTitle(a);
    if (!title) continue;
    seen.add(id);
    out.push({ id, title, cover: findCover(a) });
  }
  return out;
}

function chapterNumber(text, href) {
  const s = clean(text) || String(href || "");
  let m = s.match(/(?:chapter|ch\.?|الفصل|فصل)\s*#?\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (!m) m = s.match(/\/([0-9]+(?:\.[0-9]+)?)\/?(?:\?|#|$)/);
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
    const title = clean(a.text()) || clean(a.attr("title"));
    const number = a.attr("data-number") || chapterNumber(title, href);
    if (!number && !title) continue;
    seen.add(href);
    out.push({
      id: href,
      chapter: number,
      title: title || "Chapter " + number,
      volume: null,
      pages: 0,
      language: "ar"
    });
  }
  return out;
}

async function tryListing(paths) {
  for (const path of paths) {
    try {
      const items = findMangaLinks(await getDoc(path));
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
      ? ["/", "/latest/"]
      : ["/page/" + page + "/", "/latest/page/" + page + "/"];
    return tryListing(paths);
  },

  async search(query, offset) {
    const q = String(query || "").trim();
    if (!q) return this.popular(offset);
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const e = encodeURIComponent(q);
    const paths = [
      "/?s=" + e + "&post_type=wp-manga",
      "/manga/?s=" + e + "&post_type=wp-manga",
      "/?s=" + e,
      "/search/" + e + "/"
    ];
    if (page > 1) {
      paths.unshift(
        "/page/" + page + "/?s=" + e + "&post_type=wp-manga",
        "/manga/page/" + page + "/?s=" + e + "&post_type=wp-manga"
      );
    }
    return tryListing(paths);
  },

  async detail(id) {
    const doc = await getDoc("/manga/" + encodeURIComponent(id) + "/");
    const root = doc.querySelector(".site-content") || doc;
    const titleEl = root.querySelector("div.post-title h1") || root.querySelector("h1");
    const coverEl = root.querySelector(".summary_image img") || root.querySelector(".profile-manga img") || root.querySelector("img");
    return {
      id,
      title: clean(titleEl?.text()) || id,
      altTitle: clean(root.querySelector(".alternative")?.text()),
      cover: abs(coverEl?.attr("data-src") || coverEl?.attr("data-lazy-src") || coverEl?.attr("data-original") || coverEl?.attr("src")),
      author: clean(root.querySelector(".author-content")?.text()),
      status: clean(root.querySelector(".post-content_item.manga-status .summary-content")?.text()),
      description: clean(root.querySelector(".summary__content")?.text() || root.querySelector(".description-summary")?.text()),
      lastChapter: clean(root.querySelector("li.wp-manga-chapter a")?.text())
    };
  },

  async chapters(id) {
    return chaptersFromDoc(await getDoc("/manga/" + encodeURIComponent(id) + "/"));
  },

  async pageUrls(chapterId) {
    const path = pathOf(chapterId);
    const res = await harbor.http(BASE + path, {
      responseType: "text",
      timeoutMs: 30000,
      headers: { Referer: BASE + "/", "User-Agent": "Mozilla/5.0" }
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
      const m = href.match(/\/(?:manga-genre|genre)\/([^/?#]+)/i);
      const name = clean(a.text());
      if (!name || !m || seen.has(m[1])) continue;
      seen.add(m[1]);
      out.push({ id: m[1], name, group: "Genre" });
    }
    return out;
  }
};

return plugin;
