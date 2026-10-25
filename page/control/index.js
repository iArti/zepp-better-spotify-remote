import { BasePage } from "@zeppos/zml/base-page";
import { createWidget, widget, prop, event, align, getTextLayout } from "@zos/ui";
import { px } from "@zos/utils";
import { push } from "@zos/router";
import { Time } from "@zos/sensor";
import { localStorage } from "@zos/storage";
import {
  setScrollMode,
  swipeToIndex,
  SCROLL_MODE_SWIPER,
  SCROLL_ANIMATION_NONE,
  SCROLL_ANIMATION_SMOOTH,
} from "@zos/page";
import { setPageBrightTime, pauseDropWristScreenOff, resetDropWristScreenOff } from "@zos/display";
import {
  onKey,
  offKey,
  onGesture,
  offGesture,
  KEY_SELECT,
  KEY_UP,
  KEY_DOWN,
  KEY_EVENT_CLICK,
  KEY_EVENT_LONG_PRESS,
  GESTURE_UP,
} from "@zos/interaction";
import { W, GREEN, MINT, DARK, text, setText, iconButton, formatError } from "../../shared/ui";
import { ensureFileReceiver } from "../../shared/files";
import { rightHandMode, applyOptimizations } from "../../shared/config";
import { getLocal, isWatchSource } from "../../shared/local";

// Spotify polling: every 3 s; with applyOptimizations rarely on the screensaver
// (it is meant to stay on for a long time), right after the expected track end
const POLL_CONTROLS_MS = 3000;
const POLL_SAVER_PLAYING_MS = 15000;
const POLL_SAVER_PAUSED_MS = 30000;
const TRACK_END_SLACK_MS = 1500;
// Screen stays on while playing; on pause it times out after this
const PAUSED_SCREEN_MS = 3 * 60 * 1000;
const MAX_BRIGHT_MS = 2147483000;
// Screensaver taps: one = play/pause, two = prev (left half) / next (right half)
const DOUBLE_TAP_MS = 300;
const TAP_SLOP = 24; // finger movement that still counts as a tap, not a swipe
// Page dots on the screensaver fade out after this
const SAVER_DOTS_MS = 2000;
// Screensaver text: no marquee, no ellipsis; long lines run off the right edge into the vignette
const SAVER_TEXT_X = 50;
const SAVER_TITLE_SIZE = 42;
const SAVER_ARTIST_SIZE = 30;

// Vertical screens: 0 = screensaver, 1 = controls; swiping up from controls opens the library
const SAVER = 0;
const CONTROLS = 1;

// Progress ring around the play button (relative to the controls screen)
const RING_CX = 240;
const RING_CY = 240;
const RING_R = 69;
const RING_LINE = 9;
// ARC strokes inside its box, so the middle of the line is half a width in
const KNOB_R = RING_R - RING_LINE / 2;

// Bottom row: like and device mirrored around the center at the same height, queue below
const BOTTOM_DX = 122;
const BOTTOM_Y = 362;
const QUEUE_Y = 399;

// Spotify Connect device.type -> icon; anything else keeps the generic one
const DEVICE_ICONS = {
  Computer: "dev_computer.png",
  Smartphone: "dev_phone.png",
  Tablet: "dev_tablet.png",
  Speaker: "dev_speaker.png",
  CastAudio: "dev_speaker.png",
  AudioDongle: "dev_speaker.png",
  AVR: "dev_speaker.png",
  TV: "dev_tv.png",
  CastVideo: "dev_tv.png",
  STB: "dev_tv.png",
  Automobile: "dev_car.png",
  Watch: "dev_watch.png", // "Music from the watch" mode
};

function deviceIcon(device) {
  return (device && DEVICE_ICONS[device.type]) || "devices.png";
}

