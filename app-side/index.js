import { BaseSideService } from "@zeppos/zml/base-side";
import { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REFRESH_TOKEN } from "./secrets";

const API = "https://api.spotify.com/v1";
const REFRESH_TOKEN_KEY = "spotify_refresh_token";
const COVER_SIZE = 300;
const MAX_RECENT = 20;

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64(str) {
  let out = "";
  for (let i = 0; i < str.length; i += 3) {
    const a = str.charCodeAt(i);
    const b = str.charCodeAt(i + 1);
    const c = str.charCodeAt(i + 2);
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | (b >> 4 || 0)];
    out += isNaN(b) ? "=" : B64[((b & 15) << 2) | (c >> 6 || 0)];
    out += isNaN(c) ? "=" : B64[c & 63];
  }
  return out;
}

function formEncode(obj) {
  return Object.keys(obj)
    .map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(obj[k]))
    .join("&");
}

function parseBody(body) {
  if (typeof body !== "string") return body;
  try {
    return JSON.parse(body);
  } catch (e) {
    return body;
  }
}

let accessToken = null;
let accessTokenExpires = 0;

function getRefreshToken() {
  try {
    return settings.settingsStorage.getItem(REFRESH_TOKEN_KEY) || SPOTIFY_REFRESH_TOKEN;
  } catch (e) {
    return SPOTIFY_REFRESH_TOKEN;
  }
}

async function getAccessToken() {
  if (accessToken && Date.now() < accessTokenExpires) return accessToken;

  const res = await fetch({
    url: "https://accounts.spotify.com/api/token",
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + base64(SPOTIFY_CLIENT_ID + ":" + SPOTIFY_CLIENT_SECRET),
    },
    body: formEncode({ grant_type: "refresh_token", refresh_token: getRefreshToken() }),
  });
  const data = parseBody(res.body);

  if (res.status !== 200 || !data.access_token) {
    throw new Error("auth_failed");
  }

  accessToken = data.access_token;
  accessTokenExpires = Date.now() + (data.expires_in - 60) * 1000;
  // Spotify may rotate refresh tokens
  if (data.refresh_token) {
    try {
      settings.settingsStorage.setItem(REFRESH_TOKEN_KEY, data.refresh_token);
    } catch (e) {}
  }
  return accessToken;
}

async function spotify(method, path, body) {
  const token = await getAccessToken();
  const opts = {
    url: API + path,
    method,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);

  const res = await fetch(opts);
  if (res.status === 401) accessToken = null;
  if (res.status >= 400) {
    const data = parseBody(res.body);
    const reason = (data && data.error && (data.error.reason || data.error.message)) || res.status;
    throw new Error(String(reason));
  }
  return res.status === 204 ? null : parseBody(res.body);
}

function pickCover(images) {
  if (!images || !images.length) return null;
  const sorted = images.slice().sort((a, b) => (a.width || 0) - (b.width || 0));
  return sorted.find((img) => (img.width || 0) >= COVER_SIZE) || sorted[sorted.length - 1];
}

function compactState(player) {
  if (!player || !player.item) {
    return { active: !!(player && player.device), playing: false, device: player && player.device };
  }
  const item = player.item;
  const isEpisode = item.type === "episode";
  const images = isEpisode ? (item.images || (item.show && item.show.images)) : item.album && item.album.images;
  const cover = pickCover(images);

  return {
    active: true,
    playing: !!player.is_playing,
    trackId: isEpisode ? null : item.id,
    contextUri: player.context ? player.context.uri : null,
    liked: false,
    title: item.name,
    artist: isEpisode
      ? item.show && item.show.name
      : (item.artists || []).map((a) => a.name).join(", "),
    progress: player.progress_ms || 0,
    duration: item.duration_ms || 0,
    coverUrl: cover ? cover.url : null,
    device: player.device
      ? {
          id: player.device.id,
          name: player.device.name,
          volume: player.device.volume_percent,
          supportsVolume: player.device.supports_volume !== false,
          type: player.device.type,
        }
      : null,
  };
}

function coverIdFromUrl(url) {
  return url.substring(url.lastIndexOf("/") + 1).replace(/[^a-zA-Z0-9]/g, "").slice(-16);
}

// Images go to the watch one at a time: download -> convert -> TransferFile.
// The track cover jumps the queue; list thumbnails follow.
const imageQueue = [];
let imageCurrent = null; // key of the job being transferred
let coverSlot = 0;

function isQueued(key) {
  return imageCurrent === key || imageQueue.some((j) => j.key === key);
}

