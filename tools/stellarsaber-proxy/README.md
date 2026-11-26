# StellarSaber local image proxy

This helper runs on the same Windows PC as Harbor and converts StellarSaber CDN chapter images into normal image responses.

## Requirements
- Node.js 18 or newer (Node.js 20 LTS recommended)
- Harbor and this proxy running on the same PC

## Run on Windows
1. Install Node.js 20 LTS.
2. Open PowerShell in this folder.
3. Run: `node server.js`
4. Open `http://127.0.0.1:8787/health` in a browser. It should return JSON with `"ok":true`.
5. Keep the PowerShell window open while reading chapters in Harbor.

No npm packages are required.

## Important
- The proxy binds only to 127.0.0.1 and is not exposed to your local network.
- It only accepts chapter URLs from `stellarsaber.pro` and image URLs from `cdn-stellarsaber.com`.
- It expects encrypted images in this format: 12-byte IV + AES-GCM ciphertext + 16-byte authentication tag.
- If the site's nonce/key response or encryption format has changed, the proxy will return a descriptive error. A successful health check only confirms that the local server is running; it does not prove that decryption works.
- Harbor's StellarSaber source already points to `http://127.0.0.1:8787`.
