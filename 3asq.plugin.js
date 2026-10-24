const BASE = "https://3asq.online";

function abs(url) {
  if (!url) return undefined;

  try {
    const u = new URL(String(url).trim(), BASE);

    if (!/^https?:$/i.test(u.protocol)) return undefined;

    return u.href;
  } catch {
    return undefined;
  }
}

function pathFromUrl(url) {
  if (!url) return "";

  try {
    const u = new URL(String(url).trim(), BASE);

    if (!/^https?:$/i.test(u.protocol)) return "";

    return (
      u.pathname
        .replace(/^\/+/, "")
        .replace(/\/+$/, "") +
      (u.search || "")
    );
  } catch {
    return "";
  }
}

async function getDoc(path) {
  const res = await harbor.http(BASE + path, {
    responseType: "text",
  });

  if (!res.ok) return null;

  return harbor.parseHtml(res.body);
}

async function getRaw(path) {
  const res = await harbor.http(BASE + path, {
    responseType: "text",
  });

  if (!res.ok) return "";

  return res.body || "";
}

function firstText(root, selectors) {
  for (const selector of selectors) {
    const el = root.querySelector(selector);

    if (!el) continue;

    const text = (el.text() || "").trim();

    if (text) return text;
  }

  return "";
}

function firstAttr(root, selectors, attributes) {
  for (const selector of selectors) {
    const el = root.querySelector(selector);

    if (!el) continue;

    for (const attr of attributes) {
      const value = el.attr(attr);

      if (value && String(value).trim()) {
        return String(value).trim();
      }
    }
  }

  return "";
}

function metaValue(doc, names) {
  const wanted = names.map((name) => name.toLowerCase());

  for (const meta of doc.querySelectorAll("meta")) {
    const key = (
      (meta.attr("property") ||
        meta.attr("name") ||
        "") +
      ""
    ).toLowerCase();

    if (wanted.includes(key)) {
      return (meta.attr("content") || "").trim();
    }
  }

  return "";
}

function imageUrl(img) {
  if (!img) return undefined;

  return abs(
    img.attr("data-src") ||
      img.attr("data-lazy-src") ||
      img.attr("data-original") ||
      img.attr("data-lazy") ||
      img.attr("data-url") ||
      img.attr("src")
  );
}

function getCover(doc) {
  const metaCover =
    metaValue(doc, [
      "og:image",
      "twitter:image",
      "twitter:image:src",
    ]) || "";

  if (metaCover) {
    return abs(metaCover);
  }

  const selectors = [
    ".summary_image img",
    ".summary-image img",
    ".summary_image a img",
    ".post-thumbnail img",
    ".tab-summary .summary_image img",
    ".c-tabs-item__content .summary_image img",
  ];

  for (const selector of selectors) {
    const img = doc.querySelector(selector);

    const url = imageUrl(img);

    if (url) return url;
  }

  return undefined;
}