// Centered if it fits; otherwise left-aligned and as wide as the text itself,
// so nothing is cut with "..." and the tail goes past the screen edge
function setSaverText(widgetRef, value, size, y, h) {
  const avail = px(W - 2 * SAVER_TEXT_X);
  let width = 0;
  try {
    width = value ? getTextLayout(value, { text_size: px(size), text_width: 0, wrapped: 0 }).width : 0;
  } catch (e) {
    width = 0;
  }
  const fits = width <= avail;
  widgetRef.setProperty(prop.MORE, {
    x: px(SAVER_TEXT_X),
    y: px(y),
    w: fits ? avail : width + px(16),
    h: px(h),
    text: value,
    align_h: fits ? align.CENTER_H : align.LEFT,
  });
}

Page(
  BasePage({
    state: {
      player: null,
      lastSync: 0,
      busy: false,
      timers: [],
      screenIndex: CONTROLS,
      keepAwake: null,
    },

    build() {
      const app = getApp();
      const cached = app.globalData.state;

      setScrollMode({
        mode: SCROLL_MODE_SWIPER,
        options: {
          height: px(W),
          count: 2,
          modeParams: {
            on_page: (index) => this.onScreen(index),
          },
        },
      });

      this.covers = [];
      this.shown = {};
      this.coverSrc = isWatchSource() ? "" : localStorage.getItem("coverPath", "") || "";
      this.buildSaver(SAVER * W);
      this.buildControls(CONTROLS * W);

      this.time = new Time();
      this.updateClock();
      this.time.onPerMinute(() => this.updateClock());

      swipeToIndex({ index: CONTROLS, animation: SCROLL_ANIMATION_NONE });

      // "Music from the watch": the local player pushes its state here
      this.local = getLocal();
      this.local.onChange = (s) => {
        if (isWatchSource()) this.render(s);
      };

      if (isWatchSource()) this.enterWatchMode();
      else if (cached) this.render(cached, true);
      this.applyScreenPolicy(!!(this.state.player && this.state.player.playing));

      this.bindInput();
      ensureFileReceiver();

      app.globalData.onCover = (path) => {
        if (!isWatchSource()) this.setCover(path);
      };

      this.refresh();
      this.state.timers.push(setInterval(() => this.tick(), 1000));
    },

    background(top, overlay) {
      createWidget(widget.FILL_RECT, { x: 0, y: px(top), w: px(W), h: px(W), color: DARK });
      this.covers.push(
        createWidget(widget.IMG, {
          x: 0,
          y: px(top),
          w: px(W),
          h: px(W),
          auto_scale: true,
          src: this.coverSrc,
        })
      );
      // Topmost full-screen widget; the screensaver uses it as its tap surface
      this.lastWidget = createWidget(widget.IMG, { x: 0, y: px(top), w: px(W), h: px(W), auto_scale: true, src: overlay });
    },

    pageDots(top, active) {
      return [213, 240, 267].map((y, i) =>
        createWidget(widget.CIRCLE, {
          center_x: px(459),
          center_y: px(top + y),
          radius: px(5),
          color: i === active ? 0xffffff : 0x666666,
        })
      );
    },

    // Called whenever the visible screen changes (swipe or Select)
    onScreen(index) {
      const changed = this.state.screenIndex !== index;
      this.state.screenIndex = index;
      // on_page may fire before build() has created the widgets
      if (changed && this.progressArc) {
        if (index === CONTROLS) {
          // Back from the screensaver: fresh data and the ring right away
          this.updateProgress();
          this.refresh();
        } else this.scheduleRefresh();
      }
      if (this.dotsTimer) clearTimeout(this.dotsTimer);
      this.dotsTimer = null;
      if (index !== SAVER || !this.saverDots) return;

      this.saverDots.forEach((d) => d.setProperty(prop.VISIBLE, true));
      this.dotsTimer = setTimeout(() => {
        this.dotsTimer = null;
        this.saverDots.forEach((d) => d.setProperty(prop.VISIBLE, false));
      }, SAVER_DOTS_MS);
    },

    buildSaver(top) {
      this.background(top, "vignette_light.png");
      const tapLayer = this.lastWidget;
      this.saverClock = text(170, top + 10, 140, 40, "", { size: 32, color: MINT });
      this.saverTitle = text(SAVER_TEXT_X, top + 342, W - 2 * SAVER_TEXT_X, 60, "", { size: SAVER_TITLE_SIZE });
      this.saverArtist = text(SAVER_TEXT_X, top + 404, W - 2 * SAVER_TEXT_X, 44, "", {
        size: SAVER_ARTIST_SIZE,
        color: MINT,
      });
      this.saverDots = this.pageDots(top, 0);

      // Brief icon in the center confirming what a tap did
      this.flashBg = createWidget(widget.CIRCLE, {
        center_x: px(240),
        center_y: px(top + 220),
        radius: px(64),
        color: 0x000000,
        alpha: 80,
      });
      this.flashImg = createWidget(widget.IMG, {
        x: px(240 - 44),
        y: px(top + 220 - 44),
        w: px(88),
        h: px(88),
        src: "play.png",
      });
      this.hideFlash();

      [tapLayer, this.saverClock, this.saverTitle, this.saverArtist].forEach((w) => {
        w.addEventListener(event.CLICK_DOWN, (e) => {
          this.tapDown = { x: e.x, y: e.y };
        });
        w.addEventListener(event.CLICK_UP, (e) => this.onSaverTap(e));
      });
    },

    onSaverTap(e) {
      const down = this.tapDown;
      this.tapDown = null;
      // Ignore swipes between screens
      if (down && (Math.abs(e.x - down.x) > px(TAP_SLOP) || Math.abs(e.y - down.y) > px(TAP_SLOP))) return;

      if (this.tapTimer) {
        clearTimeout(this.tapTimer);
        this.tapTimer = null;
        const forward = e.x >= px(W) / 2;
        this.flash(forward ? "next.png" : "prev.png");
        this.command(forward ? "next" : "prev");
        return;
      }

      this.tapTimer = setTimeout(() => {
        this.tapTimer = null;
        const s = this.state.player;
        this.flash(s && s.playing ? "pause.png" : "play.png");
        this.togglePlay();
      }, DOUBLE_TAP_MS);
    },

    flash(src) {
      this.flashImg.setProperty(prop.SRC, src);
      this.flashBg.setProperty(prop.VISIBLE, true);
      this.flashImg.setProperty(prop.VISIBLE, true);
      if (this.flashTimer) clearTimeout(this.flashTimer);
      this.flashTimer = setTimeout(() => this.hideFlash(), 700);
    },

    // After a flash: keep a pause icon while paused, otherwise hide
    hideFlash() {
      this.flashTimer = null;
      const s = this.state.player;
      const paused = !!(s && s.active && s.title && !s.playing);
      if (paused) this.flashImg.setProperty(prop.SRC, "pause.png");
      this.flashBg.setProperty(prop.VISIBLE, paused);
      this.flashImg.setProperty(prop.VISIBLE, paused);
    },

    buildControls(top) {
      this.background(top, "vignette.png");

      this.clock = text(180, top + 16, 120, 34, "", { size: 24 });
      this.titleText = text(64, top + 54, W - 128, 52, "", { size: 40, marquee: true });
      this.artistText = text(90, top + 108, W - 180, 40, "Загрузка…", { size: 30, color: MINT });

      // Progress ring: track, value arc, knob
      this.ringTop = top;
      this.ringOpts = {
        x: px(RING_CX - RING_R),
        y: px(top + RING_CY - RING_R),
        w: px(RING_R * 2),
        h: px(RING_R * 2),
        line_width: px(RING_LINE),
        start_angle: -90,
      };
      createWidget(widget.ARC, { ...this.ringOpts, end_angle: 270, color: 0x8a8a8a });
      this.progressArc = createWidget(widget.ARC, { ...this.ringOpts, end_angle: -90, color: GREEN });
      this.knob = createWidget(widget.CIRCLE, {
        center_x: px(RING_CX),
        center_y: px(top + RING_CY - KNOB_R),
        radius: px(9),
        color: 0xffffff,
      });

      iconButton(86, top + 240, 120, 84, "prev.png", () => this.command("prev"));
      this.playBtn = iconButton(240, top + 240, 124, 88, "play.png", () => this.togglePlay());
      iconButton(394, top + 240, 120, 84, "next.png", () => this.command("next"));

      // Bottom row: like, current playlist, devices
      this.likeBtn = iconButton(240 - BOTTOM_DX, top + BOTTOM_Y, 96, 64, "like_add.png", () => this.toggleLike());
      iconButton(240, top + QUEUE_Y, 90, 54, "queue.png", () =>
        push({ url: "page/queue/index" })
      );
      this.deviceBtn = iconButton(240 + BOTTOM_DX, top + BOTTOM_Y, 96, 64, "devices.png", () =>
        push({ url: "page/devices/index" })
      );

      this.pageDots(top, 1);
    },

    // Only one key/gesture listener exists system-wide, so rebind when we come back
    bindInput() {
      onKey({
        callback: (key, keyEvent) => (rightHandMode ? this.onKeyRightHand(key, keyEvent) : this.onKeyDefault(key, keyEvent)),
      });
      onGesture({
        callback: (gesture) => {
          if (gesture !== GESTURE_UP || this.state.screenIndex !== CONTROLS) return false;
          push({ url: "page/library/index" });
          return true;
        },
      });
    },

    // Select: click = play/pause, long press = next track
    onKeyDefault(key, keyEvent) {
      if (key !== KEY_SELECT) return false;
      if (keyEvent === KEY_EVENT_CLICK) this.togglePlay();
      else if (keyEvent === KEY_EVENT_LONG_PRESS) this.command("next");
      return true;
    },

    // Up = play/pause, Down = next (hold = previous track), Select = switch screen
    onKeyRightHand(key, keyEvent) {
      if (key === KEY_UP) {
        if (keyEvent === KEY_EVENT_CLICK) this.togglePlay();
        return true;
      }
      if (key === KEY_DOWN) {
        if (keyEvent === KEY_EVENT_CLICK) this.command("next");
        else if (keyEvent === KEY_EVENT_LONG_PRESS) this.command("prev");
        return keyEvent === KEY_EVENT_CLICK || keyEvent === KEY_EVENT_LONG_PRESS;
      }
      if (key === KEY_SELECT) {
        if (keyEvent === KEY_EVENT_CLICK) {
          const index = this.state.screenIndex === CONTROLS ? SAVER : CONTROLS;
          swipeToIndex({ index, animation: SCROLL_ANIMATION_SMOOTH });
          this.onScreen(index);
        }
        return true;
      }
      return false;
    },

    onResume() {
      this.bindInput();
      ensureFileReceiver();
      // The source may have been switched on the devices page
      if (isWatchSource()) this.enterWatchMode();
      else if (this.state.player && this.state.player.local) {
        this.setCover(localStorage.getItem("coverPath", "") || "");
        this.refresh();
      }
      // Other pages reset the page bright time, so apply it again
      const s = this.state.player;
      this.state.keepAwake = null;
      this.applyScreenPolicy(!!(s && s.playing));
    },

    applyScreenPolicy(playing) {
      if (this.state.keepAwake === playing) return;
      this.state.keepAwake = playing;
      // Wrist gestures never turn the screen off here; only the timeout does
      // (endless while playing, 3 minutes when paused)
      if (playing) {
        setPageBrightTime({ brightTime: MAX_BRIGHT_MS });
        pauseDropWristScreenOff({ duration: 0 });
      } else {
        setPageBrightTime({ brightTime: PAUSED_SCREEN_MS });
        pauseDropWristScreenOff({ duration: PAUSED_SCREEN_MS });
      }
    },

    updateClock() {
      const h = String(this.time.getHours()).padStart(2, "0");
      const m = String(this.time.getMinutes()).padStart(2, "0");
      setText(this.clock, `${h}:${m}`);
      setText(this.saverClock, `${h}:${m}`);
    },

    // Shows the watch library state; reads tags of new files first if needed
    enterWatchMode() {
      const local = this.local;
      this.render(local.state());
      if (!local.scanning && (!local.tracks.length || !local.scannedThisRun)) {
        local.scannedThisRun = true;
        local.scan((done, total) => {
          if (!local.tracks.length) {
            setText(this.artistText, `Читаю теги… ${done}/${total}`);
            this.shown.artist = null;
          }
        });
      }
    },

    setCover(src) {
      if (src === this.coverSrc) return;
      this.coverSrc = src;
      this.covers.forEach((c) => c.setProperty(prop.SRC, src));
    },

    // Delay until the next Spotify poll; null = no polling (the watch player pushes changes)
    nextPollDelay() {
      if (isWatchSource()) return null;
      if (!applyOptimizations || this.state.screenIndex === CONTROLS) return POLL_CONTROLS_MS;
      const s = this.state.player;
      if (!s || !s.playing) return POLL_SAVER_PAUSED_MS;
      if (!s.duration) return POLL_SAVER_PLAYING_MS;
      const left = s.duration - (s.progress + Date.now() - this.state.lastSync);
      return Math.max(2000, Math.min(POLL_SAVER_PLAYING_MS, left + TRACK_END_SLACK_MS));
    },

    scheduleRefresh() {
      if (this.pollTimer) clearTimeout(this.pollTimer);
      this.pollTimer = null;
      const delay = this.nextPollDelay();
      if (delay) this.pollTimer = setTimeout(() => this.refresh(), delay);
    },

    refresh() {
      if (isWatchSource()) {
        if (this.pollTimer) clearTimeout(this.pollTimer);
        this.pollTimer = null;
        this.render(this.local.state());
        return;
      }
      if (this.state.busy) return;
      this.state.busy = true;
      this.request({ method: "state", params: { haveCover: localStorage.getItem("coverId", "") } }, { timeout: 8000 })
        .then(({ result }) => {
          // The source may have switched to the watch while the request was in flight
          if (!isWatchSource()) this.render(result);
          getApp().globalData.state = result;
          this.persist(result);
        })
        .catch((e) => {
          if (!isWatchSource()) this.showError(e);
        })
        .finally(() => {
          this.state.busy = false;
          this.scheduleRefresh();
        });
    },

    // The cache is for instant start-up; rewrite it only when something visible changed
    persist(s) {
      const d = s.device || {};
      const key = [s.title, s.artist, s.playing, s.liked, d.id, d.type, s.coverId].join("|");
      if (key === this.savedKey) return;
      this.savedKey = key;
      localStorage.setItem("state", JSON.stringify(s));
    },

    // Updates a widget only when its value changed (render runs on every poll)
    apply(key, value, fn) {
      if (this.shown[key] === value) return;
      this.shown[key] = value;
      fn(value);
    },

    render(s, fromCache = false) {
      this.state.player = s;
      this.state.lastSync = Date.now();

      const hasTrack = s.active && s.title;
      const title = hasTrack ? s.title : "";
      const artist = hasTrack || s.local ? s.artist || "" : fromCache ? "Загрузка…" : "Нет активного устройства";
      const saverArtist = hasTrack ? s.artist || "" : "";
      this.apply("title", title, (v) => setText(this.titleText, v));
      // Measuring text is the expensive part: only when the track changes
      this.apply("saverTitle", title, (v) => setSaverText(this.saverTitle, v, SAVER_TITLE_SIZE, SAVER * W + 342, 60));
      this.apply("artist", artist, (v) => setText(this.artistText, v));
      this.apply("saverArtist", saverArtist, (v) =>
        setSaverText(this.saverArtist, v, SAVER_ARTIST_SIZE, SAVER * W + 404, 44)
      );

      this.apply("play", s.playing ? "pause.png" : "play.png", (v) => this.playBtn.setProperty(prop.SRC, v));
      this.apply("like", s.liked ? "like_done.png" : "like_add.png", (v) => this.likeBtn.setProperty(prop.SRC, v));
      this.apply("device", deviceIcon(s.device), (v) => this.deviceBtn.setProperty(prop.SRC, v));
      // Like only exists for Spotify; covers come from the PC-made index in watch mode
      this.apply("likeVisible", !s.local, (v) => this.likeBtn.setProperty(prop.VISIBLE, v));
      this.setCover(s.local ? s.cover || "" : localStorage.getItem("coverPath", "") || "");
      this.updateProgress();
      if (!fromCache) this.applyScreenPolicy(!!s.playing);
      if (!this.flashTimer) this.hideFlash();
    },

    // The ring lives on the controls screen; don't redraw it while the screensaver is up
    tick() {
      const s = this.state.player;
      if (s && s.playing && this.state.screenIndex === CONTROLS) this.updateProgress();
    },

    updateProgress() {
      const s = this.state.player;
      let pct = 0;
      if (s && s.duration) {
        const elapsed = s.playing ? Date.now() - this.state.lastSync : 0;
        pct = Math.min(1, (s.progress + elapsed) / s.duration);
      }

      const angle = -90 + 360 * pct;
      this.progressArc.setProperty(prop.MORE, { ...this.ringOpts, end_angle: angle, color: GREEN });

      const rad = (angle * Math.PI) / 180;
      this.knob.setProperty(prop.MORE, {
        center_x: px(RING_CX + KNOB_R * Math.cos(rad)),
        center_y: px(this.ringTop + RING_CY + KNOB_R * Math.sin(rad)),
        radius: px(9),
        color: 0xffffff,
      });
    },

    showError(e) {
      setText(this.artistText, formatError(e));
      this.shown.artist = null; // the next render must restore the artist line
    },

    togglePlay() {
      if (isWatchSource()) {
        this.local.toggle();
        return;
      }
      const s = this.state.player;
      const playing = !!(s && s.playing);
      this.optimistic({ playing: !playing });
      this.command(playing ? "pause" : "play");
    },

    // Show the expected state right away; the next poll corrects it if needed
    optimistic(patch) {
      const s = this.state.player;
      if (!s) return;
      const elapsed = s.playing ? Date.now() - this.state.lastSync : 0;
      this.render({ ...s, progress: s.progress + elapsed, ...patch });
    },

    toggleLike() {
      const s = this.state.player;
      if (!s || !s.trackId) return;
      const liked = !s.liked;
      this.optimistic({ liked });
      this.request({ method: liked ? "like" : "unlike", params: { id: s.trackId } }, { timeout: 8000 })
        .catch((e) => this.showError(e));
    },

    command(method) {
      if (isWatchSource()) {
        const local = this.local;
        if (method === "next") local.next();
        else if (method === "prev") local.prev();
        else if (method === "play" || method === "pause") local.toggle();
        return;
      }
      this.request({ method }, { timeout: 8000 })
        .then(() => setTimeout(() => this.refresh(), 400))
        .catch((e) => this.showError(e));
    },

    onDestroy() {
      this.state.timers.forEach((t) => clearInterval(t));
      if (this.pollTimer) clearTimeout(this.pollTimer);
      if (this.tapTimer) clearTimeout(this.tapTimer);
      if (this.flashTimer) clearTimeout(this.flashTimer);
      if (this.dotsTimer) clearTimeout(this.dotsTimer);
      getApp().globalData.onCover = null;
      // Playback is stopped by the app's onDestroy, not here: this page may be
      // destroyed while the app keeps running
      if (this.local) this.local.onChange = null;
      try {
        offKey();
        offGesture();
        resetDropWristScreenOff();
      } catch (e) {}
    },
  })
);
