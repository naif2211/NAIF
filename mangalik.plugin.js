// Harbor source for mangalik.net (MangaLik)
const BASE = "https://mangalik.net";
const PAGE_SIZE = 24;

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

function mangaIdFromHref(href) {
  if (!href) return null;
  const s = String(href);
  const m = s.match(/\/manga\/([^/?#]+)\/?(?:[?#].*)?$/i);
  return m ? m[1] : null;
}

function cardFromLink(link) {
  const href = link?.attr("href") || "";
  const id = mangaIdFromHref(href);
  if (!id) return null;

  let el = link;
  for (let i = 0; i < 4 && el; i++) {
    const title = clean(
      link.attr("title") ||
      firstText(el, [".post-title", ".item-summary h3", ".summary_content h3", ".manga-title", "h3", "h4"]) ||
      link.text()
    );
    if (title) {
      const img = el.querySelector("img") || link.querySelector("img");
      return {
        id,
        title,
        cover: abs(img?.attr("data-src") || img?.attr("data-lazy-src") || img?.attr("data-original") || img?.attr("data-url") || img?.attr("src"))
      };
    }
    el = el.parentElement;
  }
  return null;
}

function findCards(doc) {
  const out = [];
  const seen = new Set();

  // MangaLik pages are not consistently using the old Madara card classes.
  // Scan all manga links, then walk up to the card to find title/cover.
  for (const a of doc.querySelectorAll("a[href*='/manga/']")) {
    const item = cardFromLink(a);
    if (item && !seen.has(item.id)) {
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}

function chapterNumber(text, href) {
  const s = clean(text) || String(href || "");
  let m = s.match(/(?:chapter|ch\.?|الفصل|فصل|chap)\s*#?\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (!m) m = s.match(/(?:chapter|chap|ch)[-_\s]*([0-9]+(?:\.[0-9]+)?)/i);
  if (!m) m = s.match(/\/([0-9]+(?:\.[0-9]+)?)\/?(?:\?|#|$)/);
  if (!m) m = s.match(/([0-9]+(?:\.[0-9]+)?)/);
  return m ? m[1] : null;
}

function chaptersFromDoc(doc) {
  const out = [];
  const seen = new Set();
  const selectors = [
    "li.wp-manga-chapter a",
    ".wp-manga-chapter a",
    ".version-chap li a",
    "a[href*='/chapter/']",
    "a[href*='chapter']"
  ];

  for (const sel of selectors) {
    for (const a of doc.querySelectorAll(sel)) {
      const href = abs(a.attr("href") || "");
      const title = clean(a.text());
      if (!href || seen.has(href) || !title) continue;
      const number = a.attr("data-number") || chapterNumber(title, href);
      if (!number) continue;
      seen.add(href);
      out.push({
        id: href,
        chapter: number,
        title,
        volume: null,
        pages: 0,
        language: "ar"
      });
    }
    if (out.length) return out;
  }
  return out;
}

function postId(doc) {
  for (const h of doc.querySelectorAll("div[id^='manga-chapters-holder'], .manga-chapters-holder, [data-id]")) {
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
  const doc = await getDoc(mangaPath);
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
  return [];
}

function pagePath(page) {
  return page <= 1 ? "/home/" : "/home/page/" + page + "/";
}

const plugin = {
  id: "mangalik",
  name: "مانجا ليك",

  async popular(offset) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    return findCards(await getDoc(pagePath(page)));
  },

  async search(query, offset) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const q = encodeURIComponent(query || "");
    const paths = [
      "/?s=" + q + "&paged=" + page,
      page === 1 ? "/?s=" + q : "/page/" + page + "/?s=" + q
    ];

    for (const path of paths) {
      try {
        const items = findCards(await getDoc(path));
        if (items.length) return items;
      } catch (_) {}
    }
    return [];
  },

  async detail(id) {
    const doc = await getDoc("/manga/" + encodeURIComponent(id) + "/");
    const root = doc.querySelector(".site-content") || doc;
    return {
      id,
      title: clean(root.querySelector("div.post-title h1")?.text()) || clean(root.querySelector("h1")?.text()) || id,
      altTitle: firstText(root, [".alternative", ".post-content_item.manga_alternative .summary-content"]),
      cover: abs(firstAttr(root, [".summary_image", ".profile-manga", ".tab-summary .summary_image"], ["data-src", "data-lazy-src", "data-original", "data-url", "src"])),
      author: firstText(root, [".author-content", ".post-content_item.manga-authors .summary-content", ".post-content_item.manga-author .summary-content"]),
      status: firstText(root, [".post-content_item.manga-status .summary-content", ".post-content_item.manga_status .summary-content"]),
      description: firstText(root, [".summary__content", ".description-summary .summary__content", ".description-summary", ".manga-excerpt"])
    };
  },

  async chapters(id) {
    return chapterList(id);
  },

  async pageUrls(chapterId) {
    let path = String(chapterId).replace(/^https?:\/\/[^/]+/i, "");
    if (!path.startsWith("/")) path = "/" + path;
    const res = await harbor.http(BASE + path, {
      responseType: "text",
      timeoutMs: 30000,
      headers: { Referer: BASE + "/" }
    });
    if (!res.ok) throw new Error("http " + res.status + " for " + path);

    const doc = await harbor.parseHtml(res.body || "");
    const urls = [];
    const seen = new Set();
    const selectors = [
      ".reading-content img",
      ".page-break img",
      ".reading-content .wp-manga-chapter-img",
      ".wp-manga-chapter-img img",
      ".entry-content img",
      "img[data-src]"
    ];

    for (const sel of selectors) {
      for (const img of doc.querySelectorAll(sel)) {
        const u = abs(img.attr("data-src") || img.attr("data-lazy-src") || img.attr("data-original") || img.attr("data-url") || img.attr("src"));
        if (!u || seen.has(u)) continue;
        if (/logo|avatar|icon|favicon/i.test(u)) continue;
        seen.add(u);
        urls.push(u);
      }
      if (urls.length) break;
    }
    return urls;
  },

  async tags() {
    const doc = await getDoc("/manga-genre/");
    const out = [];
    const seen = new Set();
    for (const a of doc.querySelectorAll("a[href*='/manga-genre/']")) {
      const name = clean(a.text());
      const href = a.attr("href") || "";
      const m = href.match(/\/manga-genre\/([^/?#]+)/i);
      if (!name || !m || seen.has(m[1])) continue;
      seen.add(m[1]);
      out.push({ id: m[1], name, group: "Genre" });
    }
    return out;
  }
};

return plugin;
