import { BasePage } from "@zeppos/zml/base-page";
import { createWidget, deleteWidget, widget, prop, align, text_style } from "@zos/ui";
import { px } from "@zos/utils";
import { back, push } from "@zos/router";
import { onKey, offKey, showToast, KEY_UP, KEY_DOWN, KEY_EVENT_CLICK } from "@zos/interaction";
import { W, GRAY, MINT, DARK, text, setText, onTap, formatError } from "../../shared/ui";
import { getLocal, isWatchSource, setSource, SOURCE_SPOTIFY, SOURCE_WATCH } from "../../shared/local";
import { createVolume, getBridge, wantsBridge, VOLUME_STEP } from "../../shared/volume";
import { deviceIcon } from "../../shared/devices";
import { t } from "../../shared/i18n";

// Layout: source switch (Spotify | Watch), one row of device cards across the
// widest part of the round screen (up to three fit; more scroll sideways),
// then volume and the optional SimpleZepp line.
const LABEL = 0x8a8a8a;
const PILL = 0x2a2a2a;
const ACTIVE = 0x1a5c36;
const LABEL_Y = 50;
const SWITCH_Y = 82;
const CARDS_Y = 160;
const VOLUME_Y = 336;
const BRIDGE_Y = 402;
const CARD_W = 136;
const CARD_H = 148;
const CARD_GAP = 10;
const CARD_ICON = 64;
const CARDS_EDGE = 26; // left inset when the row scrolls
const SCROLL_TAP_GUARD_MS = 400; // a tap right after scrolling is the end of the scroll
const PAIR_POLL_MS = 2000;
const PAIR_POLL_LIMIT = 48; // ~95 s, a bit longer than the phone-side pairing window

