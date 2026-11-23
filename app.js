const PLAYLIST_SOURCES = [
  { name: "Mrgify BDIX", priority: 1, url: "https://raw.githubusercontent.com/abusaeeidx/Mrgify-BDIX-IPTV/main/playlist.m3u" },
  { name: "Saeid BDIX", priority: 2, url: "https://raw.githubusercontent.com/saeidrahmanbd/BDIX-IPTV/main/IPTV-Playlist.m3u" },
  { name: "Rokon IPTV", priority: 3, url: "https://raw.githubusercontent.com/time2shine/Rokon-IPTV/main/playlist.m3u" },
  { name: "Scraper Zilla", priority: 4, url: "https://raw.githubusercontent.com/abusaeeidx/IPTV-Scraper-Zilla/main/combined-playlist.m3u" },
  { name: "Free-TV", priority: 5, url: "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8" },
  { name: "IPTV-Org", priority: 6, url: "https://iptv-org.github.io/iptv/index.m3u" }
];

const FALLBACK_LOGO = "data:image/svg+xml;utf8," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
    <rect width="64" height="64" rx="10" fill="#0d2238"/>
    <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="#38bdf8" font-family="sans-serif" font-weight="bold" font-size="18">TV</text>
  </svg>`
);

// Detect LG webOS Smart TV
const IS_WEBOS = /web0s|webos|netcast/i.test(navigator.userAgent);

let allChannels = []; // Merged unique channels, each having .streams = [{url, source, priority}]
let categories = [];
let activeCategory = "All";
let searchQuery = "";
let showFavouritesOnly = false;
let favourites = new Set(JSON.parse(localStorage.getItem("tabib_favs") || "[]"));

let currentChannel = null;
let currentStreamIdx = 0;
let hlsInstance = null;
let stallTimer = null;
let totalBytesLoaded = 0;
let lastSpeedCheckTime = Date.now();
let bytesSinceLastCheck = 0;

// DOM Elements
const video = document.getElementById("videoPlayer");
const statusOverlay = document.getElementById("statusOverlay");
const statusText = document.getElementById("statusText");
const currentLogo = document.getElementById("currentLogo");
const currentTitle = document.getElementById("currentTitle");
const currentCategory = document.getElementById("currentCategory");
const liveBadge = document.getElementById("liveBadge");
const modeSelect = document.getElementById("modeSelect");
const searchInput = document.getElementById("searchInput");
const clearBtn = document.getElementById("clearBtn");
const favFilterBtn = document.getElementById("favFilterBtn");
const categoryTabs = document.getElementById("categoryTabs");
const activeCategoryTitle = document.getElementById("activeCategoryTitle");
const channelCount = document.getElementById("channelCount");
const channelGrid = document.getElementById("channelGrid");
const speedStat = document.getElementById("speedStat");
const dataStat = document.getElementById("dataStat");

// Normalize channel name for deduplication & smart backup merging
function normalizeKey(name) {
  return name
    .toLowerCase()
    .replace(/\b(hd|fhd|sd|4k|uhd|720p|1080p|bangla|bd|in|tv|channel)\b/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim() || name.toLowerCase().trim();
}

// Categorize nicely so Bangla/Sports/News/Movies appear first like the screenshot
function normalizeCategory(rawGroup, name) {
  const g = (rawGroup || "").trim();
  const n = name.toLowerCase();
  if (/kolkata|indian bangla|bangla|bengali|jalsha|zee bangla|star jalsha|colors bangla|sony aath|aakaash/i.test(g + " " + n)) {
    if (/bangladesh|somoy|jamuna|ekattor|independent|channel i|ntv|atn|rtv|dbc|news24|maasranga|boishakhi|desh|nagorik|deepto/i.test(n)) {
      return "Bangladesh TV";
    }
    return "Kolkata Bangla";
  }
  if (/sport|cricket|football|t sports|gtv|sony ten|star sports|willow|ptv sports|eurosport|bein/i.test(g + " " + n)) {
    return "Sports";
  }
  if (/news|bbc|cnn|al jazeera|ndtv|republic|wion/i.test(g + " " + n)) {
    return "News";
  }
  if (/hindi|bollywood|star plus|colors|sony|zee tv|sab|star gold|sony max|zee cinema/i.test(g + " " + n)) {
    return "Hindi & Movies";
  }
  if (/music|mtv|9xm|sangeet|dhoom/i.test(g + " " + n)) {
    return "Music";
  }
  if (/kids|cartoon|pogo|nick|disney|hungama|sonic/i.test(g + " " + n)) {
    return "Kids";
  }
  if (/documentary|discovery|nat geo|animal planet|history|wildlife/i.test(g + " " + n)) {
    return "Documentary & Wildlife";
  }
  if (/religio|islam|peace|madani|iqra|qtv/i.test(g + " " + n)) {
    return "Religious";
  }
  return g || "General";
}

function parseM3U(text, sourceMeta) {
  const lines = text.split(/\r?\n/);
  const parsed = [];
  let currentMeta = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line.startsWith("#EXTINF:")) {
      const logoMatch = line.match(/tvg-logo="([^"]*)"/i);
      const groupMatch = line.match(/group-title="([^"]*)"/i);
      const commaIdx = line.lastIndexOf(",");
      const rawName = commaIdx !== -1 ? line.slice(commaIdx + 1).trim() : "Unknown Channel";
      const cleanName = rawName.replace(/^\d+\.\s*/, "").trim();

      currentMeta = {
        name: cleanName,
        logo: logoMatch ? logoMatch[1].trim() : "",
        rawGroup: groupMatch ? groupMatch[1].trim() : "",
      };
    } else if (!line.startsWith("#") && currentMeta) {
      if (line.startsWith("http://") || line.startsWith("https://")) {
        parsed.push({
          ...currentMeta,
          url: line,
          source: sourceMeta.name,
          priority: sourceMeta.priority
        });
      }
      currentMeta = null;
    }
  }
  return parsed;
}

async function fetchWithFallback(url) {
  // Try direct fetch first (GitHub raw & iptv-org support CORS natively)
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (res.ok) return await res.text();
  } catch (_) {}

  // Fallback to Cloudflare Pages Function proxy if direct fetch fails
  try {
    const proxyRes = await fetch(`/api/proxy?url=${encodeURIComponent(url)}`);
    if (proxyRes.ok) return await proxyRes.text();
  } catch (_) {}

  return "";
}

async function loadAllPlaylists() {
  activeCategoryTitle.textContent = "Merging 6 IPTV Playlists...";
  const results = await Promise.allSettled(
    PLAYLIST_SOURCES.map(async (src) => {
      const text = await fetchWithFallback(src.url);
      return parseM3U(text, src);
    })
  );

  const channelMap = new Map();
  let indexCounter = 1;

  results.forEach((res) => {
    if (res.status !== "fulfilled") return;
    res.value.forEach((item) => {
      const key = normalizeKey(item.name);
      const cat = normalizeCategory(item.rawGroup, item.name);

      if (!channelMap.has(key)) {
        channelMap.set(key, {
          id: key,
          number: indexCounter++,
          name: item.name,
          category: cat,
          logo: item.logo || FALLBACK_LOGO,
          streams: [{ url: item.url, source: item.source, priority: item.priority }]
        });
      } else {
        const existing = channelMap.get(key);
        if (!existing.logo || existing.logo === FALLBACK_LOGO) {
          if (item.logo) existing.logo = item.logo;
        }
        // Add backup stream URL if not duplicate
        if (!existing.streams.some((s) => s.url === item.url)) {
          existing.streams.push({ url: item.url, source: item.source, priority: item.priority });
          existing.streams.sort((a, b) => a.priority - b.priority);
        }
      }
    });
  });

  allChannels = Array.from(channelMap.values());

  // Build ordered category list
  const preferredOrder = [
    "Bangladesh TV",
    "Kolkata Bangla",
    "Sports",
    "News",
    "Hindi & Movies",
    "Music",
    "Kids",
    "Documentary & Wildlife",
    "Religious"
  ];
  const foundCats = new Set(allChannels.map((c) => c.category));
  categories = ["All"];
  preferredOrder.forEach((c) => {
    if (foundCats.has(c)) {
      categories.push(c);
      foundCats.delete(c);
    }
  });
  Array.from(foundCats).sort().forEach((c) => categories.push(c));

  activeCategory = categories.includes("Kolkata Bangla") ? "Kolkata Bangla" : "All";
  renderCategories();
  renderChannels();

  // Auto-play first channel if available
  const initialList = getFilteredChannels();
  if (initialList.length > 0) {
    playChannel(initialList[0], 0);
  }
}

function renderCategories() {
  categoryTabs.innerHTML = "";
  categories.forEach((cat) => {
    const btn = document.createElement("button");
    btn.className = "cat-pill" + (cat === activeCategory && !showFavouritesOnly ? " active" : "");
    btn.textContent = cat;
    btn.onclick = () => {
      showFavouritesOnly = false;
      favFilterBtn.classList.remove("active");
      activeCategory = cat;
      renderCategories();
      renderChannels();
    };
    categoryTabs.appendChild(btn);
  });
}

function getFilteredChannels() {
  return allChannels.filter((ch) => {
    if (showFavouritesOnly && !favourites.has(ch.id)) return false;
    if (!showFavouritesOnly && activeCategory !== "All" && ch.category !== activeCategory) return false;
    if (searchQuery && !ch.name.toLowerCase().includes(searchQuery)) return false;
    return true;
  });
}

function renderChannels() {
  const list = getFilteredChannels();
  activeCategoryTitle.textContent = showFavouritesOnly ? "Favourites" : activeCategory;
  channelCount.textContent = `${list.length} channels`;

  // Render in batches for smooth performance on 2019 LG webOS TV
  channelGrid.innerHTML = "";
  const fragment = document.createDocumentFragment();
  const displaySlice = list.slice(0, 350); // Keep DOM light on smart TVs; search filters the rest

  displaySlice.forEach((ch) => {
    const card = document.createElement("div");
    card.className = "channel-card" + (currentChannel && currentChannel.id === ch.id ? " active" : "");
    card.tabIndex = 0;

    const isFav = favourites.has(ch.id);
    const backupTag = ch.streams.length > 1 ? ` • ${ch.streams.length} links` : "";

    card.innerHTML = `
      <div class="card-left">
        <img class="card-logo" src="${ch.logo}" onerror="this.src='${FALLBACK_LOGO}'" alt="" loading="lazy" />
        <div class="card-info">
          <div class="card-title">${ch.number}. ${ch.name}</div>
          <div class="card-sub">${ch.category}${backupTag}</div>
        </div>
      </div>
      <button class="fav-star ${isFav ? "starred" : ""}" title="Favourite">${isFav ? "★" : "☆"}</button>
    `;

    card.onclick = (e) => {
      if (e.target.classList.contains("fav-star")) {
        toggleFavourite(ch.id);
        return;
      }
      playChannel(ch, 0);
    };

    card.onkeydown = (e) => {
      if (e.key === "Enter") playChannel(ch, 0);
    };

    fragment.appendChild(card);
  });

  channelGrid.appendChild(fragment);
}

function toggleFavourite(id) {
  if (favourites.has(id)) {
    favourites.delete(id);
  } else {
    favourites.add(id);
  }
  localStorage.setItem("tabib_favs", JSON.stringify(Array.from(favourites)));
  renderChannels();
}

function showOverlay(msg) {
  statusText.textContent = msg;
  statusOverlay.classList.remove("hidden");
}

function hideOverlay() {
  statusOverlay.classList.add("hidden");
}

function cleanupPlayer() {
  clearTimeout(stallTimer);
  if (hlsInstance) {
    hlsInstance.destroy();
    hlsInstance = null;
  }
  video.removeAttribute("src");
  video.load();
}

// Anti-Buffer + Smart Failover Engine
function playChannel(channel, streamIndex = 0) {
  currentChannel = channel;
  currentStreamIdx = streamIndex;

  const stream = channel.streams[streamIndex];
  if (!stream) {
    showOverlay("All links offline for this channel.");
    return;
  }

  // Update UI
  currentTitle.textContent = `#${channel.number} ${channel.name}`;
  currentCategory.textContent = `${channel.category} • Source ${streamIndex + 1}/${channel.streams.length} (${stream.source})`;
  currentLogo.src = channel.logo;
  currentLogo.classList.remove("hidden");
  renderChannels();

  cleanupPlayer();
  showOverlay(`Connecting (${stream.source})...`);

  const mode = modeSelect.value;
  let streamUrl = stream.url;

  // Mixed-content fix: If site is HTTPS and stream is HTTP, route via Cloudflare proxy automatically
  const isHttpsPage = window.location.protocol === "https:";
  const isHttpStream = streamUrl.startsWith("http://");

  if (mode === "proxy" || (isHttpsPage && isHttpStream && !IS_WEBOS)) {
    streamUrl = `/api/proxy?url=${encodeURIComponent(stream.url)}`;
  }

  // Determine whether to use Hardware Native (best for LG webOS 2019) or HLS.js
  const preferNative =
    mode === "native" ||
    (mode === "auto" && (IS_WEBOS || video.canPlayType("application/vnd.apple.mpegurl")));

  // Auto-failover if stream doesn't start within 7 seconds
  stallTimer = setTimeout(() => {
    tryNextBackupStream("Stream slow/timeout, switching backup...");
  }, 7500);

  if (preferNative && mode !== "hls-low") {
    liveBadge.textContent = `Live (${mode === "auto" ? "Auto • HW Native" : "HW Native"})`;
    video.src = streamUrl;
    video.play().catch(() => {
      // Fallback to HLS.js if native playback rejects
      startHlsJs(streamUrl, mode);
    });
  } else {
    startHlsJs(streamUrl, mode);
  }
}

