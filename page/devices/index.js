import { BasePage } from "@zeppos/zml/base-page";
import { createWidget, deleteWidget, widget, prop, align } from "@zos/ui";
import { px } from "@zos/utils";
import { back, push } from "@zos/router";
import { onKey, offKey, KEY_UP, KEY_DOWN, KEY_EVENT_CLICK } from "@zos/interaction";
import { W, GRAY, MINT, DARK, text, setText, onTap, formatError } from "../../shared/ui";
import { getLocal, isWatchSource, setSource, SOURCE_SPOTIFY, SOURCE_WATCH } from "../../shared/local";
import { createVolume, getBridge, wantsBridge, VOLUME_STEP } from "../../shared/volume";
import { deviceIcon } from "../../shared/devices";

// Layout: source switch (Spotify | Watch) on top, then where it plays,
// then a compact volume control and the optional SimpleZepp line.
const LABEL = 0x8a8a8a;
const PILL = 0x2a2a2a;
const ACTIVE = 0x1a5c36;
const LINE = 0x333333;
const ROW = 54;
const LIST_TOP = 172;
const PAIR_POLL_MS = 2000;
const PAIR_POLL_LIMIT = 48; // ~95 s, a bit longer than the phone-side pairing window

Page(
  BasePage({
    build() {
      createWidget(widget.FILL_RECT, { x: 0, y: 0, w: px(W), h: px(1200), color: DARK });
      text(140, 30, 200, 30, "ИСТОЧНИК", { size: 18, color: LABEL });

      // Source switch: two halves on a pill
      createWidget(widget.FILL_RECT, { x: px(80), y: px(74), w: px(320), h: px(54), radius: px(27), color: PILL });
      this.spotifyBtn = this.segment(84, "Spotify", () => this.selectSpotify());
      this.watchBtn = this.segment(240, "Часы", () => this.selectWatch());

      this.sectionLabel = text(140, 140, 200, 30, "", { size: 18, color: LABEL });
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

    segment(x, label, onClick) {
      return createWidget(widget.BUTTON, {
        x: px(x),
        y: px(78),
        w: px(156),
        h: px(46),
        radius: px(23),
        normal_color: PILL,
        press_color: 0x3a3a3a,
        color: GRAY,
        text_size: px(22),
        text: label,
        click_func: onClick,
      });
    },

    renderSwitch() {
      const watch = isWatchSource();
      const style = (x, label, active) => ({
        x: px(x),
        y: px(78),
        w: px(156),
        h: px(46),
        radius: px(23),
        normal_color: active ? ACTIVE : PILL,
        press_color: active ? ACTIVE : 0x3a3a3a,
        color: active ? 0xffffff : GRAY,
        text_size: px(22),
        text: label,
      });
      this.spotifyBtn.setProperty(prop.MORE, style(84, "Spotify", !watch));
      this.watchBtn.setProperty(prop.MORE, style(240, "Часы", watch));
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

      let y = LIST_TOP;
      if (isWatchSource()) {
        setText(this.sectionLabel, "НА ЧАСАХ");
        const local = getLocal();
        const count = local.tracks.length;
        const label = count ? `${count} треков` : local.scanning ? "Читаю теги…" : "Нет музыки на часах";
        y = this.row(y, "dev_watch_s.png", label, true, null);
        if (count) y = this.row(y, null, "Список песен  ›", false, () => push({ url: "page/queue/index" }), true);
      } else {
        setText(this.sectionLabel, "ГДЕ ИГРАЕТ");
        if (this.devices === null) {
          this.add(text(100, y, 280, ROW, "Загрузка…", { size: 22, color: GRAY }));
          y += ROW;
        } else if (!this.devices.length) {
          const msg = this.devicesError || "Нет устройств Spotify. Откройте Spotify на телефоне или ПК.";
          this.add(text(90, y, 300, ROW * 2, msg, { size: 20, color: GRAY, wrap: true }));
          y += ROW * 2;
        } else {
          this.devices.forEach((d, i) => {
            y = this.row(y, deviceIcon(d, true), d.name, d.active, () => this.select(d), i < this.devices.length - 1);
          });
        }
      }

      this.renderVolumePill(y + 14);
      this.renderBridgeLine(y + 70);
      // Spacer so everything can scroll above the round bottom edge
      this.add(text(0, y + 110, W, 120, ""));
    },

    // One list row: icon, name, dot when active; returns the next row's y
    row(y, icon, label, active, onClick, separator) {
      if (onClick) {
        this.add(
          createWidget(widget.BUTTON, {
            x: px(80),
            y: px(y),
            w: px(320),
            h: px(ROW),
            radius: px(14),
            normal_color: DARK,
            press_color: PILL,
            text: "",
            click_func: onClick,
          })
        );
      }
      if (icon) this.add(createWidget(widget.IMG, { x: px(90), y: px(y + 9), w: px(36), h: px(36), src: icon }));
      const name = this.add(
        text(icon ? 138 : 96, y, 220, ROW, label, { size: 24, color: active ? MINT : 0xffffff, alignH: align.LEFT })
      );
      if (onClick) onTap(name, onClick); // the label sits on top of the button
      if (active) this.add(text(356, y, 30, ROW, "●", { size: 18, color: MINT }));
      if (separator) {
        this.add(createWidget(widget.FILL_RECT, { x: px(96), y: px(y + ROW - 1), w: px(288), h: 1, color: LINE }));
      }
      return y + ROW;
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

    renderVolumePill(y) {
      this.add(createWidget(widget.FILL_RECT, { x: px(113), y: px(y), w: px(254), h: px(50), radius: px(25), color: PILL }));
      const minus = this.add(text(118, y, 60, 50, "−", { size: 32 }));
      const plus = this.add(text(302, y, 60, 50, "+", { size: 32 }));
      this.valueText = this.add(text(178, y, 124, 50, "", { size: 24 }));
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

    renderBridgeLine(y) {
      const b = getBridge();
      if (!b.available) return;
      let label;
      let color = LABEL;
      let onClick = null;
      if (!b.paired) {
        if (b.pairing) label = "Подтвердите на телефоне…";
        else {
          label = "Подключить SimpleZepp";
          color = MINT;
          onClick = () => this.pairBridge();
        }
      } else label = wantsBridge() ? "SimpleZepp подключён" : "SimpleZepp неактивен";
      const line = this.add(text(100, y, 280, 30, label, { size: 17, color }));
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
        .catch((e) => {
          this.devicesError = formatError(e);
          this.render();
        });
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
