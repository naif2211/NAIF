// Harbor source for mangalik.net (MangaLik)
const BASE = "https://mangalik.net";
const PAGE_SIZE = 48;

function clean(text) {
  return text ? String(text).replace(/\s+/g, " ").trim() : "";
}

function abs(url) {
  if (!url) return undefined;
  url = String(url).trim();
  if (!url || /^data:/i.test(url)) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return BASE + url;
  return BASE + "/" + url;
}

function pathOf(url) {
  const u = abs(url);
  return u ? u.replace(/^https?:\/\/[^/]+/i, "") : "";
}

async function getDoc(path) {
  const res = await harbor.http(BASE + path, {
    responseType: "text",
    timeoutMs: 30000,
    headers: { Referer: BASE + "/", "User-Agent": "Mozilla/5.0" }
  });
  if (!res.ok) throw new Error("http " + res.status + " for " + path);
  return harbor.parseHtml(res.body || "");
}

function mangaId(href) {
  const p = pathOf(href);
  const m = p.match(/^\/manga\/([^/?#]+)\/?$/i);
  return m ? decodeURIComponent(m[1]) : null;
}

function chapterFromHref(href) {
  const p = pathOf(href);
  const m = p.match(/^\/manga\/([^/?#]+)\/([^/?#]+)\/?$/i);
  return m ? { manga: decodeURIComponent(m[1]), chapter: decodeURIComponent(m[2]) } : null;
}

function cardToSummary(el) {
  for (const a of el.querySelectorAll("a")) {
    const id = mangaId(a.attr("href") || "");
    if (!id) continue;
    const title = clean(a.attr("title")) || clean(a.text()) || clean(el.querySelector("h3")?.text()) || clean(el.querySelector("h4")?.text()) || id.replace(/[-_]+/g, " ");
    const img = el.querySelector("img");
    return {
      id,
      title,
      cover: abs(img?.attr("data-src") || img?.attr("data-lazy-src") || img?.attr("data-original") || img?.attr("src"))
    };
  }
  return null;
}

function listFromDoc(doc) {
  const out = [];
  const seen = new Set();
  const containers = [
    ".page-item-detail",
    ".row.c-tabs-item__content",
    ".c-tabs-item__content",
    ".item-summary",
    ".manga-item",
    "article"
  ];
  for (const sel of containers) {
    for (const el of doc.querySelectorAll(sel)) {
      const item = cardToSummary(el);
      if (item && !seen.has(item.id)) {
        seen.add(item.id);
        out.push(item);
      }
    }
    if (out.length) return out;
  }
  for (const a of doc.querySelectorAll("a")) {
    const id = mangaId(a.attr("href") || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    let title = clean(a.attr("title")) || clean(a.text());
    let parent = a.parentElement;
    let cover;
    for (let i = 0; i < 6 && parent; i++, parent = parent.parentElement) {
      if (!title) title = clean(parent.querySelector("h3")?.text()) || clean(parent.querySelector("h4")?.text());
      if (!cover) {
        const img = parent.querySelector("img");
        cover = abs(img?.attr("data-src") || img?.attr("data-lazy-src") || img?.attr("data-original") || img?.attr("src"));
      }
      if (title && cover) break;
    }
    out.push({ id, title: title || id.replace(/[-_]+/g, " "), cover });
  }
  return out;
}

function chapterNumber(text, slug) {
  const s = clean(text) || slug || "";
  let m = s.match(/(?:chapter|ch\.?|الفصل|فصل)\s*#?\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (!m) m = String(slug || "").match(/([0-9]+(?:\.[0-9]+)?)/);
  return m ? m[1] : String(slug || "");
}

function chaptersFromDoc(doc, mangaIdValue) {
  const out = [];
  const seen = new Set();
  const wanted = String(mangaIdValue || "").toLowerCase();
  for (const a of doc.querySelectorAll("a")) {
    const href = a.attr("href") || "";
    const c = chapterFromHref(href);
    if (!c || c.manga.toLowerCase() !== wanted) continue;
    const full = abs(href);
    if (!full || seen.has(full)) continue;
    seen.add(full);
    const text = clean(a.text()) || clean(a.attr("title"));
    const number = a.attr("data-number") || chapterNumber(text, c.chapter);
    out.push({
      id: full,
      chapter: number,
      title: text || "Chapter " + number,
      volume: null,
      pages: 0,
      language: "ar"
    });
  }
  out.sort((a, b) => {
    const na = parseFloat(a.chapter), nb = parseFloat(b.chapter);
    if (Number.isFinite(na) && Number.isFinite(nb)) return nb - na;
    return String(b.chapter).localeCompare(String(a.chapter));
  });
  return out;
}

async function tryPages(paths) {
  for (const path of paths) {
    try {
      const items = listFromDoc(await getDoc(path));
      if (items.length) return items;
    } catch (_) {}
  }
  return [];
}

async function ajaxSearch(query) {
  const body = "action=wp-manga-search-manga&title=" + encodeURIComponent(query);
  try {
    const res = await harbor.http(BASE + "/wp-admin/admin-ajax.php", {
      method: "POST",
      responseType: "text",
      timeoutMs: 30000,
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-requested-with": "XMLHttpRequest",
        Referer: BASE + "/"
      },
      body
    });
    if (!res.ok) return [];
    return listFromDoc(await harbor.parseHtml(res.body || ""));
  } catch (_) {
    return [];
  }
}

const plugin = {
  id: "mangalik",
  name: "مانجا ليك",

  async popular(offset) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const paths = page === 1
      ? ["/", "/home/", "/latest/", "/manga/"]
      : ["/latest/page/" + page + "/", "/page/" + page + "/", "/home/page/" + page + "/"];
    return tryPages(paths);
  },

  async search(query, offset) {
    const q = String(query || "").trim();
    if (!q) return [];
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const e = encodeURIComponent(q);

    // First use MangaLik's Madara AJAX autocomplete/search endpoint.
    const ajax = await ajaxSearch(q);
    if (ajax.length) return ajax;

    // Fallbacks for the normal WordPress search pages.
    const paths = page === 1
      ? [
          "/?post_type=wp-manga&s=" + e,
          "/?s=" + e + "&post_type=wp-manga",
          "/manga/?s=" + e,
          "/manga/?post_type=wp-manga&s=" + e,
          "/?s=" + e
        ]
      : [
          "/page/" + page + "/?post_type=wp-manga&s=" + e,
          "/manga/page/" + page + "/?s=" + e,
          "/manga/page/" + page + "/?post_type=wp-manga&s=" + e
        ];
    return tryPages(paths);
  },

  async detail(id) {
    const doc = await getDoc("/manga/" + encodeURIComponent(id) + "/");
    const root = doc.querySelector(".site-content") || doc;
    const titleEl = root.querySelector("h1") || root.querySelector(".post-title");
    const img = root.querySelector(".summary_image img") || root.querySelector(".profile-manga img") || root.querySelector("img");
    return {
      id,
      title: clean(titleEl?.text()) || id,
      altTitle: clean(root.querySelector(".post-content_item.manga_alternative .summary-content")?.text()) || clean(root.querySelector(".alternative")?.text()),
      cover: abs(img?.attr("data-src") || img?.attr("data-lazy-src") || img?.attr("data-original") || img?.attr("src")),
      description: clean(root.querySelector(".description-summary")?.text()) || clean(root.querySelector(".summary__content")?.text()),
      status: clean(root.querySelector(".post-content_item.manga-status .summary-content")?.text()),
      author: clean(root.querySelector(".post-content_item.manga-authors .summary-content")?.text()) || clean(root.querySelector(".author-content")?.text()),
      lastChapter: clean(root.querySelector("a[href^='/manga/']")?.text())
    };
  },

  async chapters(id) {
    const doc = await getDoc("/manga/" + encodeURIComponent(id) + "/");
    return chaptersFromDoc(doc, id);
  },

  async pageUrls(chapterId) {
    const path = pathOf(chapterId);
    if (!path) return [];
    const res = await harbor.http(BASE + path, {
      responseType: "text",
      timeoutMs: 30000,
      headers: { Referer: BASE + "/", "User-Agent": "Mozilla/5.0" }
    });
    if (!res.ok) throw new Error("http " + res.status + " for " + path);
    const doc = await harbor.parseHtml(res.body || "");
    const urls = [];
    const seen = new Set();
    for (const sel of [".reading-content img", ".page-break img", ".wp-manga-chapter-img img", ".entry-content img"]) {
      for (const img of doc.querySelectorAll(sel)) {
        const u = abs(img.attr("data-src") || img.attr("data-lazy-src") || img.attr("data-original") || img.attr("src"));
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
    for (const a of doc.querySelectorAll("a")) {
      const href = a.attr("href") || "";
      const m = href.match(/\/manga-tag\/([^/?#]+)/i);
      const name = clean(a.text());
      if (!name || !m || seen.has(m[1])) continue;
      seen.add(m[1]);
      out.push({ id: decodeURIComponent(m[1]), name, group: "Tag" });
    }
    return out;
  }
};

return plugin;
