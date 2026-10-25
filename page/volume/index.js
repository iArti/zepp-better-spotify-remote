import { BasePage } from "@zeppos/zml/base-page";
import { createWidget, widget, prop } from "@zos/ui";
import { px } from "@zos/utils";
import { onKey, offKey, KEY_UP, KEY_DOWN, KEY_EVENT_CLICK } from "@zos/interaction";
import { W, GREEN, GRAY, DARK, text, setText, iconButton, title, formatError } from "../../shared/ui";
import { createVolume, getBridge, wantsBridge, VOLUME_STEP } from "../../shared/volume";
import { t } from "../../shared/i18n";

Page(
  BasePage({
    build() {
      this.volume = createVolume(this, (value, err) => {
        if (err) setText(this.deviceText, formatError(err));
        else this.render();
      });

      createWidget(widget.FILL_RECT, { x: 0, y: 0, w: px(W), h: px(W), color: DARK });
      title(t("volume"));
      this.deviceText = text(80, 92, W - 160, 34, this.volume.name, { size: 24, color: GRAY });

      // Ring: background + value arc
      // 0° is 3 o'clock, clockwise; 270° ring with the gap at the bottom
      this.arcOpts = { x: px(110), y: px(130), w: px(260), h: px(260), line_width: px(16), start_angle: 135 };
      createWidget(widget.ARC, { ...this.arcOpts, end_angle: 405, color: 0x333333 });
      this.arc = createWidget(widget.ARC, { ...this.arcOpts, end_angle: 135, color: GREEN });

      this.valueText = text(130, 225, 220, 70, "", { size: 56 });

      // Through SimpleZepp the phone volume may still be unknown: ask for it
      if (this.volume.viaBridge && !this.volume.supported) {
        this.request({ method: "bridge_volume" }, { timeout: 9000 })
          .then(({ result }) => {
            getBridge().volume = result;
            this.volume.setKnown(result);
          })
          .catch((e) => setText(this.deviceText, formatError(e)));
      }

      if (this.volume.supported || this.volume.viaBridge) {
        iconButton(110, 410, 96, 72, "minus.png", () => this.volume.change(-VOLUME_STEP));
        iconButton(370, 410, 96, 72, "plus.png", () => this.volume.change(VOLUME_STEP));
        onKey({
          callback: (key, keyEvent) => {
            if (key !== KEY_UP && key !== KEY_DOWN) return false;
            if (keyEvent === KEY_EVENT_CLICK) this.volume.change(key === KEY_UP ? VOLUME_STEP : -VOLUME_STEP);
            return true;
          },
        });
      } else {
        const hint =
          getBridge().available && wantsBridge()
            ? t("volumeConnectBridge")
            : t("volumeUnsupported");
        text(70, 330, W - 140, 90, hint, { size: 24, color: GRAY, wrap: true });
      }

      this.render();
    },

    render() {
      if (!this.volume.supported) {
        setText(this.valueText, this.volume.viaBridge ? "…" : "—");
        return;
      }
      const v = this.volume.value;
      setText(this.valueText, String(v));
      this.arc.setProperty(prop.MORE, { ...this.arcOpts, color: GREEN, end_angle: 135 + Math.round((270 * v) / 100) });
    },

    onDestroy() {
      this.volume.flush();
      try {
        offKey();
      } catch (e) {}
    },
  })
);
