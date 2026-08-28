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

async function getDoc(path) {
  const res = await harbor.http(BASE + path, {
    responseType: "text",
    timeoutMs: 30000,
    headers: {
      Referer: BASE + "/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    }
  });
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
    for (const name of attrs) {
      const v = x.attr(name);
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
  const title = clean(link.attr("title") || firstText(el, ["h1", "h2", "h3", "h4"]) || link.text());
  if (!title) return null;
  const img = el.querySelector("img");
  return {
    id,
    title,
    cover: abs(img?.attr("data-src") || img?.attr("data-lazy-src") || img?.attr("data-original") || img?.attr("src"))
  };
}

function findCards(doc) {
  const out = [];
  const seen = new Set();
  for (const sel of ["article", "div[class*='card']", "div.relative.overflow-hidden", "a[href^='/series/']"]) {
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
  m = String(href || "").match(/\/series\/[^/?#]+\/([0-9]+(?:\.[0-9]+)?)\/?(?:\?|#|$)/i);
  return m ? m[1] : null;
}

function chapterFromLink(a) {
  const href = abs(a.attr("href") || "");
  if (!href || !/\/series\/[^/?#]+\/[0-9]+(?:\.[0-9]+)?\/?(?:\?|#|$)/i.test(href)) return null;
  const title = clean(a.text());
  const number = chapterNumber(title, href);
  if (!number) return null;
  return { id: href, chapter: number, title: title || "الفصل " + number, volume: null, pages: 0, language: "ar" };
}

function chaptersFromDoc(doc) {
  const out = [];
  const seen = new Set();
  for (const a of doc.querySelectorAll("a[href]")) {
    const c = chapterFromLink(a);
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  out.sort((a, b) => parseFloat(b.chapter) - parseFloat(a.chapter));
  return out;
}

function addPage(url, urls, seen) {
  if (!url) return;
  url = abs(url);
  if (!url || seen.has(url)) return;
  if (/logo|avatar|favicon|icon|banner|sprite/i.test(url)) return;
  seen.add(url);
  urls.push(url);
}

function pageUrlsFromDoc(doc) {
  const urls = [];

  // On OlympusStaff each page is exposed as an image link. Read the link itself
  // first, because the visible <img> can contain a thumbnail while <a href>
  // contains the full-resolution page.
  const seen = new Set();
  for (const a of doc.querySelectorAll("a[href]")) {
    const href = a.attr("href") || "";
    if (!/\.(?:jpe?g|png|webp|gif)(?:\?|#|$)/i.test(href)) continue;
    if (!/(?:\/uploads\/|\/wp-content\/uploads\/)/i.test(href)) continue;
    addPage(href, urls, seen);
  }

  // Read every image, not just the first matching selector.
  for (const img of doc.querySelectorAll("img")) {
    addPage(img.attr("data-src"), urls, seen);
    addPage(img.attr("data-lazy-src"), urls, seen);
    addPage(img.attr("data-original"), urls, seen);
    addPage(img.attr("src"), urls, seen);
  }

  // Some versions expose page URLs in data attributes on containers.
  for (const el of doc.querySelectorAll("[data-src], [data-image], [data-url]")) {
    addPage(el.attr("data-src"), urls, seen);
    addPage(el.attr("data-image"), urls, seen);
    addPage(el.attr("data-url"), urls, seen);
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
    for (const path of [
      "/series?search=" + encodeURIComponent(query) + "&page=" + page,
      "/series?searchTerm=" + encodeURIComponent(query) + "&page=" + page,
      "/series/?search=" + encodeURIComponent(query) + "&page=" + page
    ]) {
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
      cover: firstAttr(root, ["img"], ["data-src", "data-lazy-src", "data-original", "src"]),
      author: firstText(root, [".author", ".artist", ".writer"]),
      status: firstText(root, [".status"]),
      description: firstText(root, [".description", ".summary", ".entry-content", ".manga-description"]),
      lastChapter: firstText(root, ["a[href*='/series/'][href*='/1']", "a[href*='/series/']"])
    };
  },

  async chapters(id) {
    return chaptersFromDoc(await getDoc("/series/" + encodeURIComponent(id)));
  },

  async pageUrls(chapterId) {
    const path = "/" + String(chapterId).replace(/^https?:\/\/[^/]+/i, "").replace(/^\//, "");
    return pageUrlsFromDoc(await getDoc(path));
  },

  async tags() {
    return [];
  }
};

return plugin;
