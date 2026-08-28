// Harbor source for Azora Manga (azorafly.com)
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

async function getDoc(path) {
  const res = await harbor.http(BASE + path, {
    responseType: "text",
    timeoutMs: 30000,
    headers: {
      "Referer": BASE + "/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    }
  });
  if (!res.ok) throw new Error("http " + res.status + " for " + path);
  return harbor.parseHtml(res.body || "");
}

function attr(el, names) {
  if (!el) return undefined;
  for (const name of names) {
    const value = el.attr(name);
    if (value) return value;
  }
  return undefined;
}

function mangaId(href) {
  if (!href) return null;
  const cleanHref = String(href).replace(/^https?:\/\/[^/]+/i, "");
  const m = cleanHref.match(/^\/series\/([^/?#]+)\/?(?:[?#].*)?$/i);
  return m ? decodeURIComponent(m[1]) : null;
}

function findItems(doc) {
  const selectors = [
    "div[class*='card']",
    "article",
    "div.relative.overflow-hidden"
  ];
  const result = [];
  const seen = new Set();

  for (const selector of selectors) {
    for (const el of doc.querySelectorAll(selector)) {
      const link = el.querySelector("a[href^='/series/']");
      if (!link) continue;
      const id = mangaId(link.attr("href"));
      if (!id || seen.has(id)) continue;

      const title = clean(
        firstText(el, ["h3", "h2"]) ||
        link.attr("title") ||
        link.text()
      );
      if (!title) continue;

      const image = el.querySelector("img");
      const cover = abs(attr(image, ["src", "data-src", "data-lazy-src", "data-original"]));

      seen.add(id);
      result.push({ id, title, cover });
    }
    if (result.length) return result;
  }

  return result;
}

function firstText(root, selectors) {
  for (const selector of selectors) {
    const el = root?.querySelector(selector);
    const text = clean(el?.text());
    if (text) return text;
  }
  return undefined;
}

function firstAttr(root, selectors, attrs) {
  for (const selector of selectors) {
    const el = root?.querySelector(selector);
    const value = attr(el, attrs);
    if (value) return value;
  }
  return undefined;
}

function chapterNumber(href, text) {
  const url = String(href || "");
  const label = clean(text);

  let m = url.match(/\/chapter\/?([^/?#]+)\/?(?:[?#].*)?$/i);
  if (m) {
    const value = decodeURIComponent(m[1]);
    const n = value.match(/[0-9]+(?:\.[0-9]+)?/);
    if (n) return n[0];
  }

  m = label.match(/(?:الفصل|chapter|ch\.?|فصل)\s*#?\s*([0-9]+(?:\.[0-9]+)?)/i);
  return m ? m[1] : null;
}

function chapterFromLink(a) {
  const href = abs(a.attr("href") || "");
  if (!href || !/\/chapter(?:\/|\?|#|$)/i.test(href)) return null;

  const text = clean(a.text());
  const number = chapterNumber(href, text);
  if (!number) return null;

  return {
    id: href,
    chapter: number,
    title: text || "Chapter " + number,
    volume: null,
    pages: 0,
    language: "ar"
  };
}

function findChapters(doc) {
  const result = [];
  const seen = new Set();

  for (const a of doc.querySelectorAll("a[href*='/chapter']")) {
    const chapter = chapterFromLink(a);
    if (!chapter || seen.has(chapter.id)) continue;
    seen.add(chapter.id);
    result.push(chapter);
  }

  result.sort((a, b) => {
    const na = parseFloat(a.chapter);
    const nb = parseFloat(b.chapter);
    if (Number.isNaN(na) || Number.isNaN(nb)) return 0;
    return nb - na;
  });

  return result;
}

function imageUrl(img) {
  return abs(attr(img, [
    "src",
    "data-src",
    "data-lazy-src",
    "data-original"
  ]));
}

const plugin = {
  id: "azora",
  name: "Azora Manga",

  async popular(offset) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    return findItems(await getDoc("/series?sort=popular&page=" + page));
  },

  async search(query, offset) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    return findItems(await getDoc("/series?searchTerm=" + encodeURIComponent(query) + "&page=" + page));
  },

  async detail(id) {
    const doc = await getDoc("/series/" + encodeURIComponent(id));
    const root = doc.querySelector("main") || doc;

    return {
      id,
      title: clean(root.querySelector("h1")?.text()) || id,
      cover: firstAttr(root, ["img[src*='upload']", "img[src*='storage']", "img"], ["src", "data-src", "data-lazy-src", "data-original"]),
      description: firstAttr(root, ["meta[property='og:description']", "meta[name='description']"], ["content"]) || firstText(root, [".description", "[class*='description']"]),
      author: firstText(root, ["span", "div"]) && firstText(root, ["span:contains('المؤلف')", "div:contains('المؤلف')"]),
      status: firstText(root, ["span:contains('مستمر')", "span:contains('مكتمل')"]),
      lastChapter: firstText(root, ["a[href*='/chapter']"])
    };
  },

  async chapters(id) {
    const doc = await getDoc("/series/" + encodeURIComponent(id));
    return findChapters(doc);
  },

  async pageUrls(chapterId) {
    const path = "/" + String(chapterId).replace(/^https?:\/\/[^/]+/i, "").replace(/^\//, "");
    const doc = await getDoc(path);
    const urls = [];
    const seen = new Set();

    const selectors = [
      "img[src*='storage.azorafly.com']",
      "img[src*='/upload/']",
      "img[data-src*='storage.azorafly.com']",
      "img[data-src*='/upload/']",
      "main img",
      "article img"
    ];

    for (const selector of selectors) {
      for (const img of doc.querySelectorAll(selector)) {
        const url = imageUrl(img);
        if (!url || seen.has(url)) continue;
        seen.add(url);
        urls.push(url);
      }
      if (urls.length) break;
    }

    return urls;
  }
};

return plugin;
