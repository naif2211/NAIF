// Harbor manga source for StellarSaber (stellarsaber.pro)
// Updated for the site's current Flavor/Madara markup and AJAX search.
const BASE = "https://stellarsaber.pro";
const PAGE_SIZE = 48;

function clean(value) {
  return value == null ? "" : String(value).replace(/\s+/g, " ").trim();
}

function abs(value) {
  if (!value) return undefined;
  const url = String(value).trim();
  if (!url || /^(?:data|javascript):/i.test(url)) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return BASE + url;
  return BASE + "/" + url;
}

function slugFromUrl(value) {
  const url = abs(value);
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== new URL(BASE).hostname) return null;
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts[0] !== "manga" || !parts[1]) return null;
    return decodeURIComponent(parts[1]);
  } catch (_) {
    return null;
  }
}

async function request(path, options) {
  const url = /^https?:\/\//i.test(path) ? path : BASE + path;
  const response = await harbor.http(url, {
    method: options?.method || "GET",
    responseType: options?.responseType || "text",
    timeoutMs: 30000,
    headers: {
      "Accept": options?.accept || "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
      "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
      ...(options?.headers || {})
    },
    body: options?.body
  });
  if (!response || response.ok === false) {
    const status = response?.status ?? "network error";
    throw new Error("StellarSaber request failed (" + status + "): " + url);
  }
  return response;
}

async function getDoc(path) {
  const response = await request(path);
  const html = response.body || "";
  if (/cf-chl-|challenge-platform|Just a moment\.\.\.|Enable JavaScript and cookies to continue/i.test(html)) {
    throw new Error("StellarSaber returned a Cloudflare challenge. Harbor's isolated source cannot solve an interactive browser challenge.");
  }
  return harbor.parseHtml(html);
}

function imageFrom(img) {
  if (!img) return undefined;
  for (const key of ["data-cdn-url", "data-src", "data-lazy-src", "data-original", "data-cfsrc", "src"]) {
    const value = img.attr(key);
    if (value && !/^data:/i.test(value)) return abs(value);
  }
  for (const key of ["data-srcset", "srcset"]) {
    const value = img.attr(key);
    if (value) {
      const candidate = value.split(",")[0].trim().split(/\s+/)[0];
      if (candidate && !/^data:/i.test(candidate)) return abs(candidate);
    }
  }
  return undefined;
}

function cardSummary(link) {
  const href = link.attr("href");
  const id = slugFromUrl(href);
  if (!id) return null;

  const title = clean(
    link.querySelector(".card__title, .detail-info__title, .post-title, .manga-title, h2, h3")?.text() ||
    link.attr("title") ||
    link.querySelector("img")?.attr("alt") ||
    link.text()
  );
  if (!title) return null;

  let cover = imageFrom(link.querySelector("img"));
  return { id, title, cover };
}

function listFromDoc(doc) {
  const result = [];
  const seen = new Set();

  // The current StellarSaber theme does not use the old Madara card-grid
  // structure consistently. Collect manga permalinks directly instead.
  for (const link of doc.querySelectorAll("a[href*='/manga/']")) {
    const item = cardSummary(link);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }

  return result;
}

