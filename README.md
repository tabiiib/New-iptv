# TABIB IPTV — Multi-Playlist Site (GitHub + Cloudflare Pages)

## What is inside this ZIP:
- `index.html` — Exact split-screen TV layout matching your screenshot
- `style.css` — Dark blue theme optimized for 2019 LG webOS TV browsers & mobile
- `app.js` — Merges all 6 playlists, prioritizes fast BDIX links, removes duplicates, and auto-switches to backup links if a stream buffers or goes offline
- `functions/api/proxy.js` — Built-in Cloudflare Edge Proxy that fixes HTTP-on-HTTPS blocks and CORS errors on 2019 LG Smart TVs
- `_headers` — Cloudflare Pages security & CORS headers

## How to Upload (Zero Coding Required):
1. Unzip this folder on your computer or phone.
2. Open your **GitHub** repository (for example `tabib-tv`).
3. Click **Add file → Upload files**.
4. Drag **all files and the `functions` folder** inside `tabib_tv_site` into GitHub (make sure `index.html` is in the main root folder, not inside a subfolder).
5. Click **Commit changes**.
6. Cloudflare Pages will automatically deploy your updated site in ~30 seconds!
