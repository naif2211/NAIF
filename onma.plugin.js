// Harbor source for onma.me
const BASE = "https://onma.me";
// ONMA currently shows 18 manga entries per /manga-list page.
const PAGE_SIZE = 18;
const MAX_CATALOG_PAGES = 15;

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
  return abs(img.attr("data-src") || img.attr("data-lazy-src") || img.attr("data-original") || img.attr("data-url") || img.attr("data-image") || img.attr("src"));
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
  const m = s.match(/^\/manga\/([^/?#]+)\/?$/i);
  return m ? decodeURIComponent(m[1]) : null;
}

function nearestImage(el) {
  let cur = el;
  for (let i = 0; i < 6 && cur; i++) {
    const img = cur.querySelector("img");
    if (img) return imageUrl(img);
    cur = cur.parentElement;
  }
  return undefined;
}

function summaryFromLink(a) {
  const id = mangaIdFromHref(a.attr("href") || "");
  if (!id) return null;

  let cur = a;
  let img;
  let title = clean(a.attr("title") || a.attr("aria-label") || a.text());

  // On ONMA the cover link and title link can be separate siblings.
  // Walk upward until we find the complete manga card.
  for (let i = 0; i < 6 && cur; i++) {
    img = cur.querySelector("img") || img;
    if (!title) {
      title = firstText(cur, ["h1", "h2", "h3", "h4", ".title", ".name", ".post-title"]);
    }
    if (img && title) break;
    cur = cur.parentElement;
  }

  if (!title && img) title = clean(img.attr("alt"));
  if (!title) return null;

  return { id, title, cover: imageUrl(img) || nearestImage(a) };
}

function findCards(doc) {
  const out = [];
  const seen = new Set();

  // Do not depend on one card class. The important stable part of ONMA's
  // catalog is the direct /manga/<slug> link.
  for (const a of doc.querySelectorAll("a[href^='/manga/'], a[href*='/manga/']")) {
    const item = summaryFromLink(a);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }

  return out;
}

function normalizeQuery(text) {
  return clean(text)
    .toLocaleLowerCase()
    .replace(/[إأآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي");
}

function chapterNumber(text, href) {
  const h = String(href || "");
  let m = h.match(/\/manga\/[^/]+\/([0-9]+(?:\.[0-9]+)?)\/?(?:[?#].*)?$/i);
  if (m) return m[1];

  const s = clean(text) || h;
  m = s.match(/(?:chapter|ch\.?|الفصل|فصل)\s*#?\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (!m) m = s.match(/#\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (!m) m = s.match(/([0-9]+(?:\.[0-9]+)?)/);
  return m ? m[1] : null;
}

function chapterFromLink(a) {
  const href = abs(a.attr("href") || "");
  if (!href) return null;
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
  const out = [];
  const seen = new Set();
  const selectors = [
    "li.wp-manga-chapter a",
    ".wp-manga-chapter a",
    ".chapter-list a",
    ".chapters a",
    "a[href*='/manga/']"
  ];

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
  let doc = await getDoc(mangaPath);
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

async function catalogPage(page) {
  return findCards(await getDoc("/manga-list?page=" + page));
}

const plugin = {
  id: "onma",
  name: "مانجا اون لاين",

  async popular(offset) {
    // Harbor offset is an item offset; ONMA's catalog has 18 items/page.
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    return catalogPage(page);
  },

  async search(query, offset) {
    const wanted = normalizeQuery(query);
    if (!wanted) return this.popular(offset);

    // ONMA's visible catalog has reliable pagination, while its search form
    // is not exposed as a stable GET endpoint to Harbor's plain HTTP parser.
    // Search the actual catalog pages and then paginate the matched results.
    const all = [];
    const seen = new Set();

    for (let p = 1; p <= MAX_CATALOG_PAGES; p++) {
      let list;
      try {
        list = await catalogPage(p);
      } catch (_) {
        continue;
      }
      if (!list.length) break;

      for (const item of list) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        if (normalizeQuery(item.title).includes(wanted)) all.push(item);
      }
    }

    return all.slice(offset, offset + PAGE_SIZE);
  },

  async detail(id) {
    const doc = await getDoc("/manga/" + encodeURIComponent(id) + "/");
    const root = doc.querySelector(".site-content") || doc;
    return {
      id,
      title: clean(root.querySelector("div.post-title h1")?.text()) || clean(root.querySelector("h1")?.text()) || id,
      altTitle: firstText(root, [".alternative", ".other-name", ".post-content_item.manga_alternative .summary-content"]),
      cover: abs(firstAttr(root, [".summary_image", ".profile-manga", ".tab-summary .summary_image", ".thumbnail", ".cover"], ["data-src", "data-lazy-src", "data-original", "data-url", "src"])),
      author: firstText(root, [".author-content", ".author", ".post-content_item.manga-authors .summary-content", ".post-content_item.manga-author .summary-content"]),
      status: firstText(root, [".post-content_item.manga-status .summary-content", ".post-content_item.manga_status .summary-content", ".status", ".manga-status"]),
      description: firstText(root, [".summary__content", ".description-summary .summary__content", ".description-summary", ".description", ".summary_content"]),
      lastChapter: firstText(root, [".wp-manga-chapter a", "li.wp-manga-chapter a", ".chapter-list a", ".chapters a"])
    };
  },

  async chapters(id) {
    return chapterList(id);
  },

  async pageUrls(chapterId) {
    const path = "/" + String(chapterId).replace(/^https?:\/\/[^/]+/i, "").replace(/^\//, "");
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
    const doc = await getDoc("/manga-list");
    const out = [];
    const seen = new Set();
    for (const a of doc.querySelectorAll("a[href*='/category/'], .genres-content a, .genres a, .manga-genres a, a[href*='/genre/']")) {
      const name = clean(a.text());
      const href = a.attr("href") || "";
      const m = href.match(/\/category\/([^/?#]+)/i) || href.match(/\/genre\/([^/?#]+)/i);
      if (!name || !m || seen.has(m[1])) continue;
      seen.add(m[1]);
      out.push({ id: decodeURIComponent(m[1]), name, group: "Genre" });
    }
    return out;
  }
};

return plugin;