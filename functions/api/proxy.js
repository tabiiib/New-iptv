export async function onRequest(context) {
  const { request } = context;

  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "*"
      }
    });
  }

  const urlObj = new URL(request.url);
  const targetUrl = urlObj.searchParams.get("url");

  if (!targetUrl) {
    return new Response("Missing url parameter", { status: 400 });
  }

  try {
    const upstreamResponse = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/68.0.3440.106 Safari/537.36 WebAppManager",
        "Accept": "*/*"
      },
      redirect: "follow"
    });

    const contentType = upstreamResponse.headers.get("content-type") || "";
    const finalUrl = upstreamResponse.url || targetUrl;

    // If it's an M3U8 playlist, rewrite relative segment/variant URLs so they also pass through the proxy
    if (
      finalUrl.includes(".m3u8") ||
      contentType.includes("mpegurl") ||
      contentType.includes("x-mpegurl")
    ) {
      const playlistText = await upstreamResponse.text();
      const baseUrl = finalUrl.substring(0, finalUrl.lastIndexOf("/") + 1);
      const originProxy = `${urlObj.origin}/api/proxy?url=`;

      const rewritten = playlistText
        .split(/\r?\n/)
        .map((line) => {
          const trimmed = line.trim();
          if (!trimmed) return line;
          if (trimmed.startsWith("#")) {
            // Rewrite URI="..." inside tags like #EXT-X-KEY or #EXT-X-MEDIA
            return trimmed.replace(/URI="([^"]+)"/g, (_, uri) => {
              const abs = new URL(uri, baseUrl).href;
              return `URI="${originProxy}${encodeURIComponent(abs)}"`;
            });
          }
          const absoluteSegmentUrl = new URL(trimmed, baseUrl).href;
          return `${originProxy}${encodeURIComponent(absoluteSegmentUrl)}`;
        })
        .join("\n");

      return new Response(rewritten, {
        status: upstreamResponse.status,
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-cache"
        }
      });
    }

    // Stream video segments (.ts, .aac, .mp4) directly with CORS headers
    const headers = new Headers(upstreamResponse.headers);
    headers.set("Access-Control-Allow-Origin", "*");
    headers.delete("Content-Security-Policy");

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers
    });
  } catch (err) {
    return new Response(`Proxy error: ${err.message}`, {
      status: 502,
      headers: { "Access-Control-Allow-Origin": "*" }
    });
  }
}
