// Harbor source for stellarsaber.pro
// The site is a WordPress/Madara catalogue with direct chapter permalinks.
const BASE = "https://stellarsaber.pro";
const PAGE_SIZE = 24;

function clean(value) {
  return value ? String(value).replace(/\s+/g, " ").trim() : "";
}

function abs(url) {
  if (!url) return undefined;
  const value = String(url).trim();
  if (!value || /^data:/i.test(value) || /^javascript:/i.test(value)) return undefined;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("//")) return "https:" + value;
  if (value.startsWith("/")) return BASE + value;
  return BASE + "/" + value;
}

async function getDoc(path) {
  const url = /^https?:\/\//i.test(path) ? path : BASE + path;
  const res = await harbor.http(url, {
    responseType: "text",
    timeoutMs: 30000,
    headers: { Referer: BASE + "/" }
  });
  if (!res.ok) throw new Error("http " + res.status + " for " + url);
  return harbor.parseHtml(res.body || "");
}

function mangaIdFromHref(href) {
  const url = abs(href);
  if (!url) return null;
  try {
    const parsed = new URL(url, BASE);
    if (parsed.hostname !== new URL(BASE).hostname) return null;
    const match = parsed.pathname.match(/^\/manga\/([^/?#]+)\/?$/i);
    return match ? decodeURIComponent(match[1]) : null;
  } catch (_) {
    return null;
  }
}

function firstText(root, selectors) {
  for (const selector of selectors) {
    const value = clean(root?.querySelector(selector)?.text());
    if (value) return value;
  }
  return undefined;
}

function firstImage(root) {
  for (const image of root?.querySelectorAll("img") || []) {
    const url = imageUrl(image);
    if (url) return url;
  }
  return undefined;
}

function imageUrl(img) {
  if (!img) return undefined;
  for (const attr of [
    "data-src", "data-lazy-src", "data-original", "data-cfsrc", "data-lazy",
    "data-image", "data-full", "src"
  ]) {
    const value = img.attr(attr);
    if (value && !/^data:/i.test(value)) return abs(value);
  }
  for (const attr of ["data-srcset", "srcset"]) {
    const srcset = img.attr(attr);
    if (!srcset) continue;
    const first = srcset.split(",")[0].trim().split(/\s+/)[0];
    if (first && !/^data:/i.test(first)) return abs(first);
  }
  return undefined;
}

function cardFromElement(el) {
  const link = el.querySelector(".post-title a, .item-summary a[href*='/manga/'], a[href*='/manga/']");
  if (!link) return null;
  const id = mangaIdFromHref(link.attr("href"));
  if (!id) return null;
  const title = clean(
    link.attr("title") ||
    firstText(el, [".post-title", ".item-summary h3", ".summary_content h3", "h3", "h2"]) ||
    link.text()
  );
  if (!title) return null;
  return { id, title, cover: firstImage(el) };
}

function findCards(doc) {
  const cards = [];
  const seen = new Set();
  const selectors = [
    ".c-tabs-item__content",
    ".page-item-detail.manga",
    ".page-item-detail",
    ".row.c-tabs-item__content",
    ".manga-item",
    ".manga__item",
    ".item-summary"
  ];
  for (const selector of selectors) {
    for (const el of doc.querySelectorAll(selector)) {
      const card = cardFromElement(el);
      if (card && !seen.has(card.id)) {
        seen.add(card.id);
        cards.push(card);
      }
    }
    if (cards.length) break;
  }
  return cards;
}

function chapterNumber(title, href) {
  const source = clean(title) || decodeURIComponent(String(href || ""));
  let match = source.match(/(?:chapter|ch\.?)\s*#?\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (!match) match = source.match(/(?:^|[-_\s/])([0-9]+(?:\.[0-9]+)?)(?:[-_\s/?#]|$)/);
  return match ? match[1] : undefined;
}

function chaptersFromDoc(doc) {
  const chapters = [];
  const seen = new Set();
  // Chapter URLs here are top-level permalinks, not /chapter/... paths.
  const selectors = [
    "li.wp-manga-chapter a[href]",
    ".version-chap li a[href]",
    ".wp-manga-chapter a[href]",
    ".main.version-chap a[href]"
  ];
  for (const selector of selectors) {
    for (const link of doc.querySelectorAll(selector)) {
      const id = abs(link.attr("href"));
      if (!id || seen.has(id)) continue;
      const title = clean(link.text()) || clean(link.attr("title"));
      const chapter = chapterNumber(title, id);
      if (!title && !chapter) continue;
      seen.add(id);
      chapters.push({
        id,
        chapter: chapter || title,
        title: title || (chapter ? "Chapter " + chapter : undefined),
        volume: null,
        pages: 0,
        language: "ar"
      });
    }
    if (chapters.length) break;
  }
  return chapters.sort((a, b) => (parseFloat(b.chapter) || 0) - (parseFloat(a.chapter) || 0));
}

function pageImages(doc) {
  const urls = [];
  const seen = new Set();
  const add = url => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  };
  const selectors = [
    ".reading-content .page-break img",
    ".reading-content img",
    ".wp-manga-chapter-img img",
    ".page-break img",
    ".chapter-content img",
    ".entry-content .page-break img"
  ];
  for (const selector of selectors) {
    for (const image of doc.querySelectorAll(selector)) add(imageUrl(image));
    if (urls.length) return urls;
  }
  // Some StellarSaber chapters are plain WordPress posts without Madara wrappers.
  for (const image of doc.querySelectorAll("article .entry-content img, article .post-content img")) add(imageUrl(image));
  return urls;
}

const plugin = {
  id: "stellarsaber",
  name: "StellarSaber",

  async popular(offset) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    return findCards(await getDoc("/manga/?m_orderby=latest&page=" + page)).slice(0, PAGE_SIZE);
  },

  async search(query, offset) {
    const term = clean(query);
    if (!term) return [];
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const path = "/manga/?s=" + encodeURIComponent(term) + "&post_type=wp-manga&page=" + page;
    return findCards(await getDoc(path)).slice(0, PAGE_SIZE);
  },

  async detail(id) {
    const doc = await getDoc("/manga/" + encodeURIComponent(id) + "/");
    const root = doc.querySelector(".site-content") || doc;
    return {
      id,
      title: firstText(root, [".post-title h1", ".post-title", "h1.entry-title", "h1"]) || id,
      cover: firstImage(root.querySelector(".summary_image, .manga-thumb, .profile-manga, .tab-summary") || root),
      description: firstText(root, [".summary__content", ".description-summary", ".summary_content", ".post-content", ".entry-content"])
    };
  },

  async chapters(id) {
    return chaptersFromDoc(await getDoc("/manga/" + encodeURIComponent(id) + "/"));
  },

  async pageUrls(chapterId) {
    const urls = pageImages(await getDoc(chapterId));
    if (!urls.length) throw new Error("No chapter page images found");
    return urls;
  }
};

return plugin;

