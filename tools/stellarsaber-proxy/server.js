"use strict";

const http = require("node:http");
const crypto = require("node:crypto");

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 8787);
const SITE = "https://stellarsaber.pro";
const CDN_HOST = "cdn-stellarsaber.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const keyCache = new Map();
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(body);
}

function allowedChapterUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== new URL(SITE).hostname) {
    throw new Error("Invalid chapter URL: only stellarsaber.pro is allowed");
  }
  return url.href;
}

function allowedImageUrl(value) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" ||
      !(host === CDN_HOST || host.endsWith("." + CDN_HOST))) {
    throw new Error("Invalid image URL: only cdn-stellarsaber.com is allowed");
  }
  return url.href;
}

async function fetchText(url, headers = {}) {
  const response = await fetch(url, {
    headers: { "User-Agent": UA, "Accept": "*/*", ...headers },
    redirect: "follow",
    signal: AbortSignal.timeout(25000)
  });
  if (!response.ok) throw new Error("HTTP " + response.status + " while requesting " + url);
  return response.text();
}

function extractNonce(html) {
  const patterns = [
    /nonce\s*["']?\s*:\s*["']([^"']+)["']/i,
    /["']nonce["']\s*,\s*["']([^"']+)["']/i,
    /(?:flavor|ajax)[_-]nonce["']?\s*[:=]\s*["']([^"']+)["']/i,
    /name=["']_wpnonce["'][^>]*value=["']([^"']+)["']/i,
    /value=["']([^"']+)["'][^>]*name=["']_wpnonce["']/i
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1]) return match[1];
  }
  throw new Error("Could not find the WordPress AJAX nonce in the chapter HTML");
}

function extractChapterId(html, chapterUrl) {
  const patterns = [
    /data-chapter-id=["'](\d+)["']/i,
    /data-post-id=["'](\d+)["']/i,
    /["'](?:chapter_id|post_id)["']\s*:\s*["']?(\d+)/i,
    /(?:post|chapter)[_-]?id["']?\s*[:=]\s*["']?(\d+)/i
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1]) return match[1];
  }
  const slugMatch = new URL(chapterUrl).pathname.match(/\/(\d+)(?:\/|$)/);
  return slugMatch ? slugMatch[1] : "";
}

async function getDecryptionKey(chapterUrl) {
  if (keyCache.has(chapterUrl)) return keyCache.get(chapterUrl);

  const pending = (async () => {
    const html = await fetchText(chapterUrl, { "Referer": SITE + "/" });
    const nonce = extractNonce(html);
    const chapterId = extractChapterId(html, chapterUrl);

    const params = new URLSearchParams({
      action: "flavor_cdn_get_key",
      nonce
    });
    if (chapterId) {
      params.set("chapter_id", chapterId);
      params.set("post_id", chapterId);
    }

    const response = await fetch(SITE + "/wp-admin/admin-ajax.php", {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Accept": "application/json, text/javascript, */*;q=0.01",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        "Origin": SITE,
        "Referer": chapterUrl
      },
      body: params.toString(),
      redirect: "follow",
      signal: AbortSignal.timeout(25000)
    });

    const rawText = await response.text();
    if (!response.ok) throw new Error("Key endpoint returned HTTP " + response.status);

    let payload;
    try {
      payload = JSON.parse(rawText);
    } catch {
      throw new Error("Key endpoint did not return JSON: " + rawText.slice(0, 250));
    }

    const encoded = payload?.data?.key || payload?.key || payload?.data?.decryption_key;
    if (!encoded || typeof encoded !== "string") {
      throw new Error("Decryption key missing: " + JSON.stringify(payload).slice(0, 500));
    }

    const key = Buffer.from(encoded, "base64");
    if (key.length !== 16 && key.length !== 32) {
      throw new Error("Unexpected AES key length: " + key.length + " bytes");
    }
    return key;
  })();

  keyCache.set(chapterUrl, pending);
  try {
    const key = await pending;
    keyCache.set(chapterUrl, key);
    return key;
  } catch (error) {
    keyCache.delete(chapterUrl);
    throw error;
  }
}

function detectImageType(buffer) {
  if (buffer.length >= 3 &&
      buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.length >= 8 &&
      buffer.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") {
    return "image/png";
  }
  if (buffer.length >= 12 &&
      buffer.subarray(0, 4).toString() === "RIFF" &&
      buffer.subarray(8, 12).toString() === "WEBP") {
    return "image/webp";
  }
  if (buffer.length >= 6 &&
      (buffer.subarray(0, 6).toString() === "GIF87a" ||
       buffer.subarray(0, 6).toString() === "GIF89a")) {
    return "image/gif";
  }
  return null;
}

function decryptAesGcm(raw, key) {
  // Expected binary layout: 12-byte IV | ciphertext | 16-byte GCM auth tag.
  if (raw.length < 29) throw new Error("Encrypted image is too short");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(raw.length - 16);
  const ciphertext = raw.subarray(12, raw.length - 16);
  const algorithm = key.length === 16 ? "aes-128-gcm" : "aes-256-gcm";
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

async function handleImage(req, res, requestUrl) {
  const img = requestUrl.searchParams.get("img");
  const chapter = requestUrl.searchParams.get("ch");
  if (!img || !chapter) {
    return send(res, 400, "Required query parameters: img and ch");
  }

  const imageUrl = allowedImageUrl(img);
  const chapterUrl = allowedChapterUrl(chapter);
  const imageResponse = await fetch(imageUrl, {
    headers: { "User-Agent": UA, "Referer": chapterUrl },
    redirect: "follow",
    signal: AbortSignal.timeout(30000)
  });

  if (!imageResponse.ok) {
    throw new Error("Image CDN returned HTTP " + imageResponse.status);
  }
  const finalHost = new URL(imageResponse.url || imageUrl).hostname.toLowerCase();
  if (!(finalHost === CDN_HOST || finalHost.endsWith("." + CDN_HOST))) {
    throw new Error("Image CDN redirected to an untrusted host");
  }

  const declaredLength = Number(imageResponse.headers.get("content-length") || 0);
  if (declaredLength > MAX_IMAGE_BYTES) throw new Error("Image exceeds 25 MB limit");

  const raw = Buffer.from(await imageResponse.arrayBuffer());
  if (!raw.length || raw.length > MAX_IMAGE_BYTES) {
    throw new Error("Image response is empty or exceeds 25 MB");
  }

  const originalType = detectImageType(raw);
  if (originalType) {
    return send(res, 200, raw, originalType);
  }

  const key = await getDecryptionKey(chapterUrl);
  const decrypted = decryptAesGcm(raw, key);
  const decryptedType = detectImageType(decrypted);
  if (!decryptedType) {
    throw new Error("AES-GCM succeeded, but decrypted data is not a recognized image");
  }
  return send(res, 200, decrypted, decryptedType);
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, "");
  if (req.method !== "GET") return send(res, 405, "Method not allowed");

  let url;
  try {
    url = new URL(req.url, "http://" + HOST + ":" + PORT);
  } catch {
    return send(res, 400, "Invalid request URL");
  }

  if (url.pathname === "/health") {
    return send(res, 200, JSON.stringify({
      ok: true,
      service: "StellarSaber AES-GCM image proxy",
      host: HOST,
      port: PORT
    }), "application/json; charset=utf-8");
  }

  if (url.pathname !== "/" && url.pathname !== "/image") {
    return send(res, 404, "Not found");
  }

  try {
    await handleImage(req, res, url);
  } catch (error) {
    console.error("[StellarSaber Proxy]", error.stack || error.message);
    if (!res.headersSent) send(res, 502, "Proxy error: " + error.message);
    else res.destroy(error);
  }
});

server.listen(PORT, HOST, () => {
  console.log("StellarSaber Proxy listening at http://" + HOST + ":" + PORT);
  console.log("Health check: http://" + HOST + ":" + PORT + "/health");
});
