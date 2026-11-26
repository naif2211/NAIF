// Harbor manga source for StellarSaber (stellarsaber.pro)
// Cloud-ready version: Full catalog + Cloudflare Worker AES-GCM decryption
const BASE = "https://stellarsaber.pro";
const PROXY = "https://harbor.naif-com070.workers.dev";
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
    throw new Error("StellarSaber returned a Cloudflare challenge.");
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
  if
