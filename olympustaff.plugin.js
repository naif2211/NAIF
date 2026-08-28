// Harbor source for OlympusStaff / Team-X
// Site: https://olympustaff.com
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
  return new URL(url, BASE).toString();
}

async function getDoc(url, options) {
  const res = await harbor.http(url, Object.assign({
    responseType: "text",
    timeoutMs: 30000,
    headers: { Referer: BASE + "/" }
  }, options || {}));
  if (!res.ok) throw new Error("http " + res.status + " for " + url);
  return harbor.parseHtml(res.body || "");
}

function text(el) {
  return clean(el?.text());
}

function firstText(root, selectors) {
  for (const sel of selectors) {
    const el = root?.querySelector(sel);
    const value = text(el);
    if (value) return value;
  }
  return undefined;
}

function firstAttr(root, selectors, attrs) {
  for (const sel of selectors) {
    const el = root?.querySelector(sel);
    if (!el) continue;
    for (const attr of attrs) {
      const value = el.attr(attr);
      if (value) return abs(value);
    }
  }
  return undefined;
}

function chapterNumber(value) {
  const s = clean(value);
  let m = s.match(/(?:chapter|chap|الفصل|فصل)\s*[-_.:#]*\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (m) return m[1];
  m = s.match(/(?:^|\/)([0-9]+(?:\.[0-9]+)?)(?:\/?(?:\?|#|$))/);
  if (m) return m[1];
  const nums = s.match(/[0-9]+(?:\.[0-9]+)?/g);
  return nums?.length ? nums[nums.length - 1] : null;
}

function mangaIdFromHref(href) {
  if (!href) return null;
  const m = String(href).match(/\/series\/([^/?#]+)\/?$/i);
  return m ? m[1] : null;
}

function cardToSummary(a) {
  const href = a.attr("href") || "";
  const id = mangaIdFromHref(href);
  const title = text(a);
  if (!id || !title || title.length < 2) return null;
  if (/قائمة المانجا|الرئيسية|الفرق|الاخبار|العضويات/i.test(title)) return null;

  const img = a.querySelector("img") || a.parentElement?.querySelector("img");
  return {
    id,
    title,
    cover: abs(img?.attr("data-src") || img?.attr("data-lazy-src") || img?.attr("data-original") || img?.attr("src"))
  };
}

function findCards(doc) {
  const out = [];
  const seen = new Set();

  for (const a of doc.querySelectorAll('a[href*="/series/"]')) {
    const item = cardToSummary(a);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

function chaptersFromDoc(doc) {
  const out = [];
  const seen = new Set();

  for (const a of doc.querySelectorAll('a[href]')) {
    const href = a.attr("href") || "";
    const label = text(a);
    if (!href || !label) continue;

    // Chapter links on OlympusStaff are /series/<slug>/<chapter>.
    if (!/\/series\/[^/]+\/[^/?#]+/i.test(href)) continue;
    if (!/(الفصل|فصل|chapter|chap)/i.test(label)) continue;

    const number = chapterNumber(label + " " + href);
    if (!number) continue;

    const url = abs(href);
    if (!url || seen.has(url)) continue;
    seen.add(url);

    out.push({
      id: url,
      chapter: number,
      title: label,
      volume: null,
      pages: 0,
      language: "ar"
    });
  }

  out.sort((a, b) => Number(b.chapter) - Number(a.chapter));
  return out;
}

const plugin = {
  id: "olympustaff",
  name: "OlympusStaff",

  async popular(offset) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    return findCards(await getDoc(BASE + "/series?page=" + page));
  },

  async search(query, offset) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const paths = [
      "/series?search=" + encodeURIComponent(query) + "&page=" + page,
      "/series/?search=" + encodeURIComponent(query) + "&page=" + page
    ];

    for (const path of paths) {
      try {
        const list = findCards(await getDoc(BASE + path));
        if (list.length) return list;
      } catch (_) {}
    }
    return [];
  },

  async detail(id) {
    const doc = await getDoc(BASE + "/series/" + encodeURIComponent(id));
    const root = doc.querySelector("main") || doc.querySelector(".container") || doc;

    return {
      id,
      title: firstText(root, ["h1", "h2", "h3"]) || id,
      altTitle: firstText(root, [".alternative", ".other-name"]),
      cover: firstAttr(root, ["img"], ["data-src", "data-lazy-src", "data-original", "src"]),
      author: firstText(root, [".author", ".artist", ".writer"]),
      status: firstText(root, [".status", "a[href*='status']"]),
      description: firstText(root, [".description", ".summary", ".entry-content", ".manga-description"]),
      lastChapter: firstText(root, ["a[href*='/series/'][href*='/']"])
    };
  },

  async chapters(id) {
    const doc = await getDoc(BASE + "/series/" + encodeURIComponent(id));
    return chaptersFromDoc(doc);
  },

  async pageUrls(chapterId) {
    const url = abs(chapterId);
    if (!url) return [];

    const doc = await getDoc(url);
    const urls = [];
    const seen = new Set();

    const selectors = [
      "img[data-src]",
      "img[data-lazy-src]",
      ".reader img",
      ".reading-content img",
      ".chapter-content img",
      ".entry-content img",
      "img[src]"
    ];

    for (const sel of selectors) {
      for (const img of doc.querySelectorAll(sel)) {
        const src = img.attr("data-src") || img.attr("data-lazy-src") || img.attr("data-original") || img.attr("src");
        const u = abs(src);
        if (!u || seen.has(u)) continue;
        if (/logo|avatar|favicon|icon|banner|ads?\b/i.test(u)) continue;
        seen.add(u);
        urls.push(u);
      }
      if (urls.length) break;
    }

    return urls;
  },

  async tags() {
    const doc = await getDoc(BASE + "/series");
    const out = [];
    const seen = new Set();

    for (const a of doc.querySelectorAll('a[href]')) {
      const href = a.attr("href") || "";
      const name = text(a);
      const m = href.match(/\/(?:genre|type|category)\/([^/?#]+)/i);
      if (!m || !name || seen.has(m[1])) continue;
      seen.add(m[1]);
      out.push({ id: decodeURIComponent(m[1]), name, group: "Genre" });
    }
    return out;
  }
};

return plugin;
