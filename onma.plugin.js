// Harbor source for onma.me (مانجا اون لاين)
const BASE = "https://onma.me";
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

function imageUrl(img) {
  if (!img) return undefined;
  return abs(
    img.attr("data-src") ||
    img.attr("data-lazy-src") ||
    img.attr("data-original") ||
    img.attr("data-image") ||
    img.attr("data-url") ||
    img.attr("src")
  );
}

function mangaIdFromHref(href) {
  if (!href) return null;
  const s = String(href).replace(/^https?:\/\/[^/]+/i, "");
  const m = s.match(/^\/manga\/([^/?#]+)\/?(?:[?#].*)?$/i);
  return m ? decodeURIComponent(m[1]) : null;
}

function cardToSummary(el) {
  const link = el.querySelector("a[href^='/manga/']") || el.querySelector("a[href*='/manga/']");
  if (!link) return null;
  const id = mangaIdFromHref(link.attr("href") || "");
  if (!id) return null;

  const title = clean(
    firstText(el, [".post-title h3", ".post-title h4", ".post-title", "h3", "h4", ".item-summary .summary-content .post-title"]) ||
    link.attr("title") ||
    link.attr("aria-label") ||
    el.querySelector("img")?.attr("alt") ||
    link.text()
  );
  if (!title) return null;

  return {
    id,
    title,
    cover: imageUrl(el.querySelector("img"))
  };
}

function findCards(doc) {
  const selectors = [
    "div.page-item-detail",
    ".page-item-detail.manga",
    ".manga-item",
    ".row.c-tabs-item__content",
    ".item-summary",
    "article"
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
    if (out.length) return out;
  }

  for (const a of doc.querySelectorAll("a[href^='/manga/']")) {
    const id = mangaIdFromHref(a.attr("href") || "");
    if (!id || seen.has(id)) continue;
    const title = clean(a.attr("title") || a.attr("aria-label") || a.text() || a.querySelector("img")?.attr("alt"));
    if (!title) continue;
    const parent = a.parentElement;
    seen.add(id);
    out.push({ id, title, cover: imageUrl(parent?.querySelector("img") || a.querySelector("img")) });
  }

  return out;
}

function chapterNumber(text, href) {
  const label = clean(text);
  let m = label.match(/(?:^|\s)#?\s*([0-9]+(?:\.[0-9]+)?)(?:\s|:|$)/);
  if (m) return m[1];

  const url = String(href || "");
  m = url.match(/\/manga\/[^/]+\/([0-9]+(?:\.[0-9]+)?)\/?(?:[?#].*)?$/i);
  return m ? m[1] : null;
}

function chapterFromLink(a) {
  const raw = a.attr("href") || "";
  const href = abs(raw);
  if (!href) return null;
  if (!/^\/manga\/[^/]+\/[^/]+/i.test(raw.replace(/^https?:\/\/[^/]+/i, ""))) return null;

  const title = clean(a.text());
  const number = chapterNumber(title, raw);
  if (!number) return null;

  return {
    id: href,
    chapter: number,
    title: title || "#" + number,
    volume: null,
    pages: 0,
    language: "ar"
  };
}

function chaptersFromDoc(doc) {
  const out = [];
  const seen = new Set();

  // ONMA chapter links are internal /manga/<slug>/<chapter>.
  // Do not use the separate external "تحميل" links (shrinkme.io).
  const selectors = [
    "li.wp-manga-chapter a[href^='/manga/']",
    ".wp-manga-chapter a[href^='/manga/']",
    ".chapter-list a[href^='/manga/']",
    ".chapters a[href^='/manga/']"
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

  out.sort((a, b) => parseFloat(b.chapter) - parseFloat(a.chapter));
  return out;
}

const plugin = {
  id: "onma",
  name: "مانجا اون لاين",

  async popular(offset) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    for (const path of [
      "/manga/?m_orderby=views&page=" + page,
      "/manga-list?page=" + page,
      "/manga/?page=" + page
    ]) {
      try {
        const list = findCards(await getDoc(path));
        if (list.length) return list;
      } catch (_) {}
    }
    return [];
  },

  async search(query, offset) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    for (const path of [
      "/manga/?s=" + encodeURIComponent(query) + "&post_type=wp-manga&page=" + page,
      "/?s=" + encodeURIComponent(query) + "&page=" + page,
      "/manga/?s=" + encodeURIComponent(query) + "&page=" + page
    ]) {
      try {
        const list = findCards(await getDoc(path));
        if (list.length) return list;
      } catch (_) {}
    }
    return [];
  },

  async detail(id) {
    const doc = await getDoc("/manga/" + encodeURIComponent(id));
    const root = doc.querySelector(".site-content") || doc;

    const cover = firstAttr(
      root,
      [".summary_image", ".summary_image img", ".profile-manga .summary_image", ".tab-summary .summary_image"],
      ["data-src", "data-lazy-src", "data-original", "data-image", "src"]
    );

    return {
      id,
      title: clean(root.querySelector("div.post-title h1")?.text()) || clean(root.querySelector("h1")?.text()) || id,
      altTitle: firstText(root, [".post-content_item.manga_alternative .summary-content", ".alternative", ".other-name"]),
      cover: abs(cover),
      author: firstText(root, [".post-content_item.manga-authors .summary-content", ".post-content_item.manga-author .summary-content", ".author-content"]),
      status: firstText(root, [".post-content_item.manga-status .summary-content", ".post-content_item.manga_status .summary-content", ".manga-status"]),
      description: firstText(root, [".description-summary .summary__content", ".description-summary", ".summary_content", ".summary__content"]),
      lastChapter: firstText(root, ["li.wp-manga-chapter a[href^='/manga/']", ".wp-manga-chapter a[href^='/manga/']"])
    };
  },

  async chapters(id) {
    return chaptersFromDoc(await getDoc("/manga/" + encodeURIComponent(id)));
  },

  async pageUrls(chapterId) {
    const path = "/" + String(chapterId).replace(/^https?:\/\/[^/]+/i, "").replace(/^\//, "");
    const doc = await getDoc(path);
    const urls = [];
    const seen = new Set();

    const selectors = [
      ".reading-content .page-break img",
      ".reading-content img",
      ".wp-manga-chapter-img",
      ".wp-manga-chapter-img img",
      ".chapter-content img",
      ".reader-content img",
      ".page-content img",
      ".entry-content img"
    ];

    for (const sel of selectors) {
      for (const img of doc.querySelectorAll(sel)) {
        const url = imageUrl(img);
        if (!url || seen.has(url)) continue;
        seen.add(url);
        urls.push(url);
      }
      if (urls.length) break;
    }

    // Fallback for readers that expose the images only through links.
    if (!urls.length) {
      for (const a of doc.querySelectorAll("a[href]")) {
        const href = abs(a.attr("href") || "");
        if (!href || !/\.(?:jpe?g|png|webp|gif)(?:\?|#|$)/i.test(href)) continue;
        if (seen.has(href)) continue;
        seen.add(href);
        urls.push(href);
      }
    }

    return urls;
  },

  async tags() {
    const doc = await getDoc("/manga-list");
    const out = [];
    const seen = new Set();
    for (const a of doc.querySelectorAll("a[href*='/category/'], a[href*='/genre/']")) {
      const name = clean(a.text());
      const href = a.attr("href") || "";
      const m = href.match(/\/(?:category|genre)\/([^/?#]+)/i);
      if (!name || !m || seen.has(m[1])) continue;
      seen.add(m[1]);
      out.push({ id: decodeURIComponent(m[1]), name, group: "Genre" });
    }
    return out;
  }
};

return plugin;
