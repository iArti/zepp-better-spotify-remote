import { readdirSync, openAssetsSync, statAssetsSync, readSync, closeSync, O_RDONLY } from "@zos/fs";
import { create, id } from "@zos/media";
import { localStorage } from "@zos/storage";
import { readTags } from "./id3";
import { compareText, albumKey, trackKey } from "./text";
import { localSort } from "./config";
import { t } from "./i18n";

// "Music from the watch": plays files the system Music app stored on the watch.
// The data dir is /storage/js_apps/data/<ID>, so ../../.. is /storage
// (the sandbox does not block "..", this is what makes it work).
const MUSIC_REL = "../../../Downloads/Music/list";
const AUDIO_EXT = /\.(mp3|opus)$/i;
const INDEX_KEY = "localIndex"; // { file: tags } cache
const SOURCE_KEY = "source";
const LAST_KEY = "localLast"; // file of the last played track
// The player reports -1 until a track is prepared and does not keep the volume
// between tracks, so the app keeps it and re-applies it on every track
const VOLUME_KEY = "localVolume";
const DEFAULT_VOLUME = 50;
const SCAN_CHUNK = 8;

export const SOURCE_SPOTIFY = "spotify";
export const SOURCE_WATCH = "watch";

function globalData() {
  const app = getApp();
  return app.globalData || (app._options && app._options.globalData);
}

export function getSource() {
  const g = globalData();
  if (!g.source) g.source = localStorage.getItem(SOURCE_KEY, SOURCE_SPOTIFY) || SOURCE_SPOTIFY;
  return g.source;
}

export function setSource(source) {
  globalData().source = source;
  localStorage.setItem(SOURCE_KEY, source);
}

export function isWatchSource() {
  return getSource() === SOURCE_WATCH;
}

// Cover index generated on the PC by tools/import_covers.py (assets/covers/index.json)
function loadCoverIndex() {
  let fd = -1;
  try {
    const st = statAssetsSync({ path: "covers/index.json" });
    if (!st || !st.size) return {};
    fd = openAssetsSync({ path: "covers/index.json", flag: O_RDONLY });
    const buf = new ArrayBuffer(st.size);
    readSync({ fd, buffer: buf });
    const bytes = new Uint8Array(buf);
    let json = "";
    for (let i = 0; i < bytes.length; i++) json += String.fromCharCode(bytes[i]); // ASCII only
    return JSON.parse(json);
  } catch (e) {
    return {};
  } finally {
    if (fd >= 0) {
      try {
        closeSync({ fd });
      } catch (e) {}
    }
  }
}

const SORTS = {
  name: (a, b) => compareText(a.title, b.title) || compareText(a.artist, b.artist),
  artist: (a, b) =>
    compareText(a.albumArtist || a.artist, b.albumArtist || b.artist) ||
    compareText(a.album, b.album) ||
    (a.track || 0) - (b.track || 0) ||
    compareText(a.title, b.title),
  album: (a, b) => compareText(a.album, b.album) || (a.track || 0) - (b.track || 0) || compareText(a.title, b.title),
};

class LocalPlayer {
  constructor() {
    this.tracks = []; // sorted
    this.index = -1;
    this.player = null;
    this.prepared = false;
    this.playing = false;
    this.basePos = 0; // ms played before the current start
    this.startedAt = 0;
    this.duration = 0;
    this.scanning = false;
    this.onChange = null; // set by the control page
    this.covers = loadCoverIndex();
    this.loadIndex();
  }

  loadIndex() {
    let cache = {};
    try {
      cache = JSON.parse(localStorage.getItem(INDEX_KEY, "{}")) || {};
    } catch (e) {}
    this.setTracks(Object.keys(cache).map((file) => ({ file, ...cache[file] })));
    const last = localStorage.getItem(LAST_KEY, "");
    if (last && this.index < 0) this.index = this.tracks.findIndex((t) => t.file === last);
  }

  setTracks(list) {
    const current = this.current();
    this.tracks = list.sort(SORTS[localSort] || SORTS.name);
    this.index = current ? this.tracks.findIndex((t) => t.file === current.file) : -1;
  }

