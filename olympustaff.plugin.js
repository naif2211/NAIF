// Harbor source plugin for OlympusStaff / Team-X
// Site: https://olympustaff.com

const BASE = "https://olympustaff.com";

function abs(url) {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return new URL(url, BASE).toString();
}

function text(el) {
  return el?.textContent?.replace(/\s+/g, " ").trim() || "";
}

function numberFrom(value) {
  const m = String(value || "").match(/(?:chapter|chap|الفصل|فصل)\s*[-_.:#]*\s*(\d+(?:\.\d+)?)/i);
  if (m) return Number(m[1]);
  const nums = String(value || "").match(/\d+(?:\.\d+)?/g);
  return nums?.length ? Number(nums[nums.length - 1]) : 0;
}

return {
  id: "olympustaff",
  name: "OlympusStaff",
  lang: "ar",
  baseUrl: BASE,

  async search(query, page = 1) {
    const url = `${BASE}/series?search=${encodeURIComponent(query)}&page=${page}`;
    const html = await harbor.http.get(url);
    const doc = harbor.parseHtml(html);
    const out = [];

    for (const a of doc.querySelectorAll('a[href*="/series/"]')) {
      const href = a.getAttribute("href");
      const title = text(a);
      if (!href || !title || title.length < 2 || title.includes("قائمة المانجا")) continue;
      const link = abs(href);
      if (!out.some(x => x.url === link)) {
        out.push({ title, url: link, thumbnail: "" });
      }
    }
    return out;
  },

  async popular(page = 1) {
    const html = await harbor.http.get(`${BASE}/series?page=${page}`);
    const doc = harbor.parseHtml(html);
    const out = [];
    for (const a of doc.querySelectorAll('a[href*="/series/"]')) {
      const href = a.getAttribute("href");
      const title = text(a);
      if (!href || !title || title.length < 2) continue;
      const link = abs(href);
      if (!out.some(x => x.url === link)) out.push({ title, url: link, thumbnail: "" });
    }
    return out;
  },

  async details(url) {
    const html = await harbor.http.get(abs(url));
    const doc = harbor.parseHtml(html);
    const title = text(doc.querySelector('h1')) || text(doc.querySelector('h2'));
    const image = doc.querySelector('img[src]')?.getAttribute('src') || "";
    const description = text(doc.querySelector('.description, .summary, .manga-excerpt, .entry-content'));
    const tags = [...doc.querySelectorAll('a[href*="genre"], .genres a, .tags a')].map(text).filter(Boolean);
    return { title, url: abs(url), thumbnail: abs(image), description, tags };
  },

  async chapters(url) {
    const first = abs(url);
    const found = new Map();
    const maxPages = 50;

    for (let page = 1; page <= maxPages; page++) {
      const pageUrl = page === 1 ? first : `${first}${first.includes('?') ? '&' : '?'}page=${page}`;
      const html = await harbor.http.get(pageUrl);
      const doc = harbor.parseHtml(html);
      const links = [...doc.querySelectorAll('a[href]')];
      let added = 0;

      for (const a of links) {
        const href = a.getAttribute('href');
        const label = text(a);
        if (!href || !label) continue;
        const combined = `${label} ${href}`;
        if (!/(الفصل|فصل|chapter|chap)/i.test(combined)) continue;
        const chapterNumber = numberFrom(combined);
        if (!chapterNumber) continue;
        const chapterUrl = abs(href);
        if (!found.has(chapterUrl)) {
          found.set(chapterUrl, {
            name: label,
            number: chapterNumber,
            url: chapterUrl,
            language: "ar"
          });
          added++;
        }
      }

      const next = [...doc.querySelectorAll('a[href]')].find(a => {
        const t = text(a).toLowerCase();
        return t === '›' || t === 'next' || t.includes('التالي');
      });
      if (!next || !added) break;
    }

    return [...found.values()].sort((a, b) => b.number - a.number);
  },

  async pages(chapterUrl) {
    const html = await harbor.http.get(abs(chapterUrl));
    const doc = harbor.parseHtml(html);
    const urls = [];
    const seen = new Set();

    for (const img of doc.querySelectorAll('img[src], img[data-src], img[data-lazy-src]')) {
      const src = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('src');
      if (!src) continue;
      const u = abs(src);
      if (seen.has(u)) continue;
      if (/logo|avatar|favicon|icon|banner|ads?/i.test(u)) continue;
      seen.add(u);
      urls.push(u);
    }
    return urls;
  }
};
