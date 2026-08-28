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

async function getDoc(path, options) {
  const res = await harbor.http(BASE + path, Object.assign({
    responseType: "text",
    timeoutMs: 30000,
    headers: { Referer: BASE + "/" }
  }, options || {}));
  if (!res.ok) throw new Error("http " + res.status + " for " + path);
  return harbor.parseHtml(res.body || "");
}

function mangaIdFromHref(href) {
  if (!href) return null;
  const s = String(href).trim().replace(BASE, "");
  const m = s.match(/^\/manga\/([^/?#]+)\/?$/i);
  return m ? m[1] : null;
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
  const title = clean(link.attr("title"));
  if (title) return title;
  let el = link;
  for (let i = 0; i < 6 && el; i++, el = el.parentElement) {
    for (const sel of [".post-title", ".item-summary h3", ".summary_content h3", "h3", "h4", ".manga-title"]) {
      const x = el.querySelector(sel);
      const t = clean(x?.text());
      if (t) return t;
    }
  }
  return clean(link.text());
}

function findMangaLinks(doc) {
  const out = [];
  const seen = new Set();
  // Do not use attribute selectors here: keep this compatible with Harbor's DOM parser.
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
  if (!m) m = s.match(/\/([0-9]+(?:\.[0-9]+)?)(?:\/)?(?:\?|#|$)/);
  if (!m) m = s.match(/([0-9]+(?:\.[0-9]+)?)/);
  return m ? m[1] : null;
}

function chaptersFromDoc(doc) {
  const out = [];
  const seen = new Set();
  for (const a of doc.querySelectorAll("a")) {
    const href = abs(a.attr("href") || "");
    if (!href || seen.has(href)) continue;
    const path = href.replace(BASE, "");
    const m = path.match(/^\/manga\/([^/]+)\/([^/?#]+)\/?$/i);
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

const plugin = {
  id: "mangalik",
  name: "مانجا ليك",

  async popular(offset) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    // MangaLik's homepage is the reliable listing page. /manga/ is not the same listing.
    const path = page <= 1 ? "/" : "/page/" + page + "/";
    return findMangaLinks(await getDoc(path));
  },

  async search(query, offset) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const q = encodeURIComponent(String(query || "").trim());
    // WordPress/Madara search endpoint used by MangaLik.
    let path = "/?s=" + q + "&post_type=wp-manga";
    if (page > 1) path += "&page=" + page;
    return findMangaLinks(await getDoc(path));
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
    const doc = await getDoc("/manga/" + encodeURIComponent(id) + "/");
    return chaptersFromDoc(doc);
  },

  async pageUrls(chapterId) {
    let path = String(chapterId).replace(/^https?:\/\/[^/]+/i, "");
    if (!path.startsWith("/")) path = "/" + path;
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
