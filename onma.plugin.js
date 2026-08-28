// Harbor source for onma.me - based on working 3asq structure
const BASE = "https://onma.me";
const PAGE_SIZE = 48;
const MAX_SEARCH_PAGES = 15;

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
    img.attr("data-image") ||
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
  const m = s.match(/^\/manga\/([^/?#]+)\/?$/i);
  return m ? decodeURIComponent(m[1]) : null;
}

function nearestImage(el) {
  if (!el) return undefined;
  let cur = el;
  for (let i = 0; i < 4 && cur; i++) {
    const img = cur.querySelector("img");
    if (img) return imageUrl(img);
    cur = cur.parentElement;
  }
  return undefined;
}

function cardToSummary(el) {
  const links = el.querySelectorAll("a[href^='/manga/'], a[href*='/manga/']");
  for (const link of links) {
    const id = mangaIdFromHref(link.attr("href") || "");
    if (!id) continue;

    const img = link.querySelector("img") || el.querySelector("img");
    const title = clean(
      link.attr("title") ||
      link.attr("aria-label") ||
      img?.attr("alt") ||
      firstText(el, ["h1", "h2", "h3", "h4", ".title", ".name", ".post-title"]) ||
      link.text()
    );
    if (!title) continue;

    return { id, title, cover: imageUrl(img) || nearestImage(link) };
  }
  return null;
}

function findCards(doc) {
  const out = [];
  const seen = new Set();

  // ONMA's /manga-list page contains the catalog cards.
  const cardSelectors = [
    ".manga-list .item",
    ".manga-list li",
    ".manga-list article",
    ".row .item",
    "article",
    ".manga-item",
    ".item"
  ];

  for (const sel of cardSelectors) {
    for (const el of doc.querySelectorAll(sel)) {
      const item = cardToSummary(el);
      if (item && !seen.has(item.id)) {
        seen.add(item.id);
        out.push(item);
      }
    }
  }

  // Reliable fallback: collect every direct /manga/ work link on the page.
  for (const a of doc.querySelectorAll("a[href^='/manga/'], a[href*='/manga/']")) {
    const id = mangaIdFromHref(a.attr("href") || "");
    if (!id || seen.has(id)) continue;

    const img = a.querySelector("img") || a.parentElement?.querySelector("img") || a.parentElement?.parentElement?.querySelector("img");
    const title = clean(
      a.attr("title") ||
      a.attr("aria-label") ||
      img?.attr("alt") ||
      a.text()
    );
    if (!title) continue;

    seen.add(id);
    out.push({ id, title, cover: imageUrl(img) || nearestImage(a) });
  }

  return out;
}

function normalizeQuery(text) {
  return clean(text).toLocaleLowerCase().replace(/[إأآ]/g, "ا");
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
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    return catalogPage(page);
  },

  async search(query, offset) {
    const wanted = normalizeQuery(query);
    if (!wanted) return this.popular(offset);

    // Try the site's possible search endpoints first.
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const q = encodeURIComponent(query);
    const directPaths = [
      "/manga-list?search=" + q + "&page=" + page,
      "/manga-list?s=" + q + "&page=" + page,
      "/manga-list?title=" + q + "&page=" + page,
      "/advanced-search?search=" + q + "&page=" + page
    ];

    for (const path of directPaths) {
      try {
        const list = findCards(await getDoc(path));
        if (list.length) {
          const exact = list.filter(x => normalizeQuery(x.title).includes(wanted));
          if (exact.length) return exact;
        }
      } catch (_) {}
    }

    // ONMA's catalog is paginated. If its search form is not exposed to
    // Harbor's plain HTTP parser, search the catalog itself instead.
    const matches = [];
    const seen = new Set();
    const startPage = Math.max(1, page);

    for (let p = startPage; p <= MAX_SEARCH_PAGES && matches.length < PAGE_SIZE; p++) {
      let list = [];
      try {
        list = await catalogPage(p);
      } catch (_) {
        continue;
      }
      if (!list.length) break;

      for (const item of list) {
        if (seen.has(item.id)) continue;
        if (normalizeQuery(item.title).includes(wanted)) {
          seen.add(item.id);
          matches.push(item);
          if (matches.length >= PAGE_SIZE) break;
        }
      }
    }

    return matches;
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