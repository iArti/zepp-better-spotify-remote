import { BasePage } from "@zeppos/zml/base-page";
import { createWidget, widget, prop } from "@zos/ui";
import { px } from "@zos/utils";
import { back, push } from "@zos/router";
import { onKey, offKey, KEY_UP, KEY_DOWN, KEY_EVENT_CLICK } from "@zos/interaction";
import { W, GRAY, DARK, text, setText, listButton, title, formatError } from "../../shared/ui";
import { getLocal, isWatchSource, setSource, SOURCE_SPOTIFY, SOURCE_WATCH } from "../../shared/local";
import { createVolume, VOLUME_STEP } from "../../shared/volume";

const ROW = 88;
const Y_VOLUME = 110;
const Y_WATCH = Y_VOLUME + ROW;
const Y_DEVICES = Y_WATCH + ROW;
const ACTIVE_COLOR = 0x1a5c36;

Page(
  BasePage({
    build() {
      const watch = isWatchSource();
      createWidget(widget.FILL_RECT, { x: 0, y: 0, w: px(W), h: px(W), color: DARK });
      title("Устройства");

      // Volume of the current source (Spotify device or the watch player); Up/Down change it
      this.volumeBtn = listButton(Y_VOLUME, "", () => push({ url: "page/volume/index" }), { color: 0x333333 });
      this.initVolume();

      // Shown right away: works without the phone
      listButton(Y_WATCH, (watch ? "● " : "") + "Музыка с часов", () => this.selectWatch(), {
        color: watch ? ACTIVE_COLOR : undefined,
      });

      this.status = text(60, Y_DEVICES + 10, W - 120, 80, "Загрузка…", { size: 26, color: GRAY, wrap: true });
      this.request({ method: "devices" }, { timeout: 10000 })
        .then(({ result }) => this.renderList(result))
        .catch((e) => setText(this.status, formatError(e)));
    },

    initVolume() {
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
      const label = this.volume.supported ? `Громкость ${this.volume.value}%` : "Громкость: недоступно";
      this.volumeBtn.setProperty(prop.MORE, { x: px(60), y: px(Y_VOLUME), w: px(W - 120), h: px(76), text: label });
    },

    // The volume page replaces the key listener and may change the volume
    onResume() {
      this.volume.flush();
      this.initVolume();
    },

    onDestroy() {
      this.volume.flush();
      try {
        offKey();
      } catch (e) {}
    },

    renderList(devices) {
      if (!devices.length) {
        setText(this.status, "Нет устройств Spotify. Откройте Spotify на телефоне или ПК.");
        return;
      }
      setText(this.status, "");

      const watch = isWatchSource();
      devices.forEach((d, i) => {
        const active = d.active && !watch;
        listButton(Y_DEVICES + i * ROW, (active ? "● " : "") + d.name, () => this.select(d), {
          color: active ? ACTIVE_COLOR : undefined,
        });
      });
      // Spacer so the last row can scroll above the bottom edge
      text(0, Y_DEVICES + devices.length * ROW, W, 120, "");
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
