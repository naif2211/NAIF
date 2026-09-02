const BASE = "https://arcomixverse.blogspot.com";
const PAGE_SIZE = 20;

async function getDoc(path) {
  const url = /^https?:\/\//i.test(path) ? path : BASE + path;
  const res = await harbor.http(url, { responseType: "text" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return harbor.parseHtml(res.body || "");
}

function abs(url) {
  if (!url) return undefined;
  url = String(url).trim();
  if (/^https?:\/\//i.test(url)) return url;
  if (url.indexOf("//") === 0) return "https:" + url;
  if (url.charAt(0) === "/") return BASE + url;
  return BASE + "/" + url;
}

function text(v) { return v ? String(v).replace(/\s+/g, " ").trim() : ""; }

function imageUrl(img) {
  if (!img) return undefined;
  return abs(img.attr("data-src") || img.attr("data-original") || img.attr("data-lazy-src") || img.attr("src"));
}

function isChapterTitle(title) {
  return /(?:العدد|عدد|chapter|ch\.?)[\s_-]*#?[\s_-]*\d+/i.test(title) || /#\s*\d+/.test(title);
}

function chapterNumber(title) {
  const t = text(title);
  let m = t.match(/(?:العدد|عدد|chapter|ch\.?)[\s_-]*#?[\s_-]*(\d+(?:\.\d+)?)/i);
  if (m) return m[1];
  m = t.match(/#\s*(\d+(?:\.\d+)?)/);
  return m ? m[1] : null;
}

function postItems(doc) {
  const selectors = [".post-outer", ".blog-post", ".post"];
  for (const selector of selectors) {
    const items = doc.querySelectorAll(selector);
    if (items.length) return items;
  }
  return [];
}

function getPost(item) {
  const a = item.querySelector("h2.post-title a") ||
    item.querySelector("h3.post-title a") ||
    item.querySelector(".post-title a") ||
    item.querySelector("h2 a") ||
    item.querySelector("h3 a");
  if (!a) return null;
  const id = abs(a.attr("href"));
  const title = text(a.attr("title")) || text(a.text());
  if (!id || !title) return null;
  return { id: id, title: title, cover: imageUrl(item.querySelector(".post-body img") || item.querySelector("img")) };
}

function listFromDoc(doc) {
  const out = [];
  const seen = new Set();
  for (const item of postItems(doc)) {
    const p = getPost(item);
    if (!p || seen.has(p.id) || isChapterTitle(p.title)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

const plugin = {
  id: "arcomixverse",
  name: "Arco Mixverse",

  async popular(offset) {
    const start = Math.max(0, Number(offset) || 0);
    const paths = [
      "/?max-results=" + PAGE_SIZE + "&start=" + start,
      "/search?max-results=" + PAGE_SIZE + "&start=" + start
    ];
    for (const path of paths) {
      try {
        const result = listFromDoc(await getDoc(path));
        if (result.length) return result;
      } catch (_) {}
    }
    return [];
  },

  async search(query, offset) {
    const q = text(query);
    if (!q) return this.popular(offset);
    const start = Math.max(0, Number(offset) || 0);
    try {
      return listFromDoc(await getDoc("/search?q=" + encodeURIComponent(q) + "&max-results=" + PAGE_SIZE + "&start=" + start));
    } catch (_) {
      return [];
    }
  },

  async detail(id) {
    const url = /^https?:\/\//i.test(id) ? id : abs(id);
    const doc = await getDoc(url);
    const titleEl = doc.querySelector("h1.post-title") || doc.querySelector("h2.post-title") || doc.querySelector(".post-title") || doc.querySelector("h1");
    const body = doc.querySelector(".post-body") || doc.querySelector(".post-content");
    const img = body ? (body.querySelector("img") || doc.querySelector("img")) : doc.querySelector("img");
    const authorEl = doc.querySelector(".fn") || doc.querySelector(".post-author");
    const statusEl = doc.querySelector(".status");
    return {
      id: url,
      title: text(titleEl && titleEl.text()) || url,
      cover: imageUrl(img),
      description: text(body && body.text()),
      author: text(authorEl && authorEl.text()),
      status: text(statusEl && statusEl.text())
    };
  },

  async chapters(id) {
    const url = /^https?:\/\//i.test(id) ? id : abs(id);
    const doc = await getDoc(url);
    const titleEl = doc.querySelector("h1.post-title") || doc.querySelector("h2.post-title") || doc.querySelector(".post-title") || doc.querySelector("h1");
    const seriesTitle = text(titleEl && titleEl.text());
    const result = [];
    const seen = new Set();

    // Direct issue links, when present.
    for (const a of doc.querySelectorAll("a[href]")) {
      const label = text(a.attr("title")) || text(a.text());
      const href = abs(a.attr("href"));
      if (!href || href.indexOf("arcomixverse.blogspot.com") < 0 || !/\.html(?:[?#]|$)/i.test(href)) continue;
      if (!isChapterTitle(label)) continue;
      if (seen.has(href)) continue;
      seen.add(href);
      result.push({ id: href, chapter: chapterNumber(label), title: label, volume: null, pages: 0, language: "ar" });
    }

    // Issues are separate Blogger posts. Walk search pages so middle issues are included.
    if (seriesTitle) {
      for (let page = 0; page < 10; page++) {
        const start = page * PAGE_SIZE;
        let sdoc;
        try {
          sdoc = await getDoc("/search?q=" + encodeURIComponent(seriesTitle) + "&max-results=" + PAGE_SIZE + "&start=" + start);
        } catch (_) {
          break;
        }
        const items = postItems(sdoc);
        if (!items.length) break;
        let added = 0;
        for (const item of items) {
          const p = getPost(item);
          if (!p || !isChapterTitle(p.title)) continue;
          if (p.title.toLowerCase().indexOf(seriesTitle.toLowerCase()) < 0) continue;
          if (seen.has(p.id)) continue;
          seen.add(p.id);
          result.push({ id: p.id, chapter: chapterNumber(p.title), title: p.title, volume: null, pages: 0, language: "ar" });
          added++;
        }
        if (items.length < PAGE_SIZE || added === 0) break;
      }
    }

    result.sort((a, b) => {
      const na = parseFloat(a.chapter);
      const nb = parseFloat(b.chapter);
      if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
      return text(a.title).localeCompare(text(b.title), "ar");
    });
    return result;
  },

  async pageUrls(chapterId) {
    const url = /^https?:\/\//i.test(chapterId) ? chapterId : abs(chapterId);
    const doc = await getDoc(url);
    const result = [];
    const seen = new Set();
    for (const selector of [".post-body img", ".entry-content img", ".post-content img", "article img"]) {
      for (const img of doc.querySelectorAll(selector)) {
        const u = imageUrl(img);
        if (!u || seen.has(u) || /favicon|blogger_logo|avatar|profile/i.test(u)) continue;
        seen.add(u);
        result.push(u);
      }
      if (result.length) break;
    }
    return result;
  }
};

return plugin;
