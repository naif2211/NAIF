// Harbor source for Azora Manga
const BASE = "https://azorafly.com";
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
    headers: {
      Referer: BASE + "/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    }
  }, options || {}));
  if (!res.ok) throw new Error("http " + res.status + " for " + path);
  return harbor.parseHtml(res.body || "");
}

function firstText(el, selectors) {
  for (const sel of selectors) {
    const x = el?.querySelector(sel);
    const t = clean(x?.text());
    if (t) return t;
  }
  return undefined;
}

function firstAttr(el, selectors, attrs) {
  for (const sel of selectors) {
    const x = el?.querySelector(sel);
    if (!x) continue;
    for (const attr of attrs) {
      const v = x.attr(attr);
      if (v) return v;
    }
  }
  return undefined;
}

function mangaIdFromHref(href) {
  if (!href) return null;
  const m = String(href).match(/\/series\/([^/?#]+)\/?(?:[?#].*)?$/i);
  return m ? decodeURIComponent(m[1]) : null;
}

function cardToSummary(el) {
  const link = el.querySelector("a[href^='/series/']") || el.querySelector("a");
  if (!link) return null;
  const href = link.attr("href") || "";
  const id = mangaIdFromHref(href);
  if (!id) return null;

  const img = el.querySelector("img");
  const title = clean(
    link.attr("title") ||
    firstText(el, ["h3", "h2", ".title", ".name"]) ||
    link.text()
  );
  if (!title) return null;

  return {
    id,
    title,
    cover: abs(img?.attr("data-src") || img?.attr("data-lazy-src") || img?.attr("data-original") || img?.attr("src"))
  };
}

function findCards(doc) {
  const selectors = [
    "div[class*='card']",
    "article",
    "div.relative.overflow-hidden"
  ];
  const out = [];
  const seen = new Set();

  for (const sel of selectors) {
    for (const el of doc.querySelectorAll(sel)) {
      const item = cardToSummary(el);
      if (item && !seen.has(item.id)) {
        seen.add(item.id);
        out.push(item);
      }
    }
    if (out.length) break;
  }
  return out;
}

function chapterNumber(text, href) {
  const s = clean(text) || String(href || "");
  let m = s.match(/(?:chapter|ch\.?|الفصل|فصل)\s*#?\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (!m) m = String(href || "").match(/\/chapter\/?([0-9]+(?:\.[0-9]+)?)\/?(?:\?|#|$)/i);
  if (!m) m = String(href || "").match(/\/([0-9]+(?:\.[0-9]+)?)\/?(?:\?|#|$)/);
  return m ? m[1] : null;
}

function chapterFromLink(a) {
  const href = abs(a.attr("href") || "");
  if (!href) return null;
  const rawHref = a.attr("href") || "";
  if (!/\/chapter(?:\/|\?|#|$)/i.test(rawHref) && !/\/series\/[^/]+\/[^/]+/i.test(rawHref)) return null;

  const title = clean(a.text());
  const number = a.attr("data-number") || chapterNumber(title, rawHref);
  if (!number) return null;

  return {
    id: href,
    chapter: number,
    title: title || "Chapter " + number,
    volume: null,
    pages: 0,
    language: "ar"
  };
}

function chaptersFromDoc(doc) {
  const out = [];
  const seen = new Set();

  const selectors = [
    "a[href*='/chapter']",
    "a[href*='/series/'][href$='/1']",
    "a[href*='/series/']"
  ];

  for (const sel of selectors) {
    for (const a of doc.querySelectorAll(sel)) {
      const c = chapterFromLink(a);
      if (!c || seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
    }
    if (out.length) break;
  }

  out.sort((a, b) => {
    const na = parseFloat(a.chapter);
    const nb = parseFloat(b.chapter);
    if (Number.isNaN(na) || Number.isNaN(nb)) return 0;
    return nb - na;
  });
  return out;
}

const plugin = {
  id: "azora",
  name: "Azora Manga",

  async popular(offset, tagId) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    let path = "/series?sort=popular&page=" + page;
    if (tagId) path += "&genre=" + encodeURIComponent(tagId);
    return findCards(await getDoc(path));
  },

  async search(query, offset, tagId) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    let path = "/series?searchTerm=" + encodeURIComponent(query) + "&page=" + page;
    if (tagId) path += "&genre=" + encodeURIComponent(tagId);
    return findCards(await getDoc(path));
  },

  async detail(id) {
    const doc = await getDoc("/series/" + encodeURIComponent(id));
    const root = doc.querySelector("main") || doc;
    return {
      id,
      title: clean(root.querySelector("h1")?.text()) || clean(root.querySelector("h2")?.text()) || id,
      cover: abs(firstAttr(root, ["img[src*='upload']", "img[src*='storage']", "img"], ["data-src", "data-lazy-src", "data-original", "src"])),
      altTitle: firstText(root, [".alternative", ".other-name", "[class*='alternative']"]),
      author: firstText(root, ["span:contains('المؤلف')", "div:contains('المؤلف')", "[class*='author']"]),
      status: firstText(root, ["span:contains('مستمر')", "span:contains('مكتمل')", "[class*='status']"]),
      description: firstAttr(root, ["meta[property='og:description']", "meta[name='description']"], ["content"]) || firstText(root, [".description", "[class*='description']"]),
      lastChapter: firstText(root, ["a[href*='/chapter']", "a[href*='/series/']"])
    };
  },

  async chapters(id) {
    const doc = await getDoc("/series/" + encodeURIComponent(id));
    return chaptersFromDoc(doc);
  },

  async pageUrls(chapterId) {
    const path = "/" + String(chapterId).replace(/^https?:\/\/[^/]+/i, "").replace(/^\//, "");
    const res = await harbor.http(BASE + path, {
      responseType: "text",
      timeoutMs: 30000,
      headers: {
        Referer: BASE + "/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
      }
    });
    if (!res.ok) throw new Error("http " + res.status + " for " + path);
    const doc = await harbor.parseHtml(res.body || "");
    const urls = [];
    const seen = new Set();

    for (const sel of [
      "img[src*='storage.azorafly.com']",
      "img[data-src*='storage.azorafly.com']",
      "img[src*='/upload/']",
      "img[data-src*='/upload/']",
      "main img",
      "article img"
    ]) {
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
    const doc = await getDoc("/series");
    const out = [];
    const seen = new Set();
    for (const a of doc.querySelectorAll("a[href*='/genre/'], a[href*='/genres/']")) {
      const name = clean(a.text());
      const href = a.attr("href") || "";
      const m = href.match(/\/(?:genre|genres)\/([^/?#]+)/i);
      if (!name || !m || seen.has(m[1])) continue;
      seen.add(m[1]);
      out.push({ id: decodeURIComponent(m[1]), name, group: "Genre" });
    }
    return out;
  }
};

return plugin;