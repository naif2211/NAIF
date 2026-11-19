// Harbor manga source for MangaTime (Arabic).
// Uses the site's public tRPC endpoints, matching the current MangaTime source API.

const BASE = "https://mangatime.org";
const PAGE_SIZE = 48;
const API_LIMIT = 48;

function clean(value) {
  return value == null ? "" : String(value).replace(/\\s+/g, " ").trim();
}

function abs(url) {
  if (!url) return undefined;
  const value = String(url).trim();
  if (!value || value.startsWith("data:")) return undefined;
  if (/^https?:\\/\\//i.test(value)) return value;
  if (value.startsWith("//")) return "https:" + value;
  if (value.startsWith("/")) return BASE + value;
  return BASE + "/" + value;
}

function sourceId(type, slug, seriesId) {
  return String(type || "manga") + "/" + String(slug || "") + "#" + String(seriesId || "");
}

function parseSourceId(id) {
  const value = String(id || "");
  const hash = value.lastIndexOf("#");
  if (hash < 0) throw new Error("Invalid MangaTime manga ID");
  const route = value.slice(0, hash).replace(/^\\/+|\\/+$/g, "");
  const parts = route.split("/");
  if (parts.length < 2 || !parts[1]) throw new Error("Invalid MangaTime manga route");
  return { type: parts[0], slug: parts.slice(1).join("/"), seriesId: value.slice(hash + 1) };
}

async function trpc(endpoint, input) {
  const url = new URL(BASE + "/api/trpc/" + endpoint);
  url.searchParams.set("batch", "1");
  url.searchParams.set("input", JSON.stringify({ "0": { json: input } }));

  const response = await harbor.http(url.toString(), {
    responseType: "json",
    timeoutMs: 30000,
    headers: { "accept": "application/json" }
  });

  if (response == null) throw new Error("MangaTime returned an invalid response for " + endpoint);
  const item = Array.isArray(response) ? response[0] : response;
  const data = item && item.result && item.result.data;
  if (item && item.error) throw new Error("MangaTime API error: " + JSON.stringify(item.error));
  if (!data) throw new Error("MangaTime response is missing data for " + endpoint);
  return Object.prototype.hasOwnProperty.call(data, "json") ? data.json : data;
}

function toSummary(item) {
  if (!item) return null;
  const slug = clean(item.slug);
  const title = clean(item.title);
  const type = clean(item.type) || "manga";
  const id = clean(item.id);
  if (!slug || !title || !id) return null;
  return {
    id: sourceId(type, slug, id),
    title,
    cover: abs(item.coverUrl)
  };
}

async function searchSeries(offset, sortBy, query) {
  const page = Math.floor(Math.max(0, Number(offset) || 0) / PAGE_SIZE) + 1;
  const result = await trpc("search.searchSeries", {
    page,
    limit: API_LIMIT,
    sortBy,
    sortOrder: "desc",
    ...(query ? { query: String(query) } : {})
  });
  const items = Array.isArray(result && result.results) ? result.results : [];
  return items.map(toSummary).filter(Boolean);
}

const plugin = {
  id: "mangatime",
  name: "MangaTime",

  async popular(offset) {
    return searchSeries(offset, "popularity");
  },

  async search(query, offset) {
    if (!clean(query)) return this.popular(offset);
    return searchSeries(offset, "popularity", clean(query));
  },

  async detail(id) {
    const parsed = parseSourceId(id);
    const result = await trpc("content.getSeriesBySlug", { slug: parsed.slug });
    if (!result) return null;
    return {
      id,
      title: clean(result.title) || parsed.slug,
      cover: abs(result.coverUrl),
      description: clean(result.description) || undefined,
      status: clean(result.status).toLowerCase() || undefined,
      author: clean(result.author) || undefined,
      altTitle: clean(result.altTitle) || undefined,
      lastChapter: undefined
    };
  },

  async chapters(id) {
    const parsed = parseSourceId(id);
    const result = await trpc("content.getChapters", {
      seriesId: parsed.seriesId,
      limit: -1
    });
    const items = Array.isArray(result && result.chapters) ? result.chapters : [];
    return items.map((item) => {
      const number = item && item.number != null ? String(item.number) : "";
      if (!number) return null;
      const title = clean(item.title);
      return {
        id: parsed.type + "/" + parsed.slug + "/chapter/" + number,
        chapter: number,
        title: title && !title.includes(number) ? "Chapter " + number + " - " + title : (title || "Chapter " + number),
        volume: null,
        pages: 0,
        language: "ar",
        publishAt: item.publishedAt || undefined
      };
    }).filter(Boolean);
  },

  async pageUrls(chapterId) {
    const url = new URL(String(chapterId).replace(/^\\/+/, ""), BASE + "/");
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 4 || parts[2] !== "chapter") {
      throw new Error("Invalid MangaTime chapter ID");
    }
    const slug = parts[1];
    const chapterNumber = Number(parts[3]);
    if (!Number.isFinite(chapterNumber)) throw new Error("Invalid MangaTime chapter number");

    const result = await trpc("content.getChapterPages", {
      seriesSlug: slug,
      chapterNumber
    });
    if (result && result.isUnlocked === false) throw new Error("Chapter is locked");
    const pages = Array.isArray(result && result.pages) ? result.pages : [];
    return pages.map(abs).filter(Boolean);
  }
};
