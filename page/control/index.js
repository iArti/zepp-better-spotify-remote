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
import { rightHandMode } from "../../shared/config";

const POLL_MS = 3000;
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
      this.buildSaver(SAVER * W);
      this.buildControls(CONTROLS * W);

      this.time = new Time();
      this.updateClock();
      this.time.onPerMinute(() => this.updateClock());

      swipeToIndex({ index: CONTROLS, animation: SCROLL_ANIMATION_NONE });

      if (cached) this.render(cached, true);
      this.applyScreenPolicy(!!(cached && cached.playing));

      this.bindInput();
      ensureFileReceiver();

      app.globalData.onCover = (path) => {
        this.covers.forEach((c) => c.setProperty(prop.SRC, path));
      };

      this.refresh();
      this.state.timers.push(setInterval(() => this.refresh(), POLL_MS));
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
          src: localStorage.getItem("coverPath", "") || "",
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
      this.state.screenIndex = index;
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
      this.saverClock = text(170, top + 10, 140, 40, "", { size: 34, color: MINT });
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
      this.likeBtn = iconButton(117, top + 366, 96, 64, "like_add.png", () => this.toggleLike());
      iconButton(240, top + 399, 90, 54, "queue.png", () =>
        push({ url: "page/queue/index" })
      );
      iconButton(378, top + 354, 104, 72, "devices.png", () => push({ url: "page/devices/index" }));

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

    // Up = play/pause, Down = next, Select = switch screen
    // (Down hold is taken by the system; previous track is a double tap on the left)
    onKeyRightHand(key, keyEvent) {
      if (key === KEY_UP) {
        if (keyEvent === KEY_EVENT_CLICK) this.togglePlay();
        return true;
      }
      if (key === KEY_DOWN) {
        if (keyEvent === KEY_EVENT_CLICK) this.command("next");
        return keyEvent === KEY_EVENT_CLICK;
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

    refresh() {
      if (this.state.busy) return;
      this.state.busy = true;
      this.request({ method: "state", params: { haveCover: localStorage.getItem("coverId", "") } }, { timeout: 8000 })
        .then(({ result }) => {
          this.render(result);
          getApp().globalData.state = result;
          localStorage.setItem("state", JSON.stringify(result));
        })
        .catch((e) => this.showError(e))
        .finally(() => {
          this.state.busy = false;
        });
    },

    render(s, fromCache = false) {
      this.state.player = s;
      this.state.lastSync = Date.now();

      const hasTrack = s.active && s.title;
      const artist = hasTrack ? s.artist || "" : fromCache ? "Загрузка…" : "Нет активного устройства";
      setText(this.titleText, hasTrack ? s.title : "");
      setSaverText(this.saverTitle, hasTrack ? s.title : "", SAVER_TITLE_SIZE, SAVER * W + 342, 60);
      setText(this.artistText, artist);
      setSaverText(this.saverArtist, hasTrack ? s.artist || "" : "", SAVER_ARTIST_SIZE, SAVER * W + 404, 44);

      this.playBtn.setProperty(prop.SRC, s.playing ? "pause.png" : "play.png");
      this.likeBtn.setProperty(prop.SRC, s.liked ? "like_done.png" : "like_add.png");
      this.updateProgress();
      if (!fromCache) this.applyScreenPolicy(!!s.playing);
      if (!this.flashTimer) this.hideFlash();
    },

    tick() {
      const s = this.state.player;
      if (s && s.playing) this.updateProgress();
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
    },

    togglePlay() {
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
      this.request({ method }, { timeout: 8000 })
        .then(() => setTimeout(() => this.refresh(), 400))
        .catch((e) => this.showError(e));
    },

    onDestroy() {
      this.state.timers.forEach((t) => clearInterval(t));
      if (this.tapTimer) clearTimeout(this.tapTimer);
      if (this.flashTimer) clearTimeout(this.flashTimer);
      if (this.dotsTimer) clearTimeout(this.dotsTimer);
      getApp().globalData.onCover = null;
      try {
        offKey();
        offGesture();
        resetDropWristScreenOff();
      } catch (e) {}
    },
  })
);