Page(
  BasePage({
    build() {
      createWidget(widget.FILL_RECT, { x: 0, y: 0, w: px(W), h: px(W), color: DARK });
      text(140, LABEL_Y, 200, 30, t("source"), { size: 18, color: LABEL });

      // Source switch: two halves on a pill
      createWidget(widget.FILL_RECT, {
        x: px(76),
        y: px(SWITCH_Y),
        w: px(328),
        h: px(60),
        radius: px(30),
        color: PILL,
      });
      this.spotifyBtn = this.segment(80, "Spotify", () => this.selectSpotify());
      this.watchBtn = this.segment(242, t("watch"), () => this.selectWatch());

      this.body = [];
      this.devices = null; // null = loading
      this.devicesError = "";

      this.initVolume();
      this.render();

      this.request({ method: "devices" }, { timeout: 10000 })
        .then(({ result }) => {
          this.devices = result;
          this.render();
        })
        .catch((e) => {
          this.devices = [];
          this.devicesError = formatError(e);
          this.render();
        });

      this.checkBridge();
    },

    segmentStyle(x, label, active) {
      return {
        x: px(x),
        y: px(SWITCH_Y + 4),
        w: px(158),
        h: px(52),
        radius: px(26),
        normal_color: active ? ACTIVE : PILL,
        press_color: active ? ACTIVE : 0x3a3a3a,
        color: active ? 0xffffff : GRAY,
        text_size: px(24),
        text: label,
      };
    },

    segment(x, label, onClick) {
      return createWidget(widget.BUTTON, { ...this.segmentStyle(x, label, false), click_func: onClick });
    },

    renderSwitch() {
      const watch = isWatchSource();
      this.spotifyBtn.setProperty(prop.MORE, this.segmentStyle(80, "Spotify", !watch));
      this.watchBtn.setProperty(prop.MORE, this.segmentStyle(242, t("watch"), watch));
    },

    // --- body: rebuilt whenever the source, the device list or SimpleZepp changes ---

    add(w) {
      this.body.push(w);
      return w;
    },

    render() {
      this.body.forEach((w) => deleteWidget(w));
      this.body = [];
      this.valueText = null;
      this.renderSwitch();
      this.renderVolumePill();
      this.renderBridgeLine();
      this.renderCards(this.cards());
    },

    // Cards for the current source: { icon, label, active, onClick }
    cards() {
      if (isWatchSource()) {
        const local = getLocal();
        const count = local.tracks.length;
        const label = count ? t("tracks", count) : local.scanning ? t("readingTags") : t("noMusic");
        const list = [{ icon: "dev_watch_mg.png", label, active: true, onClick: null }];
        if (count) list.push({ icon: "queue.png", label: t("songList"), onClick: () => push({ url: "page/queue/index" }) });
        return list;
      }
      if (this.devices === null) return { message: t("loading") };
      if (!this.devices.length) {
        return { message: this.devicesError || t("noSpotifyDevices") };
      }
      return this.devices.map((d) => ({
        icon: deviceIcon(d, d.active ? "_mg" : "_m"),
        label: d.name,
        active: d.active,
        onClick: () => this.select(d),
      }));
    },

    renderCards(cards) {
      if (!Array.isArray(cards)) {
        this.add(text(70, CARDS_Y + 20, W - 140, 90, cards.message, { size: 20, color: GRAY, wrap: true }));
        return;
      }
      const n = cards.length;
      const rowW = n * CARD_W + (n - 1) * CARD_GAP;
      // Up to three are centered; more start at the edge and scroll sideways
      const startX = n <= 3 ? (W - rowW) / 2 : CARDS_EDGE;
      const contentW = Math.max(W, startX + rowW + CARDS_EDGE);

      const row = this.add(
        createWidget(widget.VIEW_CONTAINER, {
          x: 0,
          y: px(CARDS_Y),
          w: px(W),
          h: px(CARD_H + 4),
          scroll_enable: n > 3 ? 1 : 0,
          scroll_frame_func: () => {
            this.lastScroll = Date.now();
          },
        })
      );
      // Keeps the container as wide as the row so it can scroll horizontally
      row.createWidget(widget.FILL_RECT, { x: 0, y: 0, w: px(contentW), h: px(CARD_H + 4), color: DARK });

      const guard = (fn) => () => {
        if (Date.now() - (this.lastScroll || 0) < SCROLL_TAP_GUARD_MS) return;
        fn();
      };
      cards.forEach((c, i) => {
        const x = startX + i * (CARD_W + CARD_GAP);
        const onClick = c.onClick ? guard(c.onClick) : null;
        row.createWidget(widget.BUTTON, {
          x: px(x),
          y: px(2),
          w: px(CARD_W),
          h: px(CARD_H),
          radius: px(20),
          normal_color: c.active ? ACTIVE : PILL,
          press_color: c.onClick ? 0x3a3a3a : c.active ? ACTIVE : PILL,
          text: "",
          click_func: onClick || (() => {}),
        });
        const icon = row.createWidget(widget.IMG, {
          x: px(x + (CARD_W - CARD_ICON) / 2),
          y: px(18),
          w: px(CARD_ICON),
          h: px(CARD_ICON),
          auto_scale: true,
          src: c.icon,
        });
        const label = row.createWidget(widget.TEXT, {
          x: px(x + 6),
          y: px(88),
          w: px(CARD_W - 12),
          h: px(54),
          text: c.label,
          text_size: px(17),
          color: 0xffffff,
          align_h: align.CENTER_H,
          align_v: align.CENTER_V,
          text_style: text_style.WRAP,
        });
        // Icon and label sit on top of the button, so they forward taps too
        if (onClick) {
          onTap(icon, onClick);
          onTap(label, onClick);
        }
      });
    },

    // --- volume ---

    initVolume() {
      if (this.volume) this.volume.flush();
      this.volume = createVolume(this, () => this.renderVolume());
      onKey({
        callback: (key, keyEvent) => {
          if (key !== KEY_UP && key !== KEY_DOWN) return false;
          if (keyEvent === KEY_EVENT_CLICK) this.volume.change(key === KEY_UP ? VOLUME_STEP : -VOLUME_STEP);
          return true;
        },
      });
    },

    renderVolumePill() {
      const y = VOLUME_Y;
      this.add(createWidget(widget.FILL_RECT, { x: px(104), y: px(y), w: px(272), h: px(58), radius: px(29), color: PILL }));
      const minus = this.add(text(110, y, 64, 58, "−", { size: 36 }));
      const plus = this.add(text(306, y, 64, 58, "+", { size: 36 }));
      this.valueText = this.add(text(174, y, 132, 58, "", { size: 28 }));
      onTap(minus, () => this.volume.change(-VOLUME_STEP));
      onTap(plus, () => this.volume.change(VOLUME_STEP));
      onTap(this.valueText, () => push({ url: "page/volume/index" }));
      this.renderVolume();
    },

    renderVolume() {
      if (!this.valueText) return;
      const v = this.volume;
      setText(this.valueText, v.supported ? `${v.value}%` : v.viaBridge ? "…" : "—");
    },

    // --- SimpleZepp (optional; the line is hidden when the bridge is absent) ---

    renderBridgeLine() {
      const b = getBridge();
      if (!b.available) return;
      let label;
      let color = LABEL;
      let onClick = null;
      if (!b.paired) {
        if (b.pairing) label = t("confirmOnPhone");
        else {
          label = t("connectSimpleZepp");
          color = MINT;
          onClick = () => this.pairBridge();
        }
      } else label = wantsBridge() ? t("simpleZeppConnected") : t("simpleZeppInactive");
      const line = this.add(text(100, BRIDGE_Y, 280, 28, label, { size: 17, color }));
      if (onClick) onTap(line, onClick);
    },

    checkBridge() {
      this.request({ method: "bridge_status" }, { timeout: 9000 })
        .then(({ result }) => this.onBridgeStatus(result))
        .catch(() => this.onBridgeStatus({ available: false, paired: false, pairing: false }));
    },

    onBridgeStatus(st) {
      const b = getBridge();
      const wasPaired = b.paired;
      Object.assign(b, st);
      if (st.paired && wantsBridge()) {
        if (!wasPaired || !this.volume.viaBridge) this.initVolume();
        this.request({ method: "bridge_volume" }, { timeout: 9000 })
          .then(({ result }) => {
            b.volume = result;
            if (this.volume.viaBridge) this.volume.setKnown(result);
          })
          .catch((e) => console.log("bridge volume failed", e));
      }
      this.render();
    },

    pairBridge() {
      const b = getBridge();
      if (b.paired || b.pairing) return;
      b.pairing = true;
      // Called from the tapped line itself: don't delete it inside its own event
      setTimeout(() => this.render(), 0);
      this.request({ method: "bridge_pair" }, { timeout: 9000 }).catch(() => {});
      this.pollPairing(0);
    },

    pollPairing(n) {
      if (n >= PAIR_POLL_LIMIT) {
        getBridge().pairing = false;
        this.render();
        return;
      }
      this.pairTimer = setTimeout(() => {
        this.request({ method: "bridge_status" }, { timeout: 9000 })
          .then(({ result }) => {
            if (result.paired || !result.pairing) this.onBridgeStatus(result);
            else this.pollPairing(n + 1);
          })
          .catch(() => this.pollPairing(n + 1));
      }, PAIR_POLL_MS);
    },

    // --- sources ---

    selectWatch() {
      if (isWatchSource()) return;
      // Stop Spotify so two things don't play at once
      const s = getApp().globalData.state;
      if (s && s.playing) this.request({ method: "pause" }, { timeout: 8000 }).catch(() => {});
      setSource(SOURCE_WATCH);
      this.initVolume();
      this.render();
    },

    selectSpotify() {
      if (!isWatchSource()) return;
      getLocal().stop();
      setSource(SOURCE_SPOTIFY);
      this.initVolume();
      this.render();
    },

    select(device) {
      if (device.active) {
        back();
        return;
      }
      this.request({ method: "transfer", params: { id: device.id } }, { timeout: 10000 })
        .then(() => back())
        .catch((e) => showToast({ content: formatError(e) }));
    },

    // The volume page replaces the key listener and may change the volume
    onResume() {
      this.initVolume();
      this.render();
    },

    onDestroy() {
      if (this.pairTimer) clearTimeout(this.pairTimer);
      if (this.volume) this.volume.flush();
      try {
        offKey();
      } catch (e) {}
    },
  })
);
