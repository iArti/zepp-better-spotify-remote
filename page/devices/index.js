import { BasePage } from "@zeppos/zml/base-page";
import { createWidget, widget } from "@zos/ui";
import { px } from "@zos/utils";
import { back, push } from "@zos/router";
import { W, GREEN, GRAY, DARK, text, setText, listButton, title, formatError } from "../../shared/ui";

Page(
  BasePage({
    build() {
      createWidget(widget.FILL_RECT, { x: 0, y: 0, w: px(W), h: px(W), color: DARK });
      title("Устройства");
      this.status = text(60, 200, W - 120, 80, "Загрузка…", { size: 26, color: GRAY, wrap: true });

      this.request({ method: "devices" }, { timeout: 10000 })
        .then(({ result }) => this.renderList(result))
        .catch((e) => setText(this.status, formatError(e)));
    },

    renderList(devices) {
      if (!devices.length) {
        setText(this.status, "Нет доступных устройств. Откройте Spotify на телефоне или ПК.");
        return;
      }
      setText(this.status, "");

      // Volume of the active device lives here too
      const s = getApp().globalData.state;
      const vol = s && s.device && typeof s.device.volume === "number" ? ` ${s.device.volume}%` : "";
      listButton(110, "Громкость" + vol, () => push({ url: "page/volume/index" }), { color: 0x333333 });

      devices.forEach((d, i) => {
        listButton(198 + i * 88, (d.active ? "● " : "") + d.name, () => this.select(d), {
          color: d.active ? 0x1a5c36 : undefined,
        });
      });
      // Spacer so the last row can scroll above the bottom edge
      text(0, 198 + devices.length * 88, W, 120, "");
    },

    select(device) {
      if (device.active) {
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
