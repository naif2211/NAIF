// Harbor source for OlympusStaff
const BASE = "https://olympustaff.com";
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
      if (v) return abs(v);
    }
  }
  return undefined;
}

function mangaIdFromHref(href) {
  if (!href) return null;
  const s = String(href).replace(/^https?:\/\/[^/]+/i, "");
  const m = s.match(/^\/series\/([^/?#]+)\/?$/i);
  return m ? decodeURIComponent(m[1]) : null;
}

function cardToSummary(el) {
  const link = el.querySelector("a[href^='/series/']");
  if (!link) return null;

  const id = mangaIdFromHref(link.attr("href") || "");
  if (!id) return null;

  const title = clean(
    link.attr("title") ||
    firstText(el, ["h1", "h2", "h3", "h4"]) ||
    link.text()
  );
  if (!title || title.length < 2) return null;

  const img = el.querySelector("img");
  return {
    id,
    title,
    cover: abs(img?.attr("data-src") || img?.attr("data-lazy-src") || img?.attr("data-original") || img?.attr("src"))
  };
}

function findCards(doc) {
  const selectors = [
    "article",
    "div[class*='card']",
    "div.relative.overflow-hidden",
    "a[href^='/series/']"
  ];

  const out = [];
  const seen = new Set();

  for (const sel of selectors) {
    for (const el of doc.querySelectorAll(sel)) {
      const item = sel === "a[href^='/series/']" ? cardToSummary(el.parentElement || el) : cardToSummary(el);
      if (item && !seen.has(item.id)) {
        seen.add(item.id);
        out.push(item);
      }
    }
    if (out.length) return out;
  }
  return out;
}

function chapterNumber(text, href) {
  const label = clean(text);
  let m = label.match(/(?:الفصل|فصل|chapter|chap)\s*(?:رقم)?\s*#?\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (m) return m[1];

  const s = String(href || "");
  m = s.match(/\/series\/[^/?#]+\/([0-9]+(?:\.[0-9]+)?)\/?(?:\?|#|$)/i);
  return m ? m[1] : null;
}

function isChapterHref(href) {
  return /\/series\/[^/?#]+\/[0-9]+(?:\.[0-9]+)?\/?(?:\?|#|$)/i.test(String(href || ""));
}

function chapterFromLink(a) {
  const href = abs(a.attr("href") || "");
  if (!href || !isChapterHref(href)) return null;

  const title = clean(a.text());
  const number = chapterNumber(title, href);
  if (!number) return null;

  return {
    id: href,
    chapter: number,
    title: title || "الفصل " + number,
    volume: null,
    pages: 0,
    language: "ar"
  };
}

function chaptersFromDoc(doc) {
  const out = [];
  const seen = new Set();

  for (const a of doc.querySelectorAll("a[href]")) {
    const chapter = chapterFromLink(a);
    if (!chapter || seen.has(chapter.id)) continue;
    seen.add(chapter.id);
    out.push(chapter);
  }

  out.sort((a, b) => {
    const na = parseFloat(a.chapter);
    const nb = parseFloat(b.chapter);
    if (Number.isNaN(na) || Number.isNaN(nb)) return 0;
    return nb - na;
  });

  return out;
}

function pageImageUrl(img) {
  return abs(
    img?.attr("data-src") ||
    img?.attr("data-lazy-src") ||
    img?.attr("data-original") ||
    img?.attr("src")
  );
}

function pageUrlsFromDoc(doc) {
  const urls = [];
  const seen = new Set();

  // OlympusStaff exposes each manga page as a direct /uploads/... image link.
  for (const a of doc.querySelectorAll("a[href*='/uploads/']")) {
    const href = abs(a.attr("href") || "");
    if (!href || !/\/uploads\/.*\.(?:jpg|jpeg|png|webp|gif)(?:\?|#|$)/i.test(href)) continue;
    if (/logo|avatar|favicon|icon|banner|ads?\b/i.test(href)) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    urls.push(href);
  }

  // Fallback for pages where the image is present without an anchor.
  if (!urls.length) {
    const selectors = [
      "img[alt*='episode']",
      "img[src*='/uploads/']",
      "img[data-src*='/uploads/']",
      "img[data-lazy-src*='/uploads/']",
      ".reading-content img",
      ".chapter-content img"
    ];

    for (const sel of selectors) {
      for (const img of doc.querySelectorAll(sel)) {
        const url = pageImageUrl(img);
        if (!url || seen.has(url)) continue;
        if (/logo|avatar|favicon|icon|banner|ads?\b/i.test(url)) continue;
        seen.add(url);
        urls.push(url);
      }
      if (urls.length) break;
    }
  }

  return urls;
}

const plugin = {
  id: "olympustaff",
  name: "OlympusStaff",

  async popular(offset) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    return findCards(await getDoc("/series?page=" + page));
  },

  async search(query, offset) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const paths = [
      "/series?search=" + encodeURIComponent(query) + "&page=" + page,
      "/series?searchTerm=" + encodeURIComponent(query) + "&page=" + page,
      "/series/?search=" + encodeURIComponent(query) + "&page=" + page
    ];

    for (const path of paths) {
      try {
        const list = findCards(await getDoc(path));
        if (list.length) return list;
      } catch (_) {}
    }
    return [];
  },

  async detail(id) {
    const doc = await getDoc("/series/" + encodeURIComponent(id));
    const root = doc.querySelector("main") || doc.querySelector(".container") || doc;

    return {
      id,
      title: clean(root.querySelector("h1")?.text()) || clean(root.querySelector("h2")?.text()) || id,
      altTitle: firstText(root, [".alternative", ".other-name"]),
      cover: firstAttr(root, ["img"], ["data-src", "data-lazy-src", "data-original", "src"]),
      author: firstText(root, [".author", ".artist", ".writer"]),
      status: firstText(root, [".status"]),
      description: firstText(root, [".description", ".summary", ".entry-content", ".manga-description"]),
      lastChapter: firstText(root, ["a[href*='/series/'][href*='/1']", "a[href*='/series/']"])
    };
  },

  async chapters(id) {
    const doc = await getDoc("/series/" + encodeURIComponent(id));
    return chaptersFromDoc(doc);
  },

  async pageUrls(chapterId) {
    const path = "/" + String(chapterId).replace(/^https?:\/\/[^/]+/i, "").replace(/^\//, "");
    const doc = await getDoc(path);
    return pageUrlsFromDoc(doc);
  },

  async tags() {
    const doc = await getDoc("/series");
    const out = [];
    const seen = new Set();

    for (const a of doc.querySelectorAll("a[href]")) {
      const name = clean(a.text());
      const href = a.attr("href") || "";
      const m = href.match(/\/(?:genre|type|category)\/([^/?#]+)/i);
      if (!name || !m || seen.has(m[1])) continue;
      seen.add(m[1]);
      out.push({ id: decodeURIComponent(m[1]), name, group: "Genre" });
    }

    return out;
  }
};

return plugin;