function enqueueImage(job, urgent) {
  if (urgent) imageQueue.unshift(job);
  else imageQueue.push(job);
  pumpImages();
}

const IMAGE_JOB_TIMEOUT_MS = 60000;

function pumpImages() {
  if (imageCurrent || !imageQueue.length) return;
  const job = imageQueue.shift();
  imageCurrent = job.key;
  let finished = false;
  const finish = (state) => {
    if (finished) return;
    finished = true;
    clearTimeout(watchdog);
    if (state !== "transferred") console.log("image failed", job.key, state);
    imageCurrent = null;
    pumpImages();
  };
  // A stuck callback must not block the queue forever
  const watchdog = setTimeout(() => finish("timeout"), IMAGE_JOB_TIMEOUT_MS);

  try {
    // filePath is relative to data://download (as in the official zml example)
    const task = network.downloader.downloadFile({
      url: job.url,
      timeout: 30000,
      filePath: `${job.name}.jpg`,
    });
    task.onSuccess = (ev) => {
      if (ev.statusCode && ev.statusCode !== 200) {
        finish("dl http " + ev.statusCode);
        return;
      }
      image
        .convert({
          filePath: ev.filePath || ev.tempFilePath || `data://download/${job.name}.jpg`,
          targetFilePath: `data://download/${job.name}.png`,
        })
        .then((result) => {
          const outbox = transferFile.outbox || transferFile.getOutbox();
          const file = outbox.enqueueFile(result.targetFilePath, job.params);
          file.on("change", (e) => {
            const state = e.data.readyState;
            if (state === "transferred" || state === "error" || state === "canceled") finish(state);
          });
        })
        .catch((e) => finish("conv err: " + ((e && e.message) || e)));
    };
    task.onFail = (ev) => finish("dl err: " + ev.code + " " + ev.message);
  } catch (e) {
    finish("err: " + ((e && e.message) || e));
  }
}

function sendCover(url) {
  const coverId = coverIdFromUrl(url);
  if (isQueued("cover:" + coverId)) return;
  coverSlot = 1 - coverSlot;
  enqueueImage(
    { key: "cover:" + coverId, url, name: coverSlot ? "cover_a" : "cover_b", params: { kind: "cover", coverId } },
    true
  );
}

function sendThumb(id, url) {
  if (isQueued("thumb:" + id)) return;
  enqueueImage({ key: "thumb:" + id, url, name: "t_" + id, params: { kind: "thumb", id } }, false);
}

async function playlistFromOembed(uri) {
  const id = uri.split(":").pop();
  try {
    const res = await fetch({
      url: "https://open.spotify.com/oembed?url=" + encodeURIComponent("https://open.spotify.com/playlist/" + id),
      method: "GET",
    });
    const data = parseBody(res.body);
    if (res.status !== 200 || !data || !data.title) return null;
    return { id, uri, name: data.title, image: data.thumbnail_url || null };
  } catch (e) {
    return null;
  }
}

function smallestImage(images) {
  if (!images || !images.length) return null;
  return images.slice().sort((a, b) => (a.width || 0) - (b.width || 0))[0].url;
}

