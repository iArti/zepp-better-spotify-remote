import { BasePage } from "@zeppos/zml/base-page";
import { createWidget, widget, prop } from "@zos/ui";
import { px } from "@zos/utils";
import { W, GREEN, GRAY, DARK, text, setText, iconButton, title, formatError } from "../../shared/ui";

const STEP = 10;
const SEND_DELAY_MS = 350;

Page(
  BasePage({
    state: {
      volume: 50,
      sendTimer: null,
    },

    build() {
      const s = getApp().globalData.state;
      const device = s && s.device;
      if (device && typeof device.volume === "number") this.state.volume = device.volume;

      createWidget(widget.FILL_RECT, { x: 0, y: 0, w: px(W), h: px(W), color: DARK });
      title("Громкость");
      this.deviceText = text(80, 92, W - 160, 34, device ? device.name : "", { size: 24, color: GRAY });

      // Ring: background + value arc
      // 0° is 3 o'clock, clockwise; 270° ring with the gap at the bottom
      this.arcOpts = { x: px(110), y: px(130), w: px(260), h: px(260), line_width: px(16), start_angle: 135 };
      createWidget(widget.ARC, { ...this.arcOpts, end_angle: 405, color: 0x333333 });
      this.arc = createWidget(widget.ARC, { ...this.arcOpts, end_angle: 135, color: GREEN });

      this.valueText = text(160, 225, 160, 70, "", { size: 56 });

      iconButton(110, 410, 96, 72, "minus.png", () => this.change(-STEP));
      iconButton(370, 410, 96, 72, "plus.png", () => this.change(STEP));

      this.render();
    },

    render() {
      const v = this.state.volume;
      setText(this.valueText, String(v));
      this.arc.setProperty(prop.MORE, { ...this.arcOpts, color: GREEN, end_angle: 135 + Math.round((270 * v) / 100) });
    },

    change(delta) {
      this.state.volume = Math.max(0, Math.min(100, this.state.volume + delta));
      this.render();

      // Debounce: send only the final value after taps stop
      if (this.state.sendTimer) clearTimeout(this.state.sendTimer);
      this.state.sendTimer = setTimeout(() => this.send(), SEND_DELAY_MS);
    },

    send() {
      const percent = this.state.volume;
      this.request({ method: "volume", params: { percent } }, { timeout: 8000 })
        .then(() => {
          const s = getApp().globalData.state;
          if (s && s.device) s.device.volume = percent;
        })
        .catch((e) => setText(this.deviceText, formatError(e)));
    },

    onDestroy() {
      if (this.state.sendTimer) {
        clearTimeout(this.state.sendTimer);
        this.send();
      }
    },
  })
);
