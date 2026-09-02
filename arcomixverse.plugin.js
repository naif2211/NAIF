const BASE = "https://arcomixverse.blogspot.com";

async function getRaw(path) {
  const url = /^https?:\/\//i.test(path) ? path : BASE + path;
  const res = await harbor.http(url, { responseType: "text" });
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
  return res.body || "";
}

function abs(url, base) {
  if (!url) return undefined;
  url = String(url).trim();
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return "https:" + url;
  const b = base || BASE;
  if (url.startsWith("/")) return b + url;
  return b.replace(/\/$/, "") + "/" + url;
}

function text(v) {
  return (v || "").replace(/\s+/g, " ").trim();
}

function decode(v) {
  return (v || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractLinks(html) {
  const out = [];
  const seen = new Set();
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    let href = decode(m[1]);
    if (href.startsWith("//")) href = "https:" + href;
    else if (!/^https?:\/\//i.test(href)) href = abs(href);
    const label = text((m[2] || "").replace(/<[^>]+>/g, " "));
    if (!href || !/^https?:\/\//i.test(href)) continue;
    if (!href.includes("arcomixverse.blogspot.com")) continue;
    if (!seen.has(href)) {
      seen.add(href);
      out.push({ href, label });
    }
  }
  return out;
}

function extractImages(html, pageUrl) {
  const out = [];
  const seen = new Set();
  const patterns = [
    /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi,
    /<img\b[^>]*\bdata-(?:src|original|lazy-src)\s*=\s*["']([^"']+)["'][^>]*>/gi
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(html))) {
      let src = decode(m[1]);
      if (!src || /^data:/i.test(src)) continue;
      src = abs(src, pageUrl);
      if (!src || /favicon|blogger_logo/i.test(src)) continue;
      if (!seen.has(src)) {
        seen.add(src);
        out.push(src);
      }
    }
  }
  return out;
}

function extractIframes(html, pageUrl) {
  const out = [];
  const seen = new Set();
  const re = /<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    let src = decode(m[1]);
    src = abs(src, pageUrl);
    if (src && !seen.has(src)) {
      seen.add(src);
      out.push(src);
    }
  }
  return out;
}

function chapterNumber(title) {
  const t = text(title);
  let m = t.match(/(?:العدد|عدد|chapter|ch)\s*#?\s*(\d+(?:\.\d+)?)/i);
  if (m) return m[1];
  m = t.match(/#\s*(\d+(?:\.\d+)?)/);
  return m ? m[1] : null;
}

function makeSummary(post) {
  const a = post.querySelector("h2.post-title a") || post.querySelector("h3.post-title a") || post.querySelector(".post-title a");
  if (!a) return null;
  const href = a.attr("href");
  const title = text(a.text());
  if (!href || !title) return null;
  const img = post.querySelector(".post-body img, img");
  return {
    id: href,
    title,
    cover: abs(img?.attr("data-src") || img?.attr("data-original") || img?.attr("src"))
  };
}

const plugin = {
  id: "arcomixverse",
  name: "Arco Mixverse",

  async popular(offset) {
    const start = Math.max(0, Number(offset) || 0);
    const doc = harbor.parseHtml(await getRaw("/search?q=&max-results=20&start=" + start));
    return doc.querySelectorAll(".post-outer, .blog-post, .post").map(makeSummary).filter(Boolean);
  },

  async search(query, offset) {
    const start = Math.max(0, Number(offset) || 0);
    const doc = harbor.parseHtml(await getRaw("/search?q=" + encodeURIComponent(query) + "&max-results=20&start=" + start));
    return doc.querySelectorAll(".post-outer, .blog-post, .post").map(makeSummary).filter(Boolean);
  },

  async detail(id) {
    const url = /^https?:\/\//i.test(id) ? id : abs(id);
    const html = await getRaw(url);
    const doc = harbor.parseHtml(html);
    const title = text(doc.querySelector("h1.post-title")?.text() || doc.querySelector("h2.post-title")?.text() || doc.querySelector("h1")?.text()) || id;
    const img = doc.querySelector(".post-body img, .post img, img");
    return {
      id: url,
      title,
      cover: abs(img?.attr("data-src") || img?.attr("data-original") || img?.attr("src")),
      description: text(doc.querySelector(".post-body")?.text()),
      author: text(doc.querySelector(".fn")?.text() || doc.querySelector(".post-author")?.text()),
      status: text(doc.querySelector(".status")?.text()) || undefined
    };
  },

  async chapters(id) {
    const url = /^https?:\/\//i.test(id) ? id : abs(id);
    const html = await getRaw(url);
    const doc = harbor.parseHtml(html);
    const seriesTitle = text(doc.querySelector("h1.post-title")?.text() || doc.querySelector("h2.post-title")?.text() || doc.querySelector("h1")?.text());
    let links = extractLinks(html);

    let candidates = links.filter(x => /\.html(?:[?#]|$)/i.test(x.href) && (/(?:العدد|chapter|ch)\s*#?\s*\d+/i.test(x.label) || /#\s*\d+/.test(x.label)));

    if (!candidates.length && seriesTitle) {
      const searchHtml = await getRaw("/search?q=" + encodeURIComponent(seriesTitle) + "&max-results=150");
      candidates = extractLinks(searchHtml).filter(x => /\.html(?:[?#]|$)/i.test(x.href) && (x.label.toLowerCase().includes(seriesTitle.toLowerCase()) || /(?:العدد|chapter|ch)\s*#?\s*\d+/i.test(x.label) || /#\s*\d+/.test(x.label)));
    }

    const seen = new Set();
    const chapters = candidates.filter(x => {
      if (seen.has(x.href)) return false;
      seen.add(x.href);
      return true;
    }).map((x, i) => ({
      id: x.href,
      chapter: chapterNumber(x.label),
      title: x.label || ("Chapter " + (i + 1)),
      volume: null,
      pages: 0,
      language: "ar"
    }));

    chapters.sort((a, b) => {
      const na = parseFloat(a.chapter), nb = parseFloat(b.chapter);
      if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
      return a.title.localeCompare(b.title, "ar");
    });
    return chapters;
  },

  async pageUrls(chapterId) {
    const url = /^https?:\/\//i.test(chapterId) ? chapterId : abs(chapterId);
    const html = await getRaw(url);

    const iframes = extractIframes(html, url);
    for (const iframe of iframes) {
      try {
        const res = await harbor.http(iframe, { responseType: "text" });
        if (!res.ok) continue;
        const images = extractImages(res.body || "", iframe);
        if (images.length) return images;
      } catch (_) {}
    }

    return extractImages(html, url);
  }
};

return plugin;