function startHlsJs(streamUrl, mode) {
  if (!window.Hls || !Hls.isSupported()) {
    video.src = streamUrl;
    video.play().catch(() => tryNextBackupStream("Playback failed, trying backup..."));
    return;
  }

  liveBadge.textContent = mode === "proxy" ? "Live (CF Edge Proxy)" : "Live (HLS Anti-Buffer)";

  // Tuned for low memory (2019 LG webOS) & instant live edge recovery without stalling
  hlsInstance = new Hls({
    enableWorker: true,
    lowLatencyMode: false,
    maxBufferLength: 12,          // Keep buffer light for 2019 TV RAM
    maxMaxBufferLength: 24,
    backBufferLength: 6,
    liveSyncDurationCount: 3,
    liveMaxLatencyDurationCount: 6,
    fragLoadingTimeOut: 8000,
    manifestLoadingTimeOut: 8000,
    fragLoadingMaxRetry: 2,
    levelLoadingMaxRetry: 2
  });

  hlsInstance.loadSource(streamUrl);
  hlsInstance.attachMedia(video);

  hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
    clearTimeout(stallTimer);
    hideOverlay();
    video.play().catch(() => {});
  });

  // Track real bandwidth & data usage in top bar
  hlsInstance.on(Hls.Events.FRAG_LOADED, (_, data) => {
    clearTimeout(stallTimer);
    hideOverlay();
    const bytes = data?.frag?.stats?.total || 0;
    totalBytesLoaded += bytes;
    bytesSinceLastCheck += bytes;
  });

  hlsInstance.on(Hls.Events.ERROR, (_, data) => {
    if (data.fatal) {
      tryNextBackupStream("Stream error, switching link...");
    }
  });
}

