#!/usr/bin/env node
"use strict";

/*
 * StellarSaber local image proxy for Harbor
 * Requirements: Node.js 18+ (uses built-in fetch).
 *
 * Run: node tools/stellarsaber-proxy.js
 * Health: http://127.0.0.1:8787/health
 *
 * Harbor requests:
 * http://127.0.0.1:8787/?img=<encoded-cdn-url>&ch=<encoded-chapter-url>
 */

const http = require("node:http");
const crypto = require("node:crypto");

const HOST = "127.0.0.1";
const PORT = Number(process.env.STELLARSABER_PROXY_PORT || 8787);
const BASE = "https://stellarsaber.pro";
const SITE_HOST = new URL(BASE).hostname;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const KEY_CACHE_TTL_MS = 30 * 60 * 1000;
const keyCache = new Map();

function send(res, status, message, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "*",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(message);
}

function validChapterUrl(value) {
  const url = new URL(value);
  return url.protocol === "https:" && url.hostname === SITE_HOST &&
    url.pathname.includes("/chapter/");
}

function validImageUrl(value) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  const allowed =
    host === "cdn-stellarsaber.com" ||
    host.endsWith(".cdn-stellarsaber.com");
  return url.protocol === "https:" && allowed;
}

function extractNonce(html) {
  const patterns = [
    /nonce\s*["']?\s*:\s*["']([^"']+)["']/i,
    /["']nonce["']\s*,\s*["']([^"']+)["']/i,
    /[?&]nonce=([^&"'\s]+)/i
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1]) return match[1];
  }
  throw new Error("لم أجد nonce في صفحة الفصل؛ قد يكون الموقع غيّر طريقة إصدار المفتاح.");
}

function extractChapterId(html) {
  const patterns = [
    /data-chapter-id=["'](\d+)["']/i,
    /["']chapter_id["']\s*:\s*["']?(\d+)/i,
    /["']post_id["']\s*:\s*["']?(\d+)/i
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1]) return match[1];
  }
  return "";
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(20000),
    headers: {
      "User-Agent": UA,
      "Accept": "text/html,application/json,*/*",
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    throw new Error("HTTP " + response.status + " عند طلب " + new URL(url).hostname);
  }
  return response.text();
}

async function getDecryptionKey(chapterUrl) {
  const cached = keyCache.get(chapterUrl);
  if (cached && cached.expires > Date.now()) return cached.key;

  const html = await fetchText(chapterUrl, {
    headers: { "Referer": BASE + "/" }
  });

  const nonce = extractNonce(html);
  const chapterId = extractChapterId(html);
  const params = new URLSearchParams({
    action: "flavor_cdn_get_key",
    nonce
  });

  if (chapterId) {
    params.set("chapter_id", chapterId);
    params.set("post_id", chapterId);
  }

  const response = await fetch(BASE + "/wp-admin/admin-ajax.php", {
    method: "POST",
    signal: AbortSignal.timeout(20000),
    headers: {
      "User-Agent": UA,
      "Accept": "application/json, text/javascript, */*;q=0.01",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      "Origin": BASE,
      "Referer": chapterUrl
    },
    body: params.toString()
  });

  if (!response.ok) {
    throw new Error("طلب مفتاح التشفير فشل: HTTP " + response.status);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("استجابة مفتاح التشفير ليست JSON صالحًا.");
  }

  const encoded = payload?.data?.key || payload?.key;
  if (typeof encoded !== "string" || !encoded.trim()) {
    throw new Error("الموقع لم يُرجع مفتاح التشفير: " + JSON.stringify(payload).slice(0, 500));
  }

  const key = Buffer.from(encoded.trim(), "base64");
  if (![16, 32].includes(key.length)) {
    throw new Error("طول مفتاح AES غير متوقع: " + key.length + " بايت.");
  }

  keyCache.set(chapterUrl, {
    key,
    expires: Date.now() + KEY_CACHE_TTL_MS
  });
  return key;
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

function decryptImage(raw, key) {
  // StellarSaber format: 12-byte IV + ciphertext + 16-byte GCM tag.
  if (raw.length < 12 + 1 + 16) {
    throw new Error("ملف الصورة أقصر من بنية AES-GCM المتوقعة.");
  }

  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(raw.length - 16);
  const ciphertext = raw.subarray(12, raw.length - 16);
  const algorithm = key.length === 16 ? "aes-128-gcm" : "aes-256-gcm";

  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

async function readImage(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30000),
    headers: {
      "User-Agent": UA,
      "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      "Referer": BASE + "/"
    }
  });

  if (!response.ok) {
    throw new Error("تحميل ملف CDN فشل: HTTP " + response.status);
  }

  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_IMAGE_BYTES) {
    throw new Error("حجم ملف الصورة يتجاوز الحد المسموح.");
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_IMAGE_BYTES) {
    throw new Error("حجم ملف الصورة يتجاوز الحد المسموح.");
  }

  return Buffer.from(arrayBuffer);
}

async function handleImage(imgUrl, chapterUrl, res) {
  if (!validImageUrl(imgUrl)) {
    return send(res, 400, "رابط CDN غير مسموح.");
  }
  if (!validChapterUrl(chapterUrl)) {
    return send(res, 400, "رابط الفصل غير صالح.");
  }

  const raw = await readImage(imgUrl);
  let output = raw;
  let type = detectImageType(raw);

  if (!type) {
    const key = await getDecryptionKey(chapterUrl);
    output = decryptImage(raw, key);
    type = detectImageType(output);
  }

  if (!type) {
    throw new Error("تمت معالجة الملف لكن الناتج ليس JPEG أو PNG أو WebP أو GIF. تحقق من صيغة تشفير الموقع.");
  }

  res.writeHead(200, {
    "Content-Type": type,
    "Content-Length": output.length,
    "Cache-Control": "public, max-age=3600",
    "Access-Control-Allow-Origin": "*",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(output);
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    return send(res, 204, "");
  }

  if (req.method !== "GET") {
    return send(res, 405, "Method Not Allowed");
  }

  let parsed;
  try {
    parsed = new URL(req.url, "http://" + HOST + ":" + PORT);
  } catch {
    return send(res, 400, "Bad request");
  }

  if (parsed.pathname === "/health") {
    return send(res, 200, "StellarSaber Proxy OK");
  }

  if (parsed.pathname !== "/") {
    return send(res, 404, "Not found");
  }

  const imgUrl = parsed.searchParams.get("img");
  const chapterUrl = parsed.searchParams.get("ch");
  if (!imgUrl || !chapterUrl) {
    return send(res, 400, "Missing img or ch parameter.");
  }

  try {
    await handleImage(imgUrl, chapterUrl, res);
  } catch (error) {
    console.error("[StellarSaber Proxy]", error.stack || error.message);
    if (!res.headersSent) {
      send(res, 502, "Proxy error: " + error.message);
    } else {
      res.destroy(error);
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log("StellarSaber Proxy listening at http://" + HOST + ":" + PORT);
  console.log("Health check: http://" + HOST + ":" + PORT + "/health");
});

server.on("error", error => {
  console.error("Proxy server error:", error.message);
  process.exitCode = 1;
});
