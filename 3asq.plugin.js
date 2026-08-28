const BASE = "https://3asq.online";
const PAGE_SIZE = 48;

async function getDoc(path) {
  const res = await harbor.http(BASE + path, { responseType: "text", timeoutMs: 25000 });
  if (!res.ok) throw new Error("http " + res.status + " for " + path);
  return harbor.parseHtml(res.body);
}

function abs(url) {
  if (!url) return undefined;
  url = String(url).trim();
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return BASE + url;
  return BASE + "/" + url;
}

function clean(text) { return text ? String(text).replace(/\s+/g, " ").trim() : ""; }

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
  const m = String(href || "").match(/\/manga\/([^/?#]+)\/?(?:[?#].*)?$/i);
  return m ? m[1] : null;
}

function cardToSummary(el) {
  const link = el.querySelector("a") || el.querySelector("a.item-thumb") || el.querySelector("a.manga-title");
  if (!link) return null;
  const id = mangaIdFromHref(link.attr("href") || "");
  if (!id) return null;
  const img = el.querySelector("img");
  const title = clean(link.attr("title") || firstText(el, [".post-title", ".item-summary h3", ".item-summary .post-title", "h3", "h4"]) || link.text());
  if (!title) return null;
  return { id, title, cover: abs(img?.attr("data-src") || img?.attr("data-lazy-src") || img?.attr("src")) };
}

function findCards(doc) {
  for (const sel of [".page-item-detail.manga", ".c-tabs-item__content .row.c-tabs-item__content", ".row.c-tabs-item__content", ".tab-thumb.c-tabs-item__content", ".manga-item", ".item-summary"]) {
    const items = doc.querySelectorAll(sel);
    if (items.length) return items;
  }
  return [];
}

function chapterNumber(text, href) {
  const s = clean(text) || String(href || "");
  const m = s.match(/(?:chapter|الفصل)\s*([0-9]+(?:\.[0-9]+)?)/i) || s.match(/\/([0-9]+(?:\.[0-9]+)?)\/?(?:\?|$)/);
  return m ? m[1] : null;
}

function chapterFromLink(a) {
  const href = a.attr("href") || "";
  if (!href) return null;
  const title = clean(a.text());
  return {
    id: href.replace(/^https?:\/\/[^/]+\//i, "").replace(/^\//, ""),
    chapter: a.attr("data-number") || chapterNumber(title, href),
    title: title || undefined,
    pages: 1,
    language: "ar"
  };
}

const plugin = {
  id: "3asq",
  name: "العاشق",

  async popular(offset, tagId) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    let path = "/manga/?status=&type=&order=desc&orderby=meta_value_num&page=" + page;
    if (tagId) path += "&genre=" + encodeURIComponent(tagId);
    return findCards(await getDoc(path)).map(cardToSummary).filter(Boolean);
  },

  async search(query, offset, tagId) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    let path = "/manga/?s=" + encodeURIComponent(query) + "&post_type=wp-manga&page=" + page;
    if (tagId) path += "&genre=" + encodeURIComponent(tagId);
    return findCards(await getDoc(path)).map(cardToSummary).filter(Boolean);
  },

  async detail(id) {
    const doc = await getDoc("/manga/" + encodeURIComponent(id) + "/");
    const root = doc.querySelector(".site-content") || doc;
    return {
      id,
      title: clean(root.querySelector("h1")?.text()) || id,
      altTitle: firstText(root, [".alternative", ".post-content_item.manga_alternative .summary-content"]),
      cover: abs(firstAttr(root, [".summary_image", ".profile-manga", ".tab-summary .summary_image"], ["data-src", "data-lazy-src", "src"])),
      author: firstText(root, [".author-content", ".post-content_item.manga-authors .summary-content", ".post-content_item.manga-author .summary-content"]),
      status: firstText(root, [".post-content_item.manga-status .summary-content", ".post-content_item.manga_status .summary-content"]),
      description: firstText(root, [".summary__content", ".description-summary .summary__content", ".description-summary"]),
      lastChapter: firstText(root, [".wp-manga-chapter a", "li.wp-manga-chapter a"])
    };
  },

  async chapters(id) {
    const doc = await getDoc("/manga/" + encodeURIComponent(id) + "/");
    const links = doc.querySelectorAll("li.wp-manga-chapter a, .version-chap li.wp-manga-chapter a, .main.version-chap li a");
    const seen = new Set();
    const out = [];
    for (const a of links) {
      const c = chapterFromLink(a);
      if (!c || seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
    }
    return out;
  },

  async pageUrls(chapterId) {
    const path = "/" + String(chapterId).replace(/^\//, "");
    const res = await harbor.http(BASE + path, { responseType: "text", timeoutMs: 30000 });
    if (!res.ok) throw new Error("http " + res.status + " for " + path);
    const doc = await harbor.parseHtml(res.body);
    const urls = [];
    const seen = new Set();
    for (const sel of [".reading-content img", ".reading-content .page-break img", ".page-break img", ".wp-manga-chapter-img img", ".entry-content img"]) {
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
    const out = [], seen = new Set();
    for (const a of doc.querySelectorAll(".genres-content a, .genres a, .manga-genres a")) {
      const name = clean(a.text());
      const m = String(a.attr("href") || "").match(/\/genre\/([^/?#]+)/i);
      if (!name || !m || seen.has(m[1])) continue;
      seen.add(m[1]);
      out.push({ id: m[1], name, group: "Genre" });
    }
    return out;
  }
};
