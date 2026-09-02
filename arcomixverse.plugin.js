// Harbor source for Arco Mixverse / Comicverse
const BASE = "https://arcomixverse.blogspot.com";
const PAGE_SIZE = 24;

function clean(value) {
  return value ? String(value).replace(/\s+/g, " ").trim() : "";
}

function abs(url) {
  if (!url) return undefined;
  var u = String(url).trim();
  if (!u || u.indexOf("data:") === 0) return undefined;
  if (/^https?:\/\//i.test(u)) return u;
  if (u.indexOf("//") === 0) return "https:" + u;
  if (u.charAt(0) === "/") return BASE + u;
  return BASE + "/" + u;
}

async function getDoc(url) {
  var res = await harbor.http(abs(url), {
    responseType: "text",
    timeoutMs: 30000,
    headers: { Referer: BASE + "/" }
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return harbor.parseHtml(res.body || "");
}

function imageOf(img) {
  if (!img) return undefined;
  return abs(img.attr("data-src") || img.attr("data-lazy-src") || img.attr("data-original") || img.attr("src"));
}

function numberOf(title) {
  var s = clean(title);
  var m = s.match(/(?:العدد|عدد|issue|chapter|ch\.?)[\s_-]*#?[\s_-]*(\d+(?:\.\d+)?)/i);
  if (!m) m = s.match(/#\s*(\d+(?:\.\d+)?)/i);
  return m ? m[1] : null;
}

function baseSeriesTitle(title) {
  var s = clean(title);
  s = s.replace(/\s*[-–—:]?\s*(?:العدد|عدد|issue|chapter|ch\.?)\s*#?\s*\d+(?:\.\d+)?\s*$/i, "");
  s = s.replace(/\s*#\s*\d+(?:\.\d+)?\s*$/, "");
  return clean(s);
}

function postLink(item) {
  if (!item) return null;
  return item.querySelector("h2.post-title a") || item.querySelector("h3.post-title a") || item.querySelector(".post-title a") || item.querySelector("h2 a") || item.querySelector("h3 a") || item.querySelector("a[href*='.html']");
}

function extractPosts(doc) {
  var selectors = [".post-outer", ".blog-post", "article.post", ".post"];
  var out = [];
  var seen = [];
  var i, j;
  for (i = 0; i < selectors.length; i++) {
    var items = doc.querySelectorAll(selectors[i]);
    if (!items.length) continue;
    for (j = 0; j < items.length; j++) {
      var item = items[j];
      var a = postLink(item);
      if (!a) continue;
      var href = abs(a.attr("href"));
      var title = clean(a.attr("title")) || clean(a.text());
      if (!href || !title || href.indexOf("arcomixverse.blogspot.com") < 0) continue;
      if (!/\.html(?:[?#]|$)/i.test(href) || seen.indexOf(href) >= 0) continue;
      seen.push(href);
      out.push({ id: href, title: title, cover: imageOf(item.querySelector(".post-body img") || item.querySelector("img")) });
    }
    if (out.length) return out;
  }
  return out;
}

function issueFromPost(p) {
  return { id: p.id, chapter: numberOf(p.title), title: p.title, volume: null, pages: 0, language: "ar" };
}

function sortIssues(list) {
  list.sort(function(a, b) {
    var na = parseFloat(a.chapter), nb = parseFloat(b.chapter);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return clean(a.title).localeCompare(clean(b.title), "ar");
  });
  return list;
}

function older(doc) {
  var a = doc.querySelector("a.blog-pager-older-link") || doc.querySelector("#Blog1_blog-pager-older-link") || doc.querySelector(".blog-pager-older-link");
  return a ? abs(a.attr("href")) : undefined;
}

function seriesTitle(doc) {
  var x = doc.querySelector(".post-title h1") || doc.querySelector("h1.post-title") || doc.querySelector("h2.post-title") || doc.querySelector(".post-title");
  return baseSeriesTitle(x && x.text());
}

function labelUrlFromDoc(doc, title) {
  var links = doc.querySelectorAll("a[href*='/search/label/']");
  var wanted = clean(title).toLowerCase();
  var i;
  for (i = 0; i < links.length; i++) {
    var a = links[i];
    var href = abs(a.attr("href"));
    var txt = clean(a.text()).toLowerCase();
    if (href && (!wanted || txt.indexOf(wanted) >= 0 || wanted.indexOf(txt) >= 0)) return href;
  }
  return undefined;
}

const plugin = {
  id: "arcomixverse",
  name: "Arco Mixverse",

  async popular(offset) {
    var start = Math.max(0, Number(offset) || 0);
    try {
      return extractPosts(await getDoc("/?max-results=" + PAGE_SIZE + "&start=" + start));
    } catch (_) {
      try { return extractPosts(await getDoc("/search?q=&max-results=" + PAGE_SIZE + "&start=" + start)); } catch (e) { return []; }
    }
  },

  async search(query, offset) {
    var q = clean(query);
    if (!q) return await plugin.popular(offset);
    var start = Math.max(0, Number(offset) || 0);
    try {
      return extractPosts(await getDoc("/search?q=" + encodeURIComponent(q) + "&max-results=" + PAGE_SIZE + "&start=" + start));
    } catch (_) { return []; }
  },

  async detail(id) {
    var url = abs(id);
    var doc = await getDoc(url);
    var title = seriesTitle(doc);
    var rawTitle = clean((doc.querySelector("h1.post-title") || doc.querySelector("h2.post-title") || doc.querySelector(".post-title") || doc.querySelector("h1"))?.text());
    var body = doc.querySelector(".post-body") || doc.querySelector(".post-content");
    var img = body ? body.querySelector("img") : doc.querySelector("img");
    return { id: url, title: title || rawTitle || url, cover: imageOf(img), description: clean(body && body.text()), author: clean((doc.querySelector(".fn") || doc.querySelector(".post-author"))?.text()), status: clean((doc.querySelector(".status") || doc.querySelector(".post-status"))?.text()) };
  },

  async chapters(id) {
    var url = abs(id);
    var doc = await getDoc(url);
    var title = seriesTitle(doc);
    if (!title) return [];

    var result = [];
    var seen = [];
    var label = labelUrlFromDoc(doc, title);
    if (!label) label = BASE + "/search/label/" + encodeURIComponent(title);

    var page = label;
    var guard = 0;
    while (page && guard < 20) {
      var pageDoc;
      try { pageDoc = await getDoc(page); } catch (_) { break; }
      var posts = extractPosts(pageDoc);
      var i;
      for (i = 0; i < posts.length; i++) {
        var p = posts[i];
        if (numberOf(p.title) === null) continue;
        if (seen.indexOf(p.id) >= 0) continue;
        var pt = baseSeriesTitle(p.title).toLowerCase();
        if (title.toLowerCase() && pt.indexOf(title.toLowerCase()) < 0 && title.toLowerCase().indexOf(pt) < 0) continue;
        seen.push(p.id);
        result.push(issueFromPost(p));
      }
      var next = older(pageDoc);
      if (!next || next === page) break;
      page = next;
      guard++;
    }
    return sortIssues(result);
  },

  async pageUrls(chapterId) {
    var doc = await getDoc(chapterId);
    var selectors = [".post-body img", ".entry-content img", ".post-content img", "article img"];
    var urls = [], seen = [], i, j;
    for (i = 0; i < selectors.length; i++) {
      var imgs = doc.querySelectorAll(selectors[i]);
      for (j = 0; j < imgs.length; j++) {
        var u = imageOf(imgs[j]);
        if (!u || seen.indexOf(u) >= 0 || /favicon|blogger_logo|avatar|profile|logo/i.test(u)) continue;
        seen.push(u); urls.push(u);
      }
      if (urls.length) break;
    }
    return urls;
  }
};

return plugin;