  // Reads tags of new files in chunks so the UI stays responsive
  scan(onProgress, onDone) {
    if (this.scanning) return;
    let files = [];
    try {
      files = (readdirSync({ path: MUSIC_REL }) || []).filter((f) => AUDIO_EXT.test(f));
    } catch (e) {
      files = [];
    }

    let cache = {};
    try {
      cache = JSON.parse(localStorage.getItem(INDEX_KEY, "{}")) || {};
    } catch (e) {}
    const next = {};
    const todo = [];
    files.forEach((f) => (cache[f] ? (next[f] = cache[f]) : todo.push(f)));

    this.scanning = true;
    let done = 0;
    const step = () => {
      for (let n = 0; n < SCAN_CHUNK && todo.length; n++) {
        const f = todo.shift();
        const tags = readTags(`${MUSIC_REL}/${f}`);
        next[f] = {
          title: tags.title || f.replace(AUDIO_EXT, ""),
          artist: tags.artist || "",
          album: tags.album || "",
          albumArtist: tags.albumArtist || "",
          track: tags.track || 0,
        };
        done++;
      }
      if (onProgress) onProgress(done, done + todo.length);
      if (todo.length) {
        setTimeout(step, 10);
        return;
      }
      localStorage.setItem(INDEX_KEY, JSON.stringify(next));
      this.setTracks(Object.keys(next).map((file) => ({ file, ...next[file] })));
      this.scanning = false;
      if (onDone) onDone(this.tracks.length);
      this.emit();
    };
    setTimeout(step, 10);
  }

  current() {
    return this.index >= 0 ? this.tracks[this.index] : null;
  }

  coverFor(t) {
    if (!t) return "";
    const c = this.covers;
    const file = (c.albums && t.album && c.albums[albumKey(t.artist, t.album)]) || (c.tracks && c.tracks[trackKey(t.artist, t.title)]);
    return file ? "covers/" + file : "";
  }

  position() {
    return this.basePos + (this.playing ? Date.now() - this.startedAt : 0);
  }

  // Prefer the player created by app.js (owned by the app, survives page changes)
  newPlayer() {
    const g = globalData();
    if (g.mediaPlayer) {
      const p = g.mediaPlayer;
      g.mediaPlayer = null;
      return p;
    }
    return g.createPlayer ? g.createPlayer() : create(id.PLAYER);
  }

  // A released player stops reporting a usable state
  isAlive() {
    if (!this.player) return false;
    try {
      const st = this.player.getStatus();
      const s = this.player.state;
      return [s.PREPARED, s.PLAY, s.PAUSED, s.STARTED, s.STARTING, s.RESUMING, s.PREPARING].indexOf(st) >= 0;
    } catch (e) {
      return false;
    }
  }

  // Recreate the player and continue the current track from the same spot
  recover() {
    console.log("local player recover");
    const pos = this.position();
    const wasPlaying = this.playing;
    this.player = null;
    this.pendingSeek = this.duration ? Math.min(99, (pos / this.duration) * 100) : 0;
    this.pendingPos = pos;
    this.pendingPause = !wasPlaying;
    this.playIndex(this.index >= 0 ? this.index : 0, true);
  }

  // Drops a player that stopped working. A finished track leaves the player in a
  // state isAlive() does not list, but it is still usable: replacing it would
  // leave two native players fighting over audio (hangs, then a watch reboot).
  dropIfDead() {
    if (this.player && this.prepared && !this.completed && !this.isAlive()) this.player = null;
  }

  ensurePlayer() {
    if (this.player) return;
    const p = this.newPlayer();
    const ev = p.event;
    // Events of a replaced player must not touch the current one
    const mine = () => p === this.player;
    p.addEventListener(ev.PREPARE, (ok) => {
      if (!mine()) return;
      if (!ok) {
        console.log("local prepare failed", this.current() && this.current().file);
        this.playing = false;
        this.emit();
        return;
      }
      this.prepared = true;
      try {
        this.duration = (p.getDuration() || 0) * 1000;
      } catch (e) {
        this.duration = 0;
      }
      this.applyVolume();
      if (this.pendingSeek) {
        const pct = this.pendingSeek;
        const pos = this.pendingPos || 0;
        const pause = this.pendingPause;
        this.pendingSeek = 0;
        try {
          p.seek(pct); // starts playback from PREPARED
          this.basePos = pos;
          this.startedAt = Date.now();
          this.playing = true;
          if (pause) this.toggle();
          else this.emit();
          return;
        } catch (e) {
          console.log("local seek failed", e);
        }
      }
      this.resume();
    });
    p.addEventListener(ev.PAUSE, () => {
      // Our own pause() clears `playing` first, so this is a system pause
      // (resource conflict, page change): try to continue, at most every 5 s.
      // Near the end of the track it is the track finishing: COMPLETE handles that.
      if (!mine() || !this.playing) return;
      if (this.duration && this.position() > this.duration - 2000) return;
      const now = Date.now();
      if (now - (this.autoResumedAt || 0) > 5000) {
        this.autoResumedAt = now;
        console.log("local: system pause, resuming");
        const gen = this.gen;
        setTimeout(() => {
          if (!mine() || gen !== this.gen || !this.playing) return;
          try {
            p.start();
          } catch (e) {}
        }, 200);
        return;
      }
      this.basePos = this.position();
      this.playing = false;
      this.emit();
    });
    p.addEventListener(ev.COMPLETE, () => {
      if (!mine() || this.completed) return;
      this.completed = true;
      this.playing = false;
      this.basePos = this.duration;
      // Leave the native callback before stopping and re-preparing this player
      const gen = this.gen;
      setTimeout(() => {
        if (gen === this.gen) this.next();
      }, 300);
    });
    this.player = p;
  }

