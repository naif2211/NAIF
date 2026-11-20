// Harbor source for AREA Manga (ar.kenmanga.com)
// Based on the site's MangaThemesia layout and secure chapter image endpoint.
const BASE = "https://ar.kenmanga.com";
const PAGE_SIZE = 24;

function clean(value) {
  return value ? String(value).replace(/\s+/g, " ").trim() : "";
}

function abs(url) {
  if (!url) return undefined;
  const value = String(url).trim();
  if (!value || /^(data|blob):/i.test(value)) return undefined;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("//")) return "https:" + value;
  if (value.startsWith("/")) return BASE + value;
  return BASE + "/" + value;
}

async function request(urlOrPath, options) {
  const url = /^https?:\/\//i.test(urlOrPath) ? urlOrPath : BASE + urlOrPath;
  const opts = Object.assign({
    responseType: "text",
    timeoutMs: 30000,
    headers: { Referer: BASE + "/" }
  }, options || {});
  const response = await harbor.http(url, opts);
  if (!response.ok) throw new Error("HTTP " + response.status + " while requesting " + url);
  return response.body || "";
}

async function getDoc(path) {
  return harbor.parseHtml(await request(path));
}

function mangaId(href) {
  const path = (abs(href) || "").replace(/^https?:\/\/[^/]+/i, "").split(/[?#]/)[0];
  const match = path.match(/^\/manga\/([^/]+)\/?$/i);
  return match ? decodeURIComponent(match[1]) : null;
}

function imageUrl(img) {
  if (!img) return undefined;
  return abs(img.attr("data-lazy-src") || img.attr("data-src") ||
    img.attr("data-cfsrc") || img.attr("data-original") || img.attr("src"));
}

function parseMangaCards(doc) {
  const results = [];
  const seen = new Set();
  for (const card of doc.querySelectorAll(".listupd .manga-card-v")) {
    const link = card.querySelector(".bigor .tt[href]") ||
      card.querySelector("h3 a[href]") ||
      card.querySelector("a[href*='/manga/']");
    if (!link) continue;
    const id = mangaId(link.attr("href"));
    if (!id || seen.has(id)) continue;

    const img = card.querySelector("img");
    const title = clean(card.querySelector(".bigor .tt")?.text()) ||
      clean(card.querySelector("h3 a")?.text()) ||
      clean(link.attr("title")) || clean(img?.attr("alt")) || id;

    results.push({ id, title, cover: imageUrl(img) });
    seen.add(id);
  }
  return results;
}

function parseChapterNumber(element, link) {
  const label = clean(element.querySelector(".chap-num")?.text()) ||
    clean(link?.text()) || clean(link?.attr("title"));
  const match = label.match(/([0-9]+(?:\.[0-9]+)?)/);
  return match ? match[1] : label;
}

function parseChapters(doc, mangaIdValue) {
  const results = [];
  const seen = new Set();
  for (const item of doc.querySelectorAll("#chapters-list-container .ch-item")) {
    const link = item.querySelector("a[href]");
    if (!link) continue;
    const url = abs(link.attr("href"));
    if (!url || seen.has(url)) continue;

    const number = parseChapterNumber(item, link);
    if (!number) continue;
    const date = clean(item.querySelector(".chap-date")?.text());
    results.push({
      id: url,
      chapter: number,
      title: clean(link.text()) || "الفصل " + number,
      volume: null,
      pages: 0,
      language: "ar",
      date
    });
    seen.add(url);
  }
  return results;
}
function encodeForm(values) {
  return Object.keys(values).map(key =>
    encodeURIComponent(key) + "=" + encodeURIComponent(String(values[key]))
  ).join("&");
}

function imageFromReader(img) {
  return abs(img.attr("data-lazy-src") || img.attr("data-src") ||
    img.attr("data-cfsrc") || img.attr("data-original") ||
    img.attr("data-url") || img.attr("src"));
}

const plugin = {
  id: "areamanga",
  name: "أريا مانجا",

  async popular(offset) {
    const page = Math.floor((Number(offset) || 0) / PAGE_SIZE) + 1;
    const doc = await getDoc("/manga/?order=popular&page=" + page);
    return parseMangaCards(doc);
  },

  async search(query, offset) {
    const term = clean(query);
    if (!term) return [];
    const page = Math.floor((Number(offset) || 0) / PAGE_SIZE) + 1;
    const doc = await getDoc("/manga/?title=" + encodeURIComponent(term) + "&page=" + page);
    return parseMangaCards(doc);
  },

  async detail(id) {
    const doc = await getDoc("/manga/" + encodeURIComponent(id) + "/");
    const root = doc.querySelector("div.legendary-single-page") || doc;
    const image = root.querySelector(".manga-poster img");
    const title = clean(root.querySelector(".manga-title-large")?.text()) ||
      clean(doc.querySelector("h1")?.text()) || id;

    return {
      id,
      title,
      cover: imageUrl(image),
      description: clean(root.querySelector("div.story-text")?.text()),
      author: clean(root.querySelector(".info-label:contains(المؤلف) + span")?.text()),
      artist: clean(root.querySelector(".info-label:contains(الرسام) + span")?.text()),
      status: clean(root.querySelector(".info-label:contains(الحالة) + span")?.text()),
      genres: Array.from(root.querySelectorAll("div.filter-tags a")).map(a => clean(a.text())).filter(Boolean)
    };
  },

  async chapters(id) {
    const doc = await getDoc("/manga/" + encodeURIComponent(id) + "/");
    return parseChapters(doc, id);
  },

  async pageUrls(chapterId) {
    const chapterUrl = abs(chapterId);
    if (!chapterUrl) return [];

    const chapterDoc = await getDoc(chapterUrl);
    const chapterPostId = clean(
      chapterDoc.querySelector("#comment_post_ID")?.attr("value")
    );
    if (!chapterPostId) {
      throw new Error("لم يتم العثور على معرف الفصل comment_post_ID.");
    }

    const body = encodeForm({
      action: "get_secure_chapter_images",
      chapter_id: chapterPostId
    });

    const responseText = await request("/wp-admin/admin-ajax.php", {
      method: "POST",
      responseType: "text",
      timeoutMs: 30000,
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-requested-with": "XMLHttpRequest",
        Referer: chapterUrl
      },
      body
    });

    let payload;
    try {
      payload = JSON.parse(responseText);
    } catch (_) {
      throw new Error("استجابة خادم صور الفصل ليست JSON صالحاً.");
    }

    if (!payload || payload.success !== true || !payload.data) {
      throw new Error("فشل الموقع في إرجاع صور الفصل.");
    }

    if (payload.data.status === "locked") {
      throw new Error("الفصل مقفل في الموقع؛ افتحه من المتصفح أولاً إذا كان يتطلب فك القفل.");
    }
    if (payload.data.status !== "unlocked" || !payload.data.content) {
      throw new Error("محتوى صور الفصل غير متاح: " + clean(payload.data.status));
    }

    const readerDoc = harbor.parseHtml(payload.data.content);
    const urls = [];
    const seen = new Set();
    for (const img of readerDoc.querySelectorAll("img")) {
      const url = imageFromReader(img);
      if (url && !seen.has(url)) {
        urls.push(url);
        seen.add(url);
      }
    }
    return urls;
  }
};

return plugin;