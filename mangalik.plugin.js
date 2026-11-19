// MangaLik source for Harbor
// Fix duplicate manga cards/covers and load Madara chapter lists (including AJAX).
const BASE = "https://mangalik.net";
const PAGE_SIZE = 10;
const CHAPTER_SUFFIX = "?style=list";

function clean(v) {
  return v ? String(v).replace(/\s+/g, " ").trim() : "";
}
function abs(url) {
  if (!url) return undefined;
  const u = String(url).trim();
  if (!u || u.startsWith("data:") || u.startsWith("blob:")) return undefined;
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith("//")) return "https:" + u;
  if (u.startsWith("/")) return BASE + u;
  return BASE + "/" + u;
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
function firstText(el, selectors) {
  for (const s of selectors) {
    const t = clean(el?.querySelector(s)?.text());
    if (t) return t;
  }
  return "";
}
function firstAttr(el, selectors, attrs) {
  for (const s of selectors) {
    const node = el?.querySelector(s);
    if (!node) continue;
    for (const a of attrs) {
      const v = node.attr(a);
      if (v) return v;
    }
  }
  return undefined;
}
function mangaId(href) {
  const p = (abs(href) || "").replace(/^https?:\/\/[^/]+/i, "");
  const m = p.match(/^\/manga\/([^/?#]+)\/?(?:[?#].*)?$/i);
  return m ? decodeURIComponent(m[1]) : null;
}
function imageFrom(el) {
  if (!el) return undefined;
  const img = el.querySelector("img");
  if (!img) return undefined;
  return abs(img.attr("data-src") || img.attr("data-lazy-src") ||
    img.attr("data-original") || img.attr("data-cfsrc") || img.attr("src"));
}
function cardFromContainer(el) {
  const a = el.querySelector("a[href*='/manga/']");
  if (!a) return null;
  const id = mangaId(a.attr("href") || "");
  if (!id) return null;
  const title = clean(a.attr("title")) ||
    firstText(el, [".post-title", ".manga-title", ".tt", "h2", "h3", "h4"]) ||
    clean(a.text()) || id;
  return { id, title, cover: imageFrom(el) || imageFrom(a) };
}
function cards(doc) {
  const out = [];
  const seen = new Set();
  // Collect from every known card layout. Do not stop at the first selector:
  // some listing pages mix card types and that caused only a small subset
  // (often seven entries) to be returned.
  const selectors = [
    ".c-tabs-item__content",
    ".page-item-detail",
    ".manga__item",
    ".manga-item",
    ".bs",
    ".bsx",
    ".listupd .item",
    ".listupd article",
    "article",
    ".item"
  ];
  for (const sel of selectors) {
    for (const el of doc.querySelectorAll(sel)) {
      const item = cardFromContainer(el);
      if (item && !seen.has(item.id)) {
        seen.add(item.id);
        out.push(item);
      }
    }
  }
  // Fallback / catch cards missed by theme-specific containers.
  for (const a of doc.querySelectorAll("a[href*='/manga/']")) {
    const id = mangaId(a.attr("href") || "");
    if (!id || seen.has(id)) continue;
    const title = clean(a.attr("title")) || clean(a.text()) ||
      clean(a.querySelector("img")?.attr("alt")) || id;
    out.push({ id, title, cover: imageFrom(a) });
    seen.add(id);
  }
  return out;
}
function chapterNumber(label, slug) {
  let m = clean(label).match(/(?:chapter|ch\.?|الفصل|فصل)\s*#?\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (!m) m = String(slug || "").match(/(?:chapter|ch)[-\s_]*([0-9]+(?:\.[0-9]+)?)/i);
  if (!m) m = String(slug || "").match(/([0-9]+(?:\.[0-9]+)?)/);
  return m ? m[1] : (slug || "");
}
function chapterFromElement(item) {
  const a = item.querySelector("a[href]");
  if (!a) return null;
  const href = a.attr("href") || "";
  const url = abs(href);
  if (!url) return null;

  // Madara's own parser keeps the final URL segment as the chapter key.
  // Do not require the chapter URL to repeat the manga slug: some MangaLik
  // series use alternate paths and the old check discarded valid chapters.
  const path = url.replace(/^https?:\/\/[^/]+/i, "").split(/[?#]/)[0];
  const slug = decodeURIComponent(path.replace(/\/$/, "").split("/").pop() || "");
  if (!slug) return null;

  const label = clean(a.text()) || clean(a.attr("title")) || slug;
  const number = a.attr("data-number") || chapterNumber(label, slug);
  if (!number) return null;

  return {
    id: url,
    chapter: number,
    title: label || "الفصل " + number,
    volume: null,
    pages: 0,
    language: "ar"
  };
}

function chaptersFromDoc(doc) {
  const out = [];
  const seen = new Set();

  // The official Madara implementation parses each li.wp-manga-chapter,
  // then reads its first anchor. Keep the response scoped to this manga
  // instead of filtering by an assumed URL layout.
  for (const item of doc.querySelectorAll("li.wp-manga-chapter, .wp-manga-chapter")) {
    const chapter = chapterFromElement(item);
    if (chapter && !seen.has(chapter.id)) {
      seen.add(chapter.id);
      out.push(chapter);
    }
  }

  // Some themes return the same list without li wrappers.
  if (!out.length) {
    for (const a of doc.querySelectorAll(".listing-chapters_wrap a[href], .version-chap a[href]")) {
      const chapter = chapterFromElement({ querySelector: (selector) => selector === "a[href]" ? a : null });
      if (chapter && !seen.has(chapter.id)) {
        seen.add(chapter.id);
        out.push(chapter);
      }
    }
  }

  out.sort((a, b) => {
    const x = parseFloat(a.chapter), y = parseFloat(b.chapter);
    if (Number.isNaN(x) || Number.isNaN(y)) return 0;
    return y - x;
  });
  return out;
}
function postId(doc) {
  // Match the ID discovery used by the established MangaLek Madara source.
  const selectors = [
    "[id^='manga-chapters-holder']",
    "input.rating-post-id",
    "a[data-post]",
    "link[rel='shortlink']"
  ];
  for (const selector of selectors) {
    const el = doc.querySelector(selector);
    if (!el) continue;
    let value = el.attr("data-id") || el.attr("value") || el.attr("data-post") || el.attr("href");
    if (!value) continue;
    const shortlink = String(value).match(/[?&]p=(\d+)/);
    if (shortlink) value = shortlink[1];
    if (/^\d+$/.test(String(value))) return String(value);
  }
  return null;
}
function formEncode(obj) {
  return Object.keys(obj).filter(k => obj[k] !== undefined && obj[k] !== null)
    .map(k => encodeURIComponent(k) + "=" + encodeURIComponent(String(obj[k]))).join("&");
}
async function chapterList(id) {
  const mangaPath = "/manga/" + encodeURIComponent(id) + "/";
  let doc = await getDoc(mangaPath);
  let list = chaptersFromDoc(doc);
  if (list.length) return list;

  // Madara-based MangaLik may populate the chapter list through admin-ajax.
  const pid = postId(doc);
  if (pid) {
    try {
      const res = await harbor.http(BASE + "/wp-admin/admin-ajax.php", {
        method: "POST",
        responseType: "text",
        timeoutMs: 30000,
        headers: {
          "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
          "x-requested-with": "XMLHttpRequest",
          Referer: BASE + mangaPath
        },
        body: formEncode({ action: "manga_get_chapters", manga: pid })
      });
      if (res.ok) {
        list = chaptersFromDoc(await harbor.parseHtml(res.body || ""));
        if (list.length) return list;
      }
    } catch (_) {}
  }
  try {
    const res = await harbor.http(BASE + mangaPath.replace(/\/$/, "") + "/ajax/chapters/", {
      method: "POST",
      responseType: "text",
      timeoutMs: 30000,
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-requested-with": "XMLHttpRequest",
        Referer: BASE + mangaPath
      },
      body: ""
    });
    if (res.ok) {
      list = chaptersFromDoc(await harbor.parseHtml(res.body || ""));
      if (list.length) return list;
    }
  } catch (_) {}
  return [];
}
function pageImageUrl(img) {
  return abs(img.attr("data-src") || img.attr("data-lazy-src") ||
    img.attr("data-original") || img.attr("data-cfsrc") ||
    img.attr("data-url") || img.attr("src"));
}

const plugin = {
  id: "mangalik",
  name: "مانجا ليك",

  async popular(offset, tagId) {
    const page = Math.floor((Number(offset) || 0) / PAGE_SIZE) + 1;
    let path = "/manga/page/" + page + "/?m_orderby=views";
    if (tagId) path += "&genre=" + encodeURIComponent(tagId);
    const items = cards(await getDoc(path));
    if (items.length) return items;
    return cards(await getDoc(page === 1 ? "/manga/" : "/manga/page/" + page + "/"));
  },

  async search(query, offset, tagId) {
    const q = clean(query);
    if (!q) return [];
    const page = Math.floor((Number(offset) || 0) / PAGE_SIZE) + 1;
    let path = "/manga/?s=" + encodeURIComponent(q) +
      "&post_type=wp-manga&page=" + page;
    if (tagId) path += "&genre=" + encodeURIComponent(tagId);
    let items = cards(await getDoc(path));
    if (items.length) return items;
    path = "/?s=" + encodeURIComponent(q) + "&page=" + page;
    return cards(await getDoc(path));
  },

  async detail(id) {
    const doc = await getDoc("/manga/" + encodeURIComponent(id) + "/");
    const root = doc.querySelector(".site-content") || doc;
    const cover = firstAttr(root, [
      ".tab-summary .summary_image img",
      ".summary_image img",
      ".profile-manga .summary_image img",
      ".summary_image"
    ], ["data-src", "data-lazy-src", "data-original", "src"]) ||
      firstAttr(doc, ["meta[property='og:image']"], ["content"]);
    return {
      id,
      title: firstText(root, ["div.post-title h1", "h1"]) || id,
      cover: abs(cover),
      description: firstText(root, [".summary__content", ".description-summary", ".description"]),
      status: firstText(root, [".post-content_item.manga-status .summary-content", ".manga-status .summary-content"]),
      author: firstText(root, [".author-content", ".post-content_item.manga-authors .summary-content"])
    };
  },

  async chapters(id) {
    return chapterList(id);
  },

  async pageUrls(chapterId) {
    const raw = String(chapterId || "");
    const path = "/" + raw.replace(/^https?:\/\/[^/]+/i, "").replace(/^\//, "");
    const res = await harbor.http(BASE + path, {
      responseType: "text",
      timeoutMs: 30000,
      headers: { Referer: BASE + "/" }
    });
    if (!res.ok) throw new Error("http " + res.status + " for " + path);
    const doc = await harbor.parseHtml(res.body || "");
    const urls = [];
    const seen = new Set();
    for (const sel of [
      ".reading-content .page-break img",
      ".reading-content img",
      ".page-break img",
      ".wp-manga-chapter-img",
      ".entry-content img"
    ]) {
      for (const img of doc.querySelectorAll(sel)) {
        const u = pageImageUrl(img);
        if (u && !seen.has(u)) {
          seen.add(u);
          urls.push(u);
        }
      }
      if (urls.length) break;
    }
    return urls;
  }
};
return plugin;