  playIndex(i, keepPending) {
    if (!this.tracks.length) return;
    if (!keepPending) this.pendingSeek = 0;
    this.dropIfDead();
    this.gen = (this.gen || 0) + 1; // cancels pending auto-resume / auto-next
    this.completed = false;
    this.index = ((i % this.tracks.length) + this.tracks.length) % this.tracks.length;
    this.ensurePlayer();
    this.prepared = false;
    this.playing = false;
    this.basePos = 0;
    this.duration = 0;
    try {
      this.player.stop();
    } catch (e) {}
    localStorage.setItem(LAST_KEY, this.current().file);
    this.player.setSource(this.player.source.FILE, { file: `data://${MUSIC_REL}/${this.current().file}` });
    this.player.prepare();
    this.emit();
  }

  resume() {
    this.player.start();
    this.startedAt = Date.now();
    this.playing = true;
    this.emit();
  }

  toggle() {
    if (this.completed) {
      this.next();
      return;
    }
    if (this.prepared && !this.isAlive()) {
      this.recover();
      return;
    }
    if (this.playing) {
      this.basePos = this.position();
      this.playing = false;
      try {
        this.player.pause();
      } catch (e) {}
      this.emit();
    } else if (this.prepared) this.resume();
    else this.playIndex(this.index >= 0 ? this.index : 0);
  }

  next() {
    this.playIndex(this.index + 1);
  }

  prev() {
    this.playIndex(this.index - 1);
  }

  stop() {
    this.gen = (this.gen || 0) + 1;
    this.completed = false;
    if (this.player) {
      try {
        this.player.stop();
      } catch (e) {}
    }
    this.prepared = false;
    if (this.playing) this.basePos = this.position();
    this.playing = false;
    this.emit();
  }

  getVolume() {
    const saved = parseInt(localStorage.getItem(VOLUME_KEY, ""), 10);
    if (saved >= 0 && saved <= 100) return saved;
    // First run: take the player's value if it reports a real one
    let v = -1;
    try {
      if (this.player) v = this.player.getVolume();
    } catch (e) {}
    return v >= 0 && v <= 100 ? v : DEFAULT_VOLUME;
  }

  setVolume(v) {
    localStorage.setItem(VOLUME_KEY, String(v));
    this.applyVolume();
  }

  applyVolume() {
    if (!this.player || !this.prepared) return;
    try {
      const ok = this.player.setVolume(this.getVolume());
      if (!ok) console.log("local setVolume rejected", this.getVolume());
    } catch (e) {
      console.log("local setVolume error", e);
    }
  }

  // Same shape as the Spotify state the control page renders
  state() {
    const track = this.current();
    return {
      local: true,
      active: true,
      playing: this.playing,
      title: track ? track.title : this.tracks.length ? t("chooseTrack") : "",
      artist: track
        ? track.artist
        : this.tracks.length
          ? t("tracksOnWatch", this.tracks.length)
          : this.scanning
            ? t("readingTags")
            : t("noMusicOnWatch"),
      progress: this.position(),
      duration: this.duration,
      liked: false,
      trackId: null,
      cover: this.coverFor(track),
      device: { type: "Watch", name: t("watch"), volume: this.getVolume() },
    };
  }

  emit() {
    if (this.onChange) this.onChange(this.state());
  }
}

export function getLocal() {
  const g = globalData();
  if (!g.local) g.local = new LocalPlayer();
  return g.local;
}