const handlers = {
  async state({ haveCover }) {
    const player = await spotify("GET", "/me/player?additional_types=episode");
    const state = compactState(player);
    if (state.trackId) {
      try {
        const contains = await spotify("GET", `/me/tracks/contains?ids=${state.trackId}`);
        state.liked = !!(contains && contains[0]);
      } catch (e) {
        // Missing library scope should not break playback state
      }
    }
    if (state.coverUrl) {
      state.coverId = coverIdFromUrl(state.coverUrl);
      if (state.coverId !== haveCover) sendCover(state.coverUrl);
    }
    delete state.coverUrl;
    return state;
  },
  play() {
    return spotify("PUT", "/me/player/play");
  },
  pause() {
    return spotify("PUT", "/me/player/pause");
  },
  next() {
    return spotify("POST", "/me/player/next");
  },
  prev() {
    return spotify("POST", "/me/player/previous");
  },
  like({ id }) {
    return spotify("PUT", `/me/tracks?ids=${id}`);
  },
  unlike({ id }) {
    return spotify("DELETE", `/me/tracks?ids=${id}`);
  },
  volume({ percent }) {
    return spotify("PUT", `/me/player/volume?volume_percent=${Math.round(percent)}`);
  },
  async devices() {
    const data = await spotify("GET", "/me/player/devices");
    return ((data && data.devices) || []).map((d) => ({
      id: d.id,
      name: d.name,
      type: d.type,
      active: d.is_active,
    }));
  },
  transfer({ id }) {
    return spotify("PUT", "/me/player", { device_ids: [id], play: true });
  },
  // Recently played first, then the rest of the user's playlists.
  // Playlist names/images come from /me/playlists in one call: Spotify returns 404
  // for its own generated mixes when fetched by id, so those are skipped unless saved.
  async recent({ haveThumbs }) {
    const have = haveThumbs || [];
    const [history, own] = await Promise.all([
      spotify("GET", "/me/player/recently-played?limit=50").catch(() => null),
      spotify("GET", "/me/playlists?limit=50"),
    ]);

    const playlists = {};
    ((own && own.items) || []).filter(Boolean).forEach((p) => {
      playlists[p.uri] = { id: p.id, uri: p.uri, name: p.name, image: smallestImage(p.images) };
    });

    // Unique contexts from history, newest first
    const seen = {};
    const contexts = [];
    ((history && history.items) || []).forEach(({ context }) => {
      if (!context || seen[context.uri]) return;
      if (context.type !== "playlist" && context.type !== "album") return;
      seen[context.uri] = true;
      contexts.push(context);
    });

    const albumIds = contexts.filter((c) => c.type === "album").map((c) => c.uri.split(":").pop());
    const albums = {};
    const addAlbum = (al) => {
      if (al) albums[al.uri] = { id: al.id, uri: al.uri, name: al.name, image: smallestImage(al.images) };
    };
    if (albumIds.length) {
      const ids = albumIds.slice(0, 20);
      try {
        const data = await spotify("GET", `/albums?ids=${ids.join(",")}`);
        ((data && data.albums) || []).forEach(addAlbum);
      } catch (e) {
        // Batch endpoint may be unavailable: fall back to parallel single lookups
        const list = await Promise.all(ids.map((id) => spotify("GET", `/albums/${id}`).catch(() => null)));
        list.forEach(addAlbum);
      }
    }

    // Spotify-made playlists (On Repeat, Daily Mix...) return 404 by id for new apps,
    // but the public oEmbed endpoint still gives their title and cover
    const missing = contexts
      .filter((c) => c.type === "playlist" && !playlists[c.uri])
      .slice(0, MAX_RECENT);
    const embeds = await Promise.all(missing.map((c) => playlistFromOembed(c.uri)));
    embeds.forEach((item) => {
      if (item) playlists[item.uri] = item;
    });

    const items = [];
    const added = {};
    const add = (item) => {
      if (!item || added[item.uri] || items.length >= MAX_RECENT) return;
      added[item.uri] = true;
      items.push(item);
    };
    contexts.forEach((c) => add(c.type === "album" ? albums[c.uri] : playlists[c.uri]));
    Object.keys(playlists).forEach((uri) => add(playlists[uri]));

    items.forEach((item) => {
      if (item.image && have.indexOf(item.id) === -1) sendThumb(item.id, item.image);
    });
    return items.map(({ id, uri, name }) => ({ id, uri, name }));
  },
  async queue() {
    const data = await spotify("GET", "/me/player/queue");
    const toItem = (t) => ({
      uri: t.uri,
      name: t.name,
      sub: t.artists ? t.artists.map((a) => a.name).join(", ") : t.show && t.show.name,
    });
    return {
      current: data && data.currently_playing ? toItem(data.currently_playing) : null,
      next: ((data && data.queue) || []).filter(Boolean).map(toItem),
    };
  },
  // Play a context (playlist/album), optionally starting at a track, or a plain list of tracks
  play_context({ contextUri, offsetUri, uris }) {
    if (contextUri) {
      const body = { context_uri: contextUri };
      if (offsetUri) body.offset = { uri: offsetUri };
      return spotify("PUT", "/me/player/play", body);
    }
    return spotify("PUT", "/me/player/play", { uris });
  },
  async play_liked() {
    const me = await spotify("GET", "/me");
    return spotify("PUT", "/me/player/play", { context_uri: `spotify:user:${me.id}:collection` });
  },
};

AppSideService(
  BaseSideService({
    onInit() {
      console.log("side service init");
    },

    onRequest(req, res) {
      const handler = handlers[req.method];
      if (!handler) {
        res("unknown_method");
        return;
      }
      if (!SPOTIFY_CLIENT_ID || !SPOTIFY_REFRESH_TOKEN) {
        res("no_credentials");
        return;
      }

      Promise.resolve()
        .then(() => handler(req.params || {}))
        .then((result) => res(null, { result: result === undefined ? null : result }))
        .catch((e) => {
          console.log("request failed", req.method, e && e.message);
          res((e && e.message) || "error");
        });
    },

    onRun() {},
    onDestroy() {},
  })
);
