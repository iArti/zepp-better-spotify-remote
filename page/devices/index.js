import { BasePage } from "@zeppos/zml/base-page";
import { createWidget, widget, prop } from "@zos/ui";
import { px } from "@zos/utils";
import { back, push, replace } from "@zos/router";
import { localStorage } from "@zos/storage";
import { onKey, offKey, KEY_UP, KEY_DOWN, KEY_EVENT_CLICK } from "@zos/interaction";
import { W, GRAY, DARK, text, setText, listButton, title, formatError } from "../../shared/ui";
import { getLocal, isWatchSource, setSource, SOURCE_SPOTIFY, SOURCE_WATCH } from "../../shared/local";
import { createVolume, getBridge, wantsBridge, VOLUME_STEP } from "../../shared/volume";

const ROW = 88;
const TOP = 110;
const ACTIVE_COLOR = 0x1a5c36;
const IDLE_COLOR = 0x333333;
const PAIR_POLL_MS = 2000;
const PAIR_POLL_LIMIT = 48; // ~95 s, a bit longer than the phone-side pairing window
// Whether SimpleZepp answered last time: decides the layout before it answers now
const BRIDGE_SEEN_KEY = "bridgeSeen";

Page(
  BasePage({
    build() {
      const watch = isWatchSource();
      createWidget(widget.FILL_RECT, { x: 0, y: 0, w: px(W), h: px(W), color: DARK });
      title("Устройства");

      // Optional SimpleZepp row on top, only when the bridge exists on this phone
      this.hasBridgeRow = localStorage.getItem(BRIDGE_SEEN_KEY, "0") === "1";
      let y = TOP;
      if (this.hasBridgeRow) {
        this.bridgeY = y;
        this.bridgeBtn = listButton(y, "SimpleZepp…", () => this.onBridgeTap(), { color: IDLE_COLOR });
        y += ROW;
      }

      // Volume of the current source; Up/Down change it
      this.volumeY = y;
      this.volumeBtn = listButton(y, "", () => push({ url: "page/volume/index" }), { color: IDLE_COLOR });
      y += ROW;
      this.initVolume();

      // Shown right away: works without the phone
      listButton(y, (watch ? "● " : "") + "Музыка с часов", () => this.selectWatch(), {
        color: watch ? ACTIVE_COLOR : undefined,
      });
      y += ROW;
      this.devicesY = y;

      this.status = text(60, y + 10, W - 120, 80, "Загрузка…", { size: 26, color: GRAY, wrap: true });
      this.request({ method: "devices" }, { timeout: 10000 })
        .then(({ result }) => this.renderList(result))
        .catch((e) => setText(this.status, formatError(e)));

      this.checkBridge();
    },

    // --- SimpleZepp ---

    checkBridge() {
      this.request({ method: "bridge_status" }, { timeout: 9000 })
        .then(({ result }) => this.onBridgeStatus(result))
        .catch(() => this.onBridgeStatus({ available: false, paired: false, pairing: false }));
    },

    onBridgeStatus(st) {
      const b = getBridge();
      const wasPaired = b.paired;
      Object.assign(b, st);

      // Layout depends on whether the row exists: rebuild once if that changed
      if (st.available !== this.hasBridgeRow) {
        localStorage.setItem(BRIDGE_SEEN_KEY, st.available ? "1" : "0");
        replace({ url: "page/devices/index" });
        return;
      }
      if (!st.available) return;
      this.renderBridge();

      if (st.paired && wantsBridge()) {
        if (!wasPaired || !this.volume.viaBridge) this.initVolume();
        this.request({ method: "bridge_volume" }, { timeout: 9000 })
          .then(({ result }) => {
            b.volume = result;
            if (this.volume.viaBridge) this.volume.setKnown(result);
          })
          .catch((e) => console.log("bridge volume failed", e));
      }
    },

    renderBridge() {
      if (!this.bridgeBtn) return;
      const b = getBridge();
      let label;
      let color = IDLE_COLOR;
      if (!b.paired) label = b.pairing ? "Подтвердите на телефоне…" : "Подключить SimpleZepp";
      else if (wantsBridge()) {
        label = "SimpleZepp подключён";
        color = ACTIVE_COLOR;
      } else label = "SimpleZepp неактивен";
      this.bridgeBtn.setProperty(prop.MORE, {
        x: px(60),
        y: px(this.bridgeY),
        w: px(W - 120),
        h: px(76),
        text: label,
        normal_color: color,
      });
    },

    onBridgeTap() {
      const b = getBridge();
      if (b.paired || b.pairing) return;
      b.pairing = true;
      this.renderBridge();
      this.request({ method: "bridge_pair" }, { timeout: 9000 }).catch(() => {});
      this.pollPairing(0);
    },

    pollPairing(n) {
      if (n >= PAIR_POLL_LIMIT) {
        getBridge().pairing = false;
        this.renderBridge();
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

    // --- volume ---

    initVolume() {
      if (this.volume) this.volume.flush();
      this.volume = createVolume(this, () => this.renderVolume());
      this.renderVolume();
      onKey({
        callback: (key, keyEvent) => {
          if (key !== KEY_UP && key !== KEY_DOWN) return false;
          if (keyEvent === KEY_EVENT_CLICK) this.volume.change(key === KEY_UP ? VOLUME_STEP : -VOLUME_STEP);
          return true;
        },
      });
    },

    renderVolume() {
      const v = this.volume;
      const label = v.supported
        ? `Громкость ${v.value}%`
        : v.viaBridge
          ? "Громкость: …"
          : "Громкость: недоступно";
      this.volumeBtn.setProperty(prop.MORE, { x: px(60), y: px(this.volumeY), w: px(W - 120), h: px(76), text: label });
    },

    // The volume page replaces the key listener and may change the volume
    onResume() {
      this.initVolume();
    },

    onDestroy() {
      if (this.pairTimer) clearTimeout(this.pairTimer);
      if (this.volume) this.volume.flush();
      try {
        offKey();
      } catch (e) {}
    },

    // --- sources ---

    renderList(devices) {
      if (!devices.length) {
        setText(this.status, "Нет устройств Spotify. Откройте Spotify на телефоне или ПК.");
        return;
      }
      setText(this.status, "");

      const watch = isWatchSource();
      devices.forEach((d, i) => {
        const active = d.active && !watch;
        listButton(this.devicesY + i * ROW, (active ? "● " : "") + d.name, () => this.select(d), {
          color: active ? ACTIVE_COLOR : undefined,
        });
      });
      // Spacer so the last row can scroll above the bottom edge
      text(0, this.devicesY + devices.length * ROW, W, 120, "");
    },

    selectWatch() {
      if (isWatchSource()) {
        back();
        return;
      }
      // Stop Spotify so two things don't play at once
      const s = getApp().globalData.state;
      if (s && s.playing) this.request({ method: "pause" }, { timeout: 8000 }).catch(() => {});
      setSource(SOURCE_WATCH);
      back();
    },

    select(device) {
      const fromWatch = isWatchSource();
      if (fromWatch) {
        getLocal().stop();
        setSource(SOURCE_SPOTIFY);
      }
      if (device.active && !fromWatch) {
        back();
        return;
      }
      setText(this.status, "Переключаю…");
      this.request({ method: "transfer", params: { id: device.id } }, { timeout: 10000 })
        .then(() => back())
        .catch((e) => setText(this.status, formatError(e)));
    },
  })
);