function isMangaUrl(href) {
  if (!href) return false;

  if (!/\/manga\//i.test(href)) return false;

  if (/\/chapter/i.test(href)) return false;

  return true;
}

function cardToSummary(card) {
  const links = card.querySelectorAll("a");

  let link = null;

  for (const a of links) {
    const href = a.attr("href") || "";

    if (isMangaUrl(href)) {
      link = a;
      break;
    }
  }

  if (!link) return null;

  const href = link.attr("href") || "";

  const id = pathFromUrl(href);

  if (!id) return null;

  let title =
    (link.attr("title") ||
      link.text() ||
      "").trim();

  if (!title) {
    title = firstText(card, [
      "h1",
      "h2",
      "h3",
      "h4",
      ".title",
      ".post-title",
      ".entry-title",
      ".post-title a",
      ".series-title",
    ]);
  }

  const img =
    card.querySelector("img") ||
    link.querySelector("img");

  const cover = imageUrl(img);

  if (!title) return null;

  return {
    id,
    title,
    cover,
  };
}

function extractSummaries(doc) {
  const result = [];
  const seen = new Set();

  const selectors = [
    ".page-item-detail",
    ".c-tabs-item__content .page-item-detail",
    ".bsx",
    ".manga-item",
    ".item-summary",
    "article",
  ];

  for (const selector of selectors) {
    for (const card of doc.querySelectorAll(selector)) {
      const item = cardToSummary(card);

      if (!item) continue;

      if (seen.has(item.id)) continue;

      seen.add(item.id);

      result.push(item);

      if (result.length >= 500) {
        return result;
      }
    }
  }

  // Fallback: only use actual manga links.
  if (result.length === 0) {
    for (const a of doc.querySelectorAll('a[href*="/manga/"]')) {
      const href = a.attr("href") || "";

      if (!isMangaUrl(href)) continue;

      const id = pathFromUrl(href);

      if (!id || seen.has(id)) continue;

      let title =
        (a.attr("title") ||
          a.text() ||
          "").trim();

      const img = a.querySelector("img");

      const cover = imageUrl(img);

      if (!title) continue;

      seen.add(id);

      result.push({
        id,
        title,
        cover,
      });

      if (result.length >= 500) {
        return result;
      }
    }
  }

  return result;
}

async function fetchListing(paths) {
  for (const path of paths) {
    const doc = await getDoc(path);

    if (!doc) continue;

    const items = extractSummaries(doc);

    if (items.length > 0) {
      return items;
    }
  }

  return [];
}

function listingPaths(kind, page, query, tagId) {
  const q = encodeURIComponent(query || "");
  const t = tagId
    ? encodeURIComponent(tagId)
    : "";

  const paths = [];

  if (kind === "popular") {
    if (tagId) {
      paths.push(
        `/manga-genre/${t}/?m_orderby=views&page=${page}`,
        `/genre/${t}/?m_orderby=views&page=${page}`,
        `/manga/?m_orderby=views&genre=${t}&page=${page}`
      );
    } else {
      paths.push(
        `/manga/?m_orderby=views&page=${page}`,
        `/manga/page/${page}/?m_orderby=views`,
        `/?m_orderby=views&page=${page}`
      );
    }
  } else {
    if (tagId) {
      paths.push(
        `/manga-genre/${t}/?s=${q}&post_type=wp-manga&page=${page}`,
        `/genre/${t}/?s=${q}&post_type=wp-manga&page=${page}`,
        `/manga/?s=${q}&post_type=wp-manga&genre=${t}&page=${page}`,
        `/?s=${q}&post_type=wp-manga&page=${page}`
      );
    } else {
      paths.push(
        `/manga/?s=${q}&post_type=wp-manga&page=${page}`,
        `/?s=${q}&post_type=wp-manga&page=${page}`
      );
    }
  }

  return paths;
}

function parseChapterNumber(text, href) {
  const source =
    `${text || ""} ${href || ""}`;

  const patterns = [
    /chapter[\s._-]*(\d+(?:\.\d+)?)/i,
    /\bch[\s._-]*(\d+(?:\.\d+)?)/i,
    /(?:^|\s)(\d+(?:\.\d+)?)(?:\s*$)/,
  ];

  for (const regex of patterns) {
    const match = source.match(regex);

    if (match) {
      return match[1];
    }
  }

  return null;
}

function parseChapters(doc) {
  const chapters = [];
  const seen = new Set();

  const selectors = [
    ".wp-manga-chapter a",
    ".wp-manga-chapters a",
    ".chapter-list a",
    ".version-chap a",
    ".listing-chapters_wrap a",
    ".chapter-item a",
    'a[href*="/chapter-"]',
    'a[href*="/chapter/"]',
  ];

  for (const selector of selectors) {
    for (const a of doc.querySelectorAll(selector)) {
      const href = a.attr("href") || "";

      if (!href) continue;

      if (!/chapter/i.test(href)) continue;

      const id = pathFromUrl(href);

      if (!id || seen.has(id)) continue;

      const text =
        (a.text() ||
          a.attr("title") ||
          "").trim();

      const chapter = parseChapterNumber(
        text,
        href
      );

      const time = a.querySelector("time");

      const publishAt = time
        ? (
            time.attr("datetime") ||
            time.text() ||
            ""
          ).trim() || undefined
        : undefined;

      chapters.push({
        id,
        chapter,
        title: text || undefined,
        volume:
          a.attr("data-volume") ||
          a.attr("data-vol") ||
          null,
        pages: 0,
        language: "ar",
        publishAt,
      });

      seen.add(id);

      if (chapters.length >= 5000) {
        break;
      }
    }

    if (chapters.length >= 5000) {
      break;
    }
  }

  // Newest chapter first.
  chapters.sort((a, b) => {
    const na = parseFloat(a.chapter);
    const nb = parseFloat(b.chapter);

    if (!Number.isNaN(na) && !Number.isNaN(nb)) {
      return nb - na;
    }

    return 0;
  });

  return chapters;
}

function isReaderImage(url) {
  if (!url) return false;

  try {
    const u = new URL(url);

    const pathname = u.pathname.toLowerCase();

    if (
      !/\.(jpe?g|png|webp|gif)$/i.test(pathname)
    ) {
      return false;
    }

    // Avoid common site UI images.
    if (
      /favicon|logo|avatar|icon|sprite|banner/i.test(
        pathname
      )
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

async function pageUrlsFromRaw(chapterPath) {
  const raw = await getRaw(
    "/" + chapterPath
  );

  if (!raw) return [];

  const urls = [];
  const seen = new Set();

  const regexes = [
    /(?:https?:)?\/\/[^"'<> \t\r\n]+?\.(?:jpe?g|png|webp|gif)(?:\?[^"'<> \t\r\n]*)?/gi,
  ];

  for (const regex of regexes) {
    let match;

    while ((match = regex.exec(raw))) {
      const url = abs(match[0]);

      if (!url) continue;

      if (!isReaderImage(url)) continue;

      if (seen.has(url)) continue;

      seen.add(url);

      urls.push(url);

      if (urls.length >= 2000) {
        return urls;
      }
    }
  }

  return urls;
}

async function extractPageImages(doc) {
  const urls = [];
  const seen = new Set();

  const selectors = [
    ".reading-content img",
    "#readerarea img",
    ".page-break img",
    ".entry-content .page-break img",
    ".wp-manga-chapter-img img",
    ".manga-chapter img",
    ".reading-content .page-break img",
  ];

  for (const selector of selectors) {
    for (const img of doc.querySelectorAll(selector)) {
      const url = imageUrl(img);

      if (!url) continue;

      if (!isReaderImage(url)) continue;

      if (seen.has(url)) continue;

      seen.add(url);

      urls.push(url);

      if (urls.length >= 2000) {
        return urls;
      }
    }
  }

  return urls;
}

const plugin = {
  id: "3asq-online",

  name: "3asq.online",

  async popular(offset, tagId) {
    const page =
      Math.floor(offset / 48) + 1;

    return await fetchListing(
      listingPaths(
        "popular",
        page,
        "",
        tagId
      )
    );
  },

  async search(query, offset, tagId) {
    const page =
      Math.floor(offset / 48) + 1;

    return await fetchListing(
      listingPaths(
        "search",
        page,
        query,
        tagId
      )
    );
  },

  async detail(id) {
    const doc = await getDoc(
      "/" + String(id).replace(/^\/+/, "")
    );

    if (!doc) return null;

    const title =
      firstText(doc, [
        ".post-title h1",
        ".summary-title h1",
        "h1.entry-title",
        "h1",
      ]) ||
      metaValue(doc, [
        "og:title",
        "twitter:title",
      ]) ||
      id;

    const cover = getCover(doc);

    const description =
      metaValue(doc, [
        "og:description",
        "twitter:description",
        "description",
      ]) ||
      firstText(doc, [
        ".summary__content",
        ".summary_content",
        ".summary-content",
        ".description-summary",
        ".description-summary p",
        ".entry-content",
      ]);

    const status =
      firstText(doc, [
        ".post-status .summary-content",
        ".summary-content.status",
        ".summary-content .status",
        ".post-content_item.manga-status .summary-content",
      ]) || undefined;

    const author =
      firstText(doc, [
        ".author-content",
        ".summary-content.author",
        ".summary-content .author",
        ".post-content_item.manga-authors .summary-content",
      ]) || undefined;

    const altTitle =
      firstText(doc, [
        ".alternative",
        ".alt-title",
        ".summary-content.alt",
        ".post-content_item.manga-alternative .summary-content",
      ]) || undefined;

    const yearText =
      firstText(doc, [
        ".year",
        ".release-year",
        ".summary-content.year",
        ".post-content_item.manga-release .summary-content",
      ]) || "";

    const yearMatch =
      yearText.match(
        /\b(19\d{2}|20\d{2})\b/
      );

    const year = yearMatch
      ? Number(yearMatch[1])
      : undefined;

    const lastChapter =
      firstText(doc, [
        ".wp-manga-chapter a",
        ".wp-manga-chapters a",
        ".chapter-list a",
        ".version-chap a",
        'a[href*="/chapter-"]',
        'a[href*="/chapter/"]',
      ]) || undefined;

    return {
      id,
      title,
      altTitle,
      cover,
      year,
      status,
      description,
      lastChapter,
      author,
    };
  },

  async chapters(id) {
    const doc = await getDoc(
      "/" + String(id).replace(/^\/+/, "")
    );

    if (!doc) return [];

    return parseChapters(doc);
  },

  async pageUrls(chapterId) {
    const chapterPath = String(
      chapterId
    ).replace(/^\/+/, "");

    const doc = await getDoc(
      "/" + chapterPath
    );

    let urls = [];

    if (doc) {
      urls = await extractPageImages(doc);
    }

    if (urls.length === 0) {
      urls =
        await pageUrlsFromRaw(
          chapterPath
        );
    }

    return urls;
  },

  async tags() {
    const docs = [];

    const paths = [
      "/manga-genre/",
      "/genre/",
      "/genres/",
      "/",
    ];

    for (const path of paths) {
      const doc = await getDoc(path);

      if (doc) {
        docs.push(doc);
      }
    }

    const result = [];
    const seen = new Set();

    for (const doc of docs) {
      const selectors = [
        'a[href*="/manga-genre/"]',
        'a[href*="/genre/"]',
        'a[href*="/genres/"]',
      ];

      for (const selector of selectors) {
        for (const a of doc.querySelectorAll(
          selector
        )) {
          const href =
            a.attr("href") || "";

          const name =
            (a.text() || "").trim();

          const id = pathFromUrl(href)
            .replace(
              /^(manga-genre|genre|genres)\//i,
              ""
            )
            .replace(/^\/+|\/+$/g, "");

          if (!id || !name) continue;

          if (seen.has(id)) continue;

          seen.add(id);

          result.push({
            id,
            name,
            group: "Genre",
          });

          if (result.length >= 1000) {
            return result;
          }
        }
      }
    }

    return result;
  },
};

harbor.register(plugin);
