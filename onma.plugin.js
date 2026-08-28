// Harbor source for onma.me - based on 3asq.plugin.js
const BASE = "https://onma.me";
const PAGE_SIZE = 48;
const CHAPTER_SUFFIX = "?style=list";

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

function imageUrl(img) {
  if (!img) return undefined;
  return abs(
    img.attr("data-src") ||
    img.attr("data-lazy-src") ||
    img.attr("data-original") ||
    img.attr("data-url") ||
    img.attr("src")
  );
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

function mangaIdFromHref(href) {
  if (!href) return null;
  const s = String(href).replace(/^https?:\/\/[^/]+/i, "");
  const m = s.match(/^\/manga\/([^/?#]+)\/?(?:[?#].*)?$/i);
  return m ? decodeURIComponent(m[1]) : null;
}

function cardToSummary(el) {
  const link =
    el.querySelector("div.post-title a") ||
    el.querySelector(".post-title a") ||
    el.querySelector("a[href^='/manga/']") ||
    el.querySelector("a[href*='/manga/']") ||
    el.querySelector("a");

  if (!link) return null;

  const href = link.attr("href") || "";
  const id = mangaIdFromHref(href);
  if (!id) return null;

  const img = el.querySelector("img");
  const title = clean(
    link.attr("title") ||
    link.attr("aria-label") ||
    firstText(el, [
      ".post-title",
      ".item-summary h3",
      ".summary_content h3",
      "h2",
      "h3",
      "h4",
      ".title",
      ".name"
    ]) ||
    img?.attr("alt") ||
    link.text()
  );

  if (!title) return null;

  return {
    id,
    title,
    cover: imageUrl(img)
  };
}

function findCards(doc) {
  const selectors = [
    "div.page-item-detail",
    ".page-item-detail.manga",
    ".manga__item",
    ".c-tabs-item__content .row.c-tabs-item__content",
    ".row.c-tabs-item__content",
    ".tab-thumb.c-tabs-item__content",
    ".manga-item",
    ".item-summary",
    "article",
    ".manga-list .item",
    ".manga-list li"
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

  // Fallback: collect every manga link on the page.
  for (const a of doc.querySelectorAll("a[href^='/manga/'], a[href*='/manga/']")) {
    const id = mangaIdFromHref(a.attr("href") || "");
    if (!id || seen.has(id)) continue;

    const parent = a.parentElement;
    const img = parent?.querySelector("img") || a.querySelector("img");
    const title = clean(
      a.attr("title") ||
      a.attr("aria-label") ||
      img?.attr("alt") ||
      a.text()
    );

    if (!title) continue;

    seen.add(id);
    out.push({ id, title, cover: imageUrl(img) });
  }

  return out;
}

function chapterNumber(text, href) {
  const h = String(href || "");
  let m = h.match(/\/manga\/[^/]+\/([0-9]+(?:\.[0-9]+)?)\/?(?:[?#].*)?$/i);
  if (m) return m[1];

  const s = clean(text) || h;
  m = s.match(/(?:chapter|ch\.?|الفصل|فصل)\s*#?\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (!m) m = s.match(/([0-9]+(?:\.[0-9]+)?)/);
  return m ? m[1] : null;
}

function chapterFromLink(a) {
  let href = abs(a.attr("href") || "");
  if (!href) return null;

  // Keep the real chapter URL as the id; only add the same list suffix
  // used by the working 3asq source when it is not already present.
  if (CHAPTER_SUFFIX && !href.includes("?style=list")) {
    href += CHAPTER_SUFFIX;
  }

  const title = clean(a.text());
  const number = a.attr("data-number") || chapterNumber(title, href);
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
  const selectors = [
    "li.wp-manga-chapter a",
    ".version-chap li.wp-manga-chapter a",
    ".main.version-chap li a",
    "div.wp-manga-chapter a",
    ".chapter-list a[href*='/manga/']",
    ".chapters a[href*='/manga/']",
    "a[href*='/manga/'][href*='?style=list']"
  ];

  const out = [];
  const seen = new Set();

  for (const sel of selectors) {
    for (const a of doc.querySelectorAll(sel)) {
      const c = chapterFromLink(a);
      if (!c || seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
    }
    if (out.length) return out;
  }

  return out;
}

function postId(doc) {
  for (const h of doc.querySelectorAll("div[id^='manga-chapters-holder'], .manga-chapters-holder")) {
    const id = h.attr("data-id");
    if (id) return id;
  }
  return null;
}

function formEncode(obj) {
  const p = [];
  for (const k of Object.keys(obj)) {
    if (obj[k] === undefined || obj[k] === null) continue;
    p.push(encodeURIComponent(k) + "=" + encodeURIComponent(String(obj[k])));
  }
  return p.join("&");
}

async function chapterList(id) {
  const mangaPath = "/manga/" + encodeURIComponent(id) + "/";

  let doc = await getDoc(mangaPath + CHAPTER_SUFFIX);
  let list = chaptersFromDoc(doc);
  if (list.length) return list;

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

const plugin = {
  id: "onma",
  name: "مانجا اون لاين",

  async popular(offset, tagId) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    let path = "/manga/?m_orderby=views&page=" + page;
    if (tagId) path += "&genre=" + encodeURIComponent(tagId);
    return findCards(await getDoc(path));
  },

  async search(query, offset, tagId) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    let path = "/manga/?s=" + encodeURIComponent(query) + "&post_type=wp-manga&page=" + page;
    if (tagId) path += "&genre=" + encodeURIComponent(tagId);
    return findCards(await getDoc(path));
  },

  async detail(id) {
    const doc = await getDoc("/manga/" + encodeURIComponent(id) + "/" + CHAPTER_SUFFIX);
    const root = doc.querySelector(".site-content") || doc;

    return {
      id,
      title: clean(root.querySelector("div.post-title h1")?.text()) || clean(root.querySelector("h1")?.text()) || id,
      altTitle: firstText(root, [
        ".alternative",
        ".other-name",
        ".post-content_item.manga_alternative .summary-content"
      ]),
      cover: abs(firstAttr(root, [
        ".summary_image",
        ".profile-manga",
        ".tab-summary .summary_image",
        ".thumbnail",
        ".cover"
      ], ["data-src", "data-lazy-src", "data-original", "data-url", "src"])),
      author: firstText(root, [
        ".author-content",
        ".author",
        ".post-content_item.manga-authors .summary-content",
        ".post-content_item.manga-author .summary-content"
      ]),
      status: firstText(root, [
        ".post-content_item.manga-status .summary-content",
        ".post-content_item.manga_status .summary-content",
        ".status",
        ".manga-status"
      ]),
      description: firstText(root, [
        ".summary__content",
        ".description-summary .summary__content",
        ".description-summary",
        ".description",
        ".summary_content"
      ]),
      lastChapter: firstText(root, [
        ".wp-manga-chapter a",
        "li.wp-manga-chapter a",
        ".chapter-list a",
        ".chapters a"
      ])
    };
  },

  async chapters(id) {
    return chapterList(id);
  },

  async pageUrls(chapterId) {
    const path = "/" + String(chapterId)
      .replace(/^https?:\/\/[^/]+/i, "")
      .replace(/^\//, "");

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
      ".chapter-content img",
      ".reader-content img",
      ".page-content img",
      ".page-break img",
      ".wp-manga-chapter-img img",
      ".entry-content img"
    ]) {
      for (const img of doc.querySelectorAll(sel)) {
        const u = imageUrl(img);
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

    for (const a of doc.querySelectorAll(".genres-content a, .genres a, .manga-genres a, a[href*='/genre/']")) {
      const name = clean(a.text());
      const href = a.attr("href") || "";
      const m = href.match(/\/genre\/([^/?#]+)/i);
      if (!name || !m || seen.has(m[1])) continue;
      seen.add(m[1]);
      out.push({ id: decodeURIComponent(m[1]), name, group: "Genre" });
    }

    return out;
  }
};

return plugin;