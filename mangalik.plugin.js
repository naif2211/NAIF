// MangaLik source for Harbor
// Repaired search, catalog parsing, chapter filtering, and reader image extraction.
const BASE = "https://mangalik.net";
const PAGE_SIZE = 24;

async function getDoc(path) {
  const res = await harbor.http(BASE + path, { responseType: "text" });
  if (!res.ok) throw new Error("http " + res.status + " for " + path);
  return harbor.parseHtml(res.body);
}

function abs(url) {
  if (!url) return undefined;
  const value = String(url).trim();
  if (!value || value.startsWith("data:") || value.startsWith("blob:")) return undefined;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("//")) return "https:" + value;
  if (value.startsWith("/")) return BASE + value;
  return BASE + "/" + value;
}

function text(v) {
  return v ? String(v).replace(/\s+/g, " ").trim() : "";
}

function mangaId(href) {
  const u = abs(href) || "";
  const p = u.replace(/^https?:\/\/[^/]+/i, "");
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

function titleFrom(el, a, id) {
  return text(a?.attr("title")) ||
    text(el.querySelector(".post-title")?.text()) ||
    text(el.querySelector(".manga-title")?.text()) ||
    text(el.querySelector(".tt")?.text()) ||
    text(el.querySelector("h2")?.text()) ||
    text(el.querySelector("h3")?.text()) ||
    text(a?.text()) || id;
}

function cards(doc) {
  const result = [];
  const seen = new Set();
  const containers = doc.querySelectorAll(
    ".c-tabs-item, .page-item-detail, .manga, .bs, .item, article, .post"
  );

  function addAnchor(a, container) {
    const id = mangaId(a.attr("href") || "");
    if (!id || seen.has(id)) return;
    const root = container || a;
    result.push({
      id,
      title: titleFrom(root, a, id),
      cover: imageFrom(root) || imageFrom(a)
    });
    seen.add(id);
  }

  for (const container of containers) {
    for (const a of container.querySelectorAll("a[href]")) {
      addAnchor(a, container);
    }
  }

  // Fallback for themes whose manga cards do not use the common containers.
  for (const a of doc.querySelectorAll("a[href*='/manga/']")) {
    addAnchor(a, null);
  }
  return result;
}

function chapterFromAnchor(a, seriesId) {
  const u = abs(a.attr("href") || "");
  if (!u) return null;
  const p = u.replace(/^https?:\/\/[^/]+/i, "").split(/[?#]/)[0];
  const m = p.match(/^\/manga\/([^/]+)\/([^/]+)\/?$/i);
  if (!m || decodeURIComponent(m[1]) !== seriesId) return null;

  const slug = decodeURIComponent(m[2]);
  const label = text(a.text()) || text(a.attr("title")) || slug;
  const numberMatch =
    label.match(/(?:chapter|ch\.?|الفصل|فصل)\s*#?\s*([0-9]+(?:\.[0-9]+)?)/i) ||
    slug.match(/(?:chapter|ch)[-\s_]*([0-9]+(?:\.[0-9]+)?)/i) ||
    slug.match(/([0-9]+(?:\.[0-9]+)?)/);
  const number = numberMatch ? numberMatch[1] : slug;
  return {
    id: u,
    chapter: number,
    title: label || "Chapter " + number,
    volume: null,
    pages: 0,
    language: "ar"
  };
}

function pageImageUrl(img) {
  return abs(img.attr("data-src") || img.attr("data-lazy-src") ||
    img.attr("data-original") || img.attr("data-cfsrc") ||
    img.attr("data-url") || img.attr("src"));
}

const plugin = {
  id: "mangalik",
  name: "مانجا ليك",

  async popular(offset) {
    const page = Math.floor((Number(offset) || 0) / PAGE_SIZE) + 1;
    const paths = page === 1
      ? ["/manga/", "/", "/latest/"]
      : ["/manga/page/" + page + "/", "/page/" + page + "/", "/latest/page/" + page + "/"];

    for (const path of paths) {
      try {
        const items = cards(await getDoc(path));
        if (items.length) return items;
      } catch (_) {}
    }
    return [];
  },

  async search(query, offset) {
    const q = text(query);
    if (!q) return [];
    const page = Math.floor((Number(offset) || 0) / PAGE_SIZE) + 1;
    const encoded = encodeURIComponent(q);
    const suffix = page > 1 ? "&paged=" + page : "";
    const paths = [
      "/?s=" + encoded + "&post_type=wp-manga" + suffix,
      "/manga/?s=" + encoded + "&post_type=wp-manga" + suffix,
      "/?s=" + encoded + (page > 1 ? "&paged=" + page : "")
    ];

    for (const path of paths) {
      try {
        const items = cards(await getDoc(path));
        if (items.length) return items;
      } catch (_) {}
    }
    return [];
  },

  async detail(id) {
    const doc = await getDoc("/manga/" + encodeURIComponent(id) + "/");
    const root = doc.querySelector(".profile-manga") || doc;
    const img = root.querySelector(".summary_image img") ||
      root.querySelector(".summary_image")?.querySelector("img") ||
      root.querySelector("img");
    const og = doc.querySelector("meta[property='og:image']");
    return {
      id,
      title: text(doc.querySelector("h1")?.text()) || id,
      cover: imageFrom(root) || abs(img?.attr("data-src") || img?.attr("data-lazy-src") ||
        img?.attr("data-original") || img?.attr("src") || og?.attr("content")),
      description: text(doc.querySelector(".description-summary")?.text()) ||
        text(doc.querySelector(".summary__content")?.text()) ||
        text(doc.querySelector(".description")?.text()),
      status: text(doc.querySelector(".manga-status .summary-content")?.text()) ||
        text(doc.querySelector(".post-status .summary-content")?.text()),
      author: text(doc.querySelector(".manga-authors .summary-content")?.text()) ||
        text(doc.querySelector(".author-content")?.text())
    };
  },

  async chapters(id) {
    const doc = await getDoc("/manga/" + encodeURIComponent(id) + "/");
    const result = [];
    const seen = new Set();
    for (const a of doc.querySelectorAll("a[href]")) {
      const c = chapterFromAnchor(a, id);
      if (c && !seen.has(c.id)) {
        seen.add(c.id);
        result.push(c);
      }
    }
    result.sort((a, b) => {
      const x = parseFloat(a.chapter);
      const y = parseFloat(b.chapter);
      if (Number.isNaN(x) || Number.isNaN(y)) return 0;
      return y - x;
    });
    return result;
  },

  async pageUrls(chapterId) {
    const u = abs(chapterId);
    if (!u) return [];
    const res = await harbor.http(u, { responseType: "text" });
    if (!res.ok) throw new Error("http " + res.status + " for chapter");
    const doc = harbor.parseHtml(res.body);
    const result = [];
    const seen = new Set();
    const selectors = [
      ".reading-content img",
      ".wp-manga-chapter-img",
      ".page-break img",
      ".chapter-content img",
      ".reader-area img",
      ".entry-content img"
    ];
    for (const selector of selectors) {
      for (const img of doc.querySelectorAll(selector)) {
        const url = pageImageUrl(img);
        if (url && !seen.has(url)) {
          seen.add(url);
          result.push(url);
        }
      }
      if (result.length) break;
    }
    return result;
  }
};

return plugin;