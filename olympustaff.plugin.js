// Harbor source for OlympusStaff
const BASE = "https://olympustaff.com";
const PAGE_SIZE = 48;

function clean(text) { return text ? String(text).replace(/\s+/g, " ").trim() : ""; }
function abs(url) {
  if (!url) return undefined;
  url = String(url).trim();
  if (!url || url.startsWith("data:")) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return BASE + url;
  return BASE + "/" + url;
}
async function getDoc(path) {
  const res = await harbor.http(BASE + path, { responseType: "text", timeoutMs: 30000, headers: { Referer: BASE + "/" } });
  if (!res.ok) throw new Error("http " + res.status + " for " + path);
  return harbor.parseHtml(res.body || "");
}
function firstText(el, selectors) {
  for (const sel of selectors) { const x = el?.querySelector(sel); const t = clean(x?.text()); if (t) return t; }
  return undefined;
}
function firstAttr(el, selectors, attrs) {
  for (const sel of selectors) { const x = el?.querySelector(sel); if (!x) continue; for (const a of attrs) { const v = x.attr(a); if (v) return abs(v); } }
  return undefined;
}
function mangaIdFromHref(href) {
  if (!href) return null;
  const s = String(href).replace(/^https?:\/\/[^/]+/i, "");
  const m = s.match(/^\/series\/([^/?#]+)\/?$/i);
  return m ? decodeURIComponent(m[1]) : null;
}
function cardToSummary(el) {
  const links = el.querySelectorAll("a[href^='/series/']");
  let link = null;
  for (const a of links) { if (mangaIdFromHref(a.attr("href") || "")) { link = a; break; } }
  if (!link) return null;
  const id = mangaIdFromHref(link.attr("href") || "");
  const title = clean(link.attr("title") || firstText(el, ["h1", "h2", "h3", "h4", ".title", ".name"]) || link.text());
  if (!id || !title || /^(الفصل|فصل|chapter|chap)\s*[0-9]/i.test(title)) return null;
  const img = el.querySelector("img");
  return { id, title, cover: abs(img?.attr("data-src") || img?.attr("data-lazy-src") || img?.attr("data-original") || img?.attr("src")) };
}
function findCards(doc) {
  const out = [], seen = new Set();
  for (const sel of ["article", "div[class*='card']", "div.relative.overflow-hidden"]) {
    for (const el of doc.querySelectorAll(sel)) {
      const item = cardToSummary(el);
      if (item && !seen.has(item.id)) { seen.add(item.id); out.push(item); }
    }
    if (out.length) return out;
  }
  // Last resort: build cards from unique /series/ links, but never treat chapter URLs as manga.
  for (const a of doc.querySelectorAll("a[href^='/series/']")) {
    const id = mangaIdFromHref(a.attr("href") || "");
    if (!id || seen.has(id)) continue;
    const title = clean(a.attr("title") || a.text());
    if (!title || /^(الفصل|فصل|chapter|chap)\s*[0-9]/i.test(title)) continue;
    seen.add(id);
    const parent = a.parentElement;
    const img = parent?.querySelector("img");
    out.push({ id, title, cover: abs(img?.attr("data-src") || img?.attr("data-srcset") || img?.attr("src")) });
  }
  return out;
}
function chapterNumber(text, href) {
  const m = String(href || "").match(/\/series\/[^/?#]+\/([0-9]+(?:\.[0-9]+)?)\/?(?:\?|#|$)/i);
  if (m) return m[1];
  const x = clean(text).match(/(?:الفصل|فصل|chapter|chap)\s*(?:رقم)?\s*#?\s*([0-9]+(?:\.[0-9]+)?)/i);
  return x ? x[1] : null;
}
function chapterFromLink(a) {
  const href = abs(a.attr("href") || "");
  if (!href || !/\/series\/[^/?#]+\/[0-9]+(?:\.[0-9]+)?\/?(?:\?|#|$)/i.test(href)) return null;
  const number = chapterNumber(a.text(), href);
  if (!number) return null;
  return { id: href, chapter: number, title: clean(a.text()) || "الفصل " + number, volume: null, pages: 0, language: "ar" };
}
function chaptersFromDoc(doc) {
  const out = [], seen = new Set();
  for (const a of doc.querySelectorAll("a[href^='/series/']")) {
    const c = chapterFromLink(a);
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id); out.push(c);
  }
  out.sort((a,b) => parseFloat(b.chapter) - parseFloat(a.chapter));
  return out;
}
function addPage(url, urls, seen) {
  url = abs(url);
  if (!url || seen.has(url) || !/\.(?:jpe?g|png|webp|gif)(?:\?|#|$)/i.test(url)) return;
  if (/logo|avatar|favicon|icon|banner|sprite/i.test(url)) return;
  seen.add(url); urls.push(url);
}
function pageUrlsFromDoc(doc) {
  const urls = [], seen = new Set();
  for (const a of doc.querySelectorAll("a[href]")) addPage(a.attr("href"), urls, seen);
  for (const img of doc.querySelectorAll("img")) {
    addPage(img.attr("data-src"), urls, seen);
    addPage(img.attr("data-lazy-src"), urls, seen);
    addPage(img.attr("data-original"), urls, seen);
    addPage(img.attr("src"), urls, seen);
  }
  return urls;
}
const plugin = {
  id: "olympustaff", name: "OlympusStaff",
  async popular(offset) { return findCards(await getDoc("/series?page=" + (Math.floor(offset / PAGE_SIZE) + 1))); },
  async search(query, offset) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    for (const path of ["/series?search=" + encodeURIComponent(query) + "&page=" + page, "/series?searchTerm=" + encodeURIComponent(query) + "&page=" + page]) {
      try { const list = findCards(await getDoc(path)); if (list.length) return list; } catch (_) {}
    }
    return [];
  },
  async detail(id) {
    const doc = await getDoc("/series/" + encodeURIComponent(id)); const root = doc.querySelector("main") || doc;
    return { id, title: clean(root.querySelector("h1")?.text()) || id, cover: firstAttr(root,["img"],["data-src","data-lazy-src","data-original","src"]), author: firstText(root,[".author",".artist",".writer"]), status: firstText(root,[".status"]), description: firstText(root,[".description",".summary",".entry-content",".manga-description"]) };
  },
  async chapters(id) { return chaptersFromDoc(await getDoc("/series/" + encodeURIComponent(id))); },
  async pageUrls(chapterId) { const path = "/" + String(chapterId).replace(/^https?:\/\/[^/]+/i, "").replace(/^\//, ""); return pageUrlsFromDoc(await getDoc(path)); },
  async tags() { return []; }
};
return plugin;
