// Arco Mixverse / Comicverse source for Harbor
const BASE = "https://arcomixverse.blogspot.com";
const PAGE_SIZE = 20;

async function getDoc(url) {
  const target = /^https?:\/\//i.test(url) ? url : BASE + url;
  const res = await harbor.http(target, { responseType: "text" });
  if (!res.ok) throw new Error("HTTP " + res.status + " - " + target);
  return harbor.parseHtml(res.body || "");
}

function abs(url) {
  if (!url) return undefined;
  const u = String(url).trim();
  if (/^https?:\/\//i.test(u)) return u;
  if (u.indexOf("//") === 0) return "https:" + u;
  if (u.charAt(0) === "/") return BASE + u;
  return BASE + "/" + u;
}

function text(v) {
  return v ? String(v).replace(/\s+/g, " ").trim() : "";
}

function imageUrl(img) {
  if (!img) return undefined;
  return abs(img.attr("data-src") || img.attr("data-original") || img.attr("data-lazy-src") || img.attr("src"));
}

function chapterNumber(title) {
  const t = text(title);
  let m = t.match(/(?:العدد|عدد|chapter|ch\.?|issue)[\s_-]*#?[\s_-]*(\d+(?:\.\d+)?)/i);
  if (m) return m[1];
  m = t.match(/#\s*(\d+(?:\.\d+)?)/i);
  if (m) return m[1];
  return null;
}

function isChapter(title) {
  const t = text(title);
  return !!chapterNumber(t);
}

function postItems(doc) {
  for (const s of [".post-outer", ".blog-post", ".post h2.post-title", ".post"]) {
    const items = doc.querySelectorAll(s);
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
  const href = abs(a.attr("href"));
  const title = text(a.attr("title")) || text(a.text());
  if (!href || !title) return null;
  return {
    id: href,
    title: title,
    cover: imageUrl(item.querySelector(".post-body img") || item.querySelector("img"))
  };
}

function listPosts(doc, chaptersOnly) {
  const out = [];
  const seen = new Set();
  for (const item of postItems(doc)) {
    const p = getPost(item);
    if (!p || seen.has(p.id)) continue;
    if (chaptersOnly && !isChapter(p.title)) continue;
    if (!chaptersOnly && isChapter(p.title)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

function olderLink(doc) {
  const a = doc.querySelector("a.blog-pager-older-link") ||
    doc.querySelector("#Blog1_blog-pager-older-link") ||
    doc.querySelector(".blog-pager-older-link");
  return a ? abs(a.attr("href")) : undefined;
}

function labelFromRaw(html, seriesTitle) {
  const wanted = text(seriesTitle).toLowerCase();
  const re = /<a\b[^>]*href=["']([^"']*\/search\/label\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const label = text(m[2].replace(/<[^>]+>/g, " "));
    if (!wanted || label.toLowerCase().indexOf(wanted) >= 0 || wanted.indexOf(label.toLowerCase()) >= 0) {
      return abs(m[1].replace(/&amp;/g, "&"));
    }
  }
  return undefined;
}

const plugin = {
  id: "arcomixverse",
  name: "Arco Mixverse",

  async popular(offset) {
    const start = Math.max(0, Number(offset) || 0);
    const paths = start === 0
      ? ["/?max-results=" + PAGE_SIZE, "/search?q=&max-results=" + PAGE_SIZE]
      : ["/?max-results=" + PAGE_SIZE + "&start=" + start, "/search?q=&max-results=" + PAGE_SIZE + "&start=" + start];

    for (const path of paths) {
      try {
        const result = listPosts(await getDoc(path), false);
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
      return listPosts(await getDoc("/search?q=" + encodeURIComponent(q) + "&max-results=" + PAGE_SIZE + "&start=" + start), false);
    } catch (_) {
      return [];
    }
  },

  async detail(id) {
    const url = abs(id);
    const doc = await getDoc(url);
    const titleEl = doc.querySelector("h1.post-title") || doc.querySelector("h2.post-title") || doc.querySelector(".post-title") || doc.querySelector("h1");
    const body = doc.querySelector(".post-body") || doc.querySelector(".post-content");
    const img = body ? (body.querySelector("img") || doc.querySelector("img")) : doc.querySelector("img");
    return {
      id: url,
      title: text(titleEl && titleEl.text()) || url,
      cover: imageUrl(img),
      description: text(body && body.text()),
      author: text((doc.querySelector(".fn") || doc.querySelector(".post-author"))?.text()),
      status: text(doc.querySelector(".status")?.text())
    };
  },

  async chapters(id) {
    const url = abs(id);
    const htmlRes = await harbor.http(url, { responseType: "text" });
    if (!htmlRes.ok) throw new Error("HTTP " + htmlRes.status);
    const raw = htmlRes.body || "";
    const doc = harbor.parseHtml(raw);

    const titleEl = doc.querySelector("h1.post-title") || doc.querySelector("h2.post-title") || doc.querySelector(".post-title") || doc.querySelector("h1");
    const seriesTitle = text(titleEl && titleEl.text());
    const result = [];
    const seen = new Set();

    // First use any issue links already present on the series page.
    for (const a of doc.querySelectorAll("a[href]")) {
      const label = text(a.attr("title")) || text(a.text());
      const href = abs(a.attr("href"));
      if (!href || href.indexOf("arcomixverse.blogspot.com") < 0) continue;
      if (!/\.html(?:[?#]|$)/i.test(href) || !isChapter(label)) continue;
      if (seen.has(href)) continue;
      seen.add(href);
      result.push({ id: href, chapter: chapterNumber(label), title: label, volume: null, pages: 0, language: "ar" });
    }

    // Comicverse groups every series' issues under a Blogger label.
    // Find that label from the page; if unavailable, construct it from the series title.
    let labelUrl = labelFromRaw(raw, seriesTitle);
    if (!labelUrl) {
      const labelAnchors = doc.querySelectorAll("a[href*='/search/label/']");
      for (const a of labelAnchors) {
        const href = abs(a.attr("href"));
        const label = text(a.text());
        if (href && (!seriesTitle || label.toLowerCase().indexOf(seriesTitle.toLowerCase()) >= 0)) {
          labelUrl = href;
          break;
        }
      }
    }
    if (!labelUrl && seriesTitle) {
      labelUrl = BASE + "/search/label/" + encodeURIComponent(seriesTitle);
    }

    if (labelUrl) {
      let pageUrl = labelUrl;
      for (let page = 0; page < 30 && pageUrl; page++) {
        let pageDoc;
        try {
          pageDoc = await getDoc(pageUrl);
        } catch (_) {
          break;
        }

        for (const p of listPosts(pageDoc, true)) {
          if (seen.has(p.id)) continue;
          // Keep only issue posts belonging to this series when the title is explicit.
          if (seriesTitle && p.title.toLowerCase().indexOf(seriesTitle.toLowerCase()) < 0) continue;
          seen.add(p.id);
          result.push({ id: p.id, chapter: chapterNumber(p.title), title: p.title, volume: null, pages: 0, language: "ar" });
        }

        const next = olderLink(pageDoc);
        if (!next || next === pageUrl) break;
        pageUrl = next;
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
    const url = abs(chapterId);
    const doc = await getDoc(url);
    const result = [];
    const seen = new Set();

    // Comicverse reader pages expose the comic pages directly in post-body.
    for (const img of doc.querySelectorAll(".post-body img")) {
      const u = imageUrl(img);
      if (!u || seen.has(u)) continue;
      if (/favicon|blogger_logo|avatar|profile/i.test(u)) continue;
      seen.add(u);
      result.push(u);
    }

    // Fallback for older layouts.
    if (!result.length) {
      for (const selector of [".entry-content img", ".post-content img", "article img", "img"]) {
        for (const img of doc.querySelectorAll(selector)) {
          const u = imageUrl(img);
          if (!u || seen.has(u)) continue;
          if (/favicon|blogger_logo|avatar|profile/i.test(u)) continue;
          seen.add(u);
          result.push(u);
        }
        if (result.length) break;
      }
    }
    return result;
  }
};

return plugin;
