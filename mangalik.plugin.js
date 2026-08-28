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
    headers: { Referer: BASE + "/" }
  });
  if (!res.ok) throw new Error("http " + res.status + " for " + path);
  return harbor.parseHtml(res.body || "");
}

function mangaId(href) {
  const p = pathOf(href);
  const m = p.match(/^\/manga\/([^/?#]+)\/?$/i);
  return m ? decodeURIComponent(m[1]) : null;
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
  const containers = [".page-item-detail", ".row.c-tabs-item__content", ".c-tabs-item__content", ".manga-item", "article"];
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
    const title = clean(a.attr("title")) || clean(a.text()) || id.replace(/[-_]+/g, " ");
    let parent = a.parentElement;
    let cover;
    for (let i = 0; i < 6 && parent; i++, parent = parent.parentElement) {
      const img = parent.querySelector("img");
      if (img) {
        cover = abs(img.attr("data-src") || img.attr("data-lazy-src") || img.attr("data-original") || img.attr("src"));
        if (cover) break;
      }
    }
    out.push({ id, title, cover });
  }
  return out;
}

function chapterNumber(text, slug) {
  const s = clean(text) || slug || "";
  let m = s.match(/(?:chapter|ch\.?|الفصل|فصل)\s*#?\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (!m) m = String(slug || "").match(/([0-9]+(?:\.[0-9]+)?)/);
  return m ? m[1] : String(slug || "");
}

// Important: MangaLik can use a different slug for chapter URLs than for the
// manga detail URL. Example: detail = /manga/one-piece/ while chapters can be
// /manga/pieceone/1190/. So do NOT compare the first slug with the detail id.
function chaptersFromDoc(doc) {
  const out = [];
  const seen = new Set();
  for (const a of doc.querySelectorAll("a")) {
    const href = a.attr("href") || "";
    const p = pathOf(href);
    const m = p.match(/^\/manga\/([^/?#]+)\/([^/?#]+)\/?$/i);
    if (!m) continue;

    const full = abs(href);
    if (!full || seen.has(full)) continue;

    const text = clean(a.text()) || clean(a.attr("title"));
    const number = a.attr("data-number") || chapterNumber(text, m[2]);
    if (!number) continue;

    seen.add(full);
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

async function tryPaths(paths) {
  for (const path of paths) {
    try {
      const items = listFromDoc(await getDoc(path));
      if (items.length) return items;
    } catch (_) {}
  }
  return [];
}

const plugin = {
  id: "mangalik",
  name: "مانجا ليك",

  async popular(offset) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const paths = page === 1
      ? ["/", "/home/", "/latest/", "/manga/"]
      : ["/latest/page/" + page + "/", "/page/" + page + "/", "/home/page/" + page + "/"];
    return tryPaths(paths);
  },

  async search(query, offset) {
    const q = String(query || "").trim();
    if (!q) return [];
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const e = encodeURIComponent(q);
    const paths = page === 1
      ? [
          "/manga/?s=" + e,
          "/manga/?post_type=wp-manga&s=" + e,
          "/?s=" + e + "&post_type=wp-manga",
          "/?post_type=wp-manga&s=" + e,
          "/search/" + e + "/"
        ]
      : [
          "/manga/page/" + page + "/?s=" + e,
          "/manga/page/" + page + "/?post_type=wp-manga&s=" + e,
          "/page/" + page + "/?s=" + e + "&post_type=wp-manga"
        ];
    return tryPaths(paths);
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
      author: clean(root.querySelector(".post-content_item.manga-authors .summary-content")?.text()) || clean(root.querySelector(".author-content")?.text())
    };
  },

  async chapters(id) {
    const doc = await getDoc("/manga/" + encodeURIComponent(id) + "/");
    return chaptersFromDoc(doc);
  },

  async pageUrls(chapterId) {
    const path = pathOf(chapterId);
    if (!path) return [];
    const doc = await getDoc(path);
    const urls = [];
    const seen = new Set();
    for (const sel of [".reading-content img", ".page-break img", ".wp-manga-chapter-img", ".entry-content img"]) {
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