function tryNextBackupStream(reason) {
  if (!currentChannel) return;
  if (currentStreamIdx + 1 < currentChannel.streams.length) {
    showOverlay(reason);
    setTimeout(() => {
      playChannel(currentChannel, currentStreamIdx + 1);
    }, 400);
  } else {
    showOverlay("Stream unavailable. Try switching Mode to Cloudflare Proxy.");
  }
}

// Native video event listeners
video.addEventListener("playing", () => {
  clearTimeout(stallTimer);
  hideOverlay();
});

video.addEventListener("waiting", () => {
  showOverlay("Buffering...");
  clearTimeout(stallTimer);
  stallTimer = setTimeout(() => {
    tryNextBackupStream("Buffering too long, switching backup...");
  }, 6500);
});

video.addEventListener("error", () => {
  tryNextBackupStream("Stream offline, switching backup...");
});

// Bandwidth & Data Counter updater (matches top bar "3.15 Mbps • 543.8 MB")
setInterval(() => {
  const now = Date.now();
  const elapsedSec = (now - lastSpeedCheckTime) / 1000;
  if (elapsedSec > 0) {
    const mbps = ((bytesSinceLastCheck * 8) / (elapsedSec * 1000000)).toFixed(2);
    const totalMb = (totalBytesLoaded / (1024 * 1024)).toFixed(1);
    speedStat.textContent = `${mbps} Mbps`;
    dataStat.textContent = `${totalMb} MB`;
  }
  bytesSinceLastCheck = 0;
  lastSpeedCheckTime = now;
}, 1500);