function extractNonce(html) {
  const patterns = [
    /nonce\s*["']?\s*:\s*["']([^"']+)["']/i,
    /nonce\\["']?\s*:\s*\\["']([^"']+)\\["']/i,
    /["']nonce["']\s*,\s*["']([^"']+)["']/i
  ];
  for (const pattern of patterns) {
    const match = String(html || "").match(pattern);
    if (match?.[1]) return match[1];
  }
  throw new Error("StellarSaber search nonce was not found in the page HTML.");
}

async function getNonce() {
  const response = await request("/manga/");
  const html = response.body || "";
  if (/cf-chl-|challenge-platform|Just a moment\.\.\./i.test(html)) {
    throw new Error("StellarSaber returned a Cloudflare challenge while loading its search token.");
  }
  return extractNonce(html);
}

function mapSearchResults(payload) {
  const data = payload?.data ?? payload;
  const results = Array.isArray(data?.results) ? data.results :
    Array.isArray(data?.data?.results) ? data.data.results : [];
  const items = [];
  const seen = new Set();
  for (const result of results) {
    if (!result || /^(novel|anime)$/i.test(String(result.type || ""))) continue;
    const id = slugFromUrl(result.url || result.permalink || "");
    const title = clean(result.title || result.name);
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    items.push({ id, title, cover: abs(result.cover || result.image || result.thumbnail) });
  }
  return items;
}

function chapterNumber(value) {
  const text = clean(value);
  const match =
    text.match(/(?:الفصل|chapter|ch\.?)\s*#?\s*([0-9]+(?:\.[0-9]+)?)/i) ||
    text.match(/(?:^|[\s_-])([0-9]+(?:\.[0-9]+)?)(?:$|[\s_-])/);
  return match ? match[1] : null;
}

function chapterEntry(id, title, team) {
  const url = abs(id);
  if (!url) return null;
  const label = clean(title);
  const number = chapterNumber(label);
  return {
    id: url,
    chapter: number || label || null,
    title: label || undefined,
    pages: 0,
    language: "ar",
    group: clean(team) || undefined
  };
}

function chaptersFromDoc(doc) {
  const output = [];
  const seen = new Set();

  function add(href, label, team) {
    const url = abs(href);
    if (!url || seen.has(url)) return;
    let parsed;
    try {
      parsed = new URL(url);
    } catch (_) {
      return;
    }
    if (parsed.hostname !== new URL(BASE).hostname) return;
    if (!/\/chapter\//i.test(parsed.pathname)) return;

    const title = clean(label);
    const number = chapterNumber(title);
    // A chapter link on this site is identified by its /chapter/ route;
    // retain the full chapter title even when its number is written in Arabic.
    output.push({
      id: url,
      chapter: number || title || null,
      title: title || undefined,
      pages: 0,
      language: "ar",
      group: clean(team) || undefined
    });
    seen.add(url);
  }

  for (const link of doc.querySelectorAll("a[href*='/chapter/']")) {
    const title = clean(
      link.querySelector(".chapter-item__title, .chapter-title, .chapter-name")?.text() ||
      link.attr("title") ||
      link.text()
    );
    const team = clean(link.querySelector(".chapter-item__team, .chapter-team")?.text());
    add(link.attr("href"), title, team);
  }

  // Reader pages also expose the chapter list as a select element.
  for (const option of doc.querySelectorAll("#reader-chapter-select option, select[name*='chapter'] option")) {
    add(option.attr("value"), option.text());
  }

  return output;
}

function readerImageUrls(doc) {
  const images = [];
  const seen = new Set();
  for (const img of doc.querySelectorAll("img[data-cdn-url], .reader__images img[data-cdn-url], img.reader__page[data-cdn-url]")) {
    const url = abs(img.attr("data-cdn-url"));
    if (url && !seen.has(url)) {
      seen.add(url);
      images.push(url);
    }
  }
  return images;
}

function textFrom(root, selectors) {
  for (const selector of selectors) {
    const value = clean(root.querySelector(selector)?.text());
    if (value) return value;
  }
  return undefined;
}

const plugin = {
  id: "stellarsaber-legacy",
  name: "StellarSaber (Legacy)",

  async popular(offset) {
    const page = Math.floor(Math.max(0, Number(offset) || 0) / PAGE_SIZE) + 1;
    const path = page === 1
      ? "/manga/?sort=rating"
      : "/manga/page/" + page + "/?sort=rating";
    return listFromDoc(await getDoc(path));
  },

  async search(query, offset) {
    const term = clean(query);
    if (!term) return [];
    const page = Math.floor(Math.max(0, Number(offset) || 0) / PAGE_SIZE) + 1;
    const nonce = await getNonce();
    const body = new URLSearchParams({
      action: "flavor_ajax_filter_content",
      nonce,
      page: String(page),
      keyword: term
    }).toString();

    const response = await request("/wp-admin/admin-ajax.php", {
      method: "POST",
      responseType: "text",
      accept: "application/json, text/javascript, */*;q=0.01",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest"
      },
      body
    });

    let payload = null;
    if (typeof response.body === "string") {
      try { payload = JSON.parse(response.body); } catch (_) {}
    } else {
      payload = response.body;
    }
    const items = mapSearchResults(payload);
    if (items.length) return items;

    // Some WordPress configurations return HTML instead of JSON.
    if (typeof response.body === "string" && response.body.trim().startsWith("<")) {
      return listFromDoc(await harbor.parseHtml(response.body));
    }
    return [];
  },

  async detail(id) {
    const slug = String(id || "").replace(/^\/+|\/+$/g, "");
    const doc = await getDoc("/manga/" + encodeURIComponent(slug) + "/");
    const root = doc.querySelector(".detail-content") || doc;
    const cover = imageFrom(root.querySelector(".detail-poster img")) ||
      imageFrom(root.querySelector(".summary_image img")) ||
      imageFrom(root.querySelector("img"));
    const chapters = chaptersFromDoc(doc);

    return {
      id: slug,
      title: textFrom(root, [".detail-info__title", ".post-title h1", "h1.entry-title", "h1"]) || slug,
      altTitle: textFrom(root, [".detail-info__alt-title", ".alt-title"]) || undefined,
      cover,
      description: textFrom(root, ["#detail-desc", ".summary__content", ".description-summary", ".summary_content"]) || undefined,
      author: textFrom(root, [".detail-meta__value", ".author-content", ".author"]) || undefined,
      status: textFrom(root, [".detail-status", ".status"]) || undefined,
      lastChapter: chapters.length ? chapters[0].title : undefined
    };
  },

  async chapters(id) {
    const slug = String(id || "").replace(/^\/+|\/+$/g, "");
    const doc = await getDoc("/manga/" + encodeURIComponent(slug) + "/");
    return chaptersFromDoc(doc);
  },

  async pageUrls(chapterId) {
    const doc = await getDoc(chapterId);
    const urls = readerImageUrls(doc);
    if (!urls.length) {
      throw new Error("No reader images found. StellarSaber may have changed its reader markup or blocked the request.");
    }
    // StellarSaber encrypts CDN image bytes with AES-GCM and supplies the key
    // through flavor_cdn_get_key. Harbor's pageUrls contract currently accepts
    // URLs only, so it cannot perform the site's required binary image decryption.
    return urls;
  }
};

harbor.register(plugin);
