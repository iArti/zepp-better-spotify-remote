// Optional SimpleZepp integration (https://github.com/iArti/SimpleZepp).
// Its phone app serves an HTTP bridge on the loopback interface; we use it only for
// the phone's media volume, which Spotify's API can't change on smartphones.
// If SimpleZepp is not installed, every call here fails fast and nothing changes.
const BASE = "http://127.0.0.1:47821";
const TOKEN_KEY = "simplezepp_token";
const AUDIO_STATUS = "/status/audio";
const AUDIO_VOLUME = "/status/audio/volume";
const PAIR_TIMEOUT_MS = 90 * 1000;
const EVENTS_WAIT_MS = 3000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parse(body) {
  if (typeof body !== "string") return body || {};
  try {
    return JSON.parse(body);
  } catch (e) {
    return {};
  }
}

function getToken() {
  try {
    return settings.settingsStorage.getItem(TOKEN_KEY) || "";
  } catch (e) {
    return "";
  }
}

function setToken(token) {
  try {
    if (token) settings.settingsStorage.setItem(TOKEN_KEY, token);
    else settings.settingsStorage.removeItem(TOKEN_KEY);
  } catch (e) {}
}

async function http(path, method = "GET", body) {
  const res = await fetch({
    url: BASE + path,
    method,
    headers: { "Content-Type": "application/json", "X-Bridge-Token": getToken() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) {
    setToken("");
    throw new Error("simplezepp_unpaired");
  }
  if (res.status !== 200) throw new Error("simplezepp_http_" + res.status);
  return parse(res.body);
}

let pairing = false;
// Last known music stream volume of the phone: { current, min, max }
let stream = null;

async function pairLoop() {
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const deadline = Date.now() + PAIR_TIMEOUT_MS;
  try {
    while (Date.now() < deadline) {
      const r = await http("/pair", "POST", { nonce, name: "Spotify Remote" });
      if (r.status === "ok" && r.token) {
        setToken(r.token);
        return;
      }
      await sleep(2000);
    }
  } catch (e) {
    console.log("simplezepp pair failed", e && e.message);
  } finally {
    pairing = false;
  }
}

function toPercent(s) {
  return s.max > s.min ? Math.round(((s.current - s.min) * 100) / (s.max - s.min)) : 0;
}

export const bridge = {
  // { available, paired, pairing }; available = the bridge answered at all
  async status() {
    try {
      const r = await http("/ping");
      return { available: true, paired: !!getToken() && !!r.paired, pairing };
    } catch (e) {
      return { available: false, paired: false, pairing: false };
    }
  },

  // Starts pairing in the background; the user approves a notification on the phone
  pair() {
    if (!pairing) {
      pairing = true;
      pairLoop();
    }
    return { pairing: true };
  },

  // Phone media volume in percent. The answer comes back through /events.
  // Note: /events is shared with the SimpleZepp watch app, avoid running both at once.
  async volume() {
    await http("/message", "POST", { path: AUDIO_STATUS, text: "MUSIC" });
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await http("/events?wait=" + EVENTS_WAIT_MS);
      const msg = (r.messages || []).filter((m) => m.path === AUDIO_STATUS && m.text).pop();
      if (msg) {
        const s = parse(msg.text);
        stream = { current: s.currentVolume, min: s.minVolume || 0, max: s.maxVolume || 15 };
        return toPercent(stream);
      }
    }
    throw new Error("simplezepp_no_answer");
  },

  async setVolume(percent) {
    if (!stream) await this.volume();
    const current = Math.round(stream.min + ((stream.max - stream.min) * percent) / 100);
    await http("/message", "POST", {
      path: AUDIO_VOLUME,
      text: JSON.stringify({
        currentVolume: current,
        minVolume: stream.min,
        maxVolume: stream.max,
        // SimpleWear JSON enums are lowercase
        streamType: "music",
      }),
    });
    stream.current = current;
    return toPercent(stream);
  },
};