// Controls & Navigation
document.getElementById("prevBtn").onclick = () => {
  const list = getFilteredChannels();
  if (!list.length || !currentChannel) return;
  const idx = list.findIndex((c) => c.id === currentChannel.id);
  const prev = list[(idx - 1 + list.length) % list.length];
  playChannel(prev, 0);
};

document.getElementById("nextBtn").onclick = () => {
  const list = getFilteredChannels();
  if (!list.length || !currentChannel) return;
  const idx = list.findIndex((c) => c.id === currentChannel.id);
  const next = list[(idx + 1) % list.length];
  playChannel(next, 0);
};

modeSelect.onchange = () => {
  if (currentChannel) playChannel(currentChannel, currentStreamIdx);
};

document.getElementById("fullBtn").onclick = () => {
  const wrapper = document.getElementById("videoWrapper");
  if (!document.fullscreenElement) {
    (wrapper.requestFullscreen || video.webkitEnterFullscreen || wrapper.webkitRequestFullscreen).call(wrapper);
  } else {
    document.exitFullscreen();
  }
};

searchInput.oninput = (e) => {
  searchQuery = e.target.value.toLowerCase().trim();
  renderChannels();
};

clearBtn.onclick = () => {
  searchInput.value = "";
  searchQuery = "";
  showFavouritesOnly = false;
  favFilterBtn.classList.remove("active");
  renderCategories();
  renderChannels();
};

favFilterBtn.onclick = () => {
  showFavouritesOnly = !showFavouritesOnly;
  favFilterBtn.classList.toggle("active", showFavouritesOnly);
  renderCategories();
  renderChannels();
};

// LG Magic Remote Channel Up / Down support
document.addEventListener("keydown", (e) => {
  if (e.key === "ChannelUp" || e.keyCode === 427) {
    document.getElementById("nextBtn").click();
  } else if (e.key === "ChannelDown" || e.keyCode === 428) {
    document.getElementById("prevBtn").click();
  }
});

// Start
loadAllPlaylists();
