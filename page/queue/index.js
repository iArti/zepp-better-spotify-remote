import { BasePage } from "@zeppos/zml/base-page";
import { createWidget, widget } from "@zos/ui";
import { px } from "@zos/utils";
import { back } from "@zos/router";
import { scrollTo } from "@zos/page";
import { W, GRAY, GREEN, DARK, text, setText, listButton, title, formatError, onTap } from "../../shared/ui";
import { getLocal, isWatchSource } from "../../shared/local";
import { t } from "../../shared/i18n";

// Current playlist: what is playing now and what comes next.
// In "music from the watch" mode: the whole watch library in the configured order.

const ROW_H = 96;
const TOP = 110;

Page(
  BasePage({
    build() {
      createWidget(widget.FILL_RECT, { x: 0, y: 0, w: px(W), h: px(W), color: DARK });
      if (isWatchSource()) {
        this.buildWatchList();
        return;
      }
      title(t("currentPlaylist"));
      this.status = text(60, 200, W - 120, 80, t("loading"), { size: 26, color: GRAY, wrap: true });

      this.request({ method: "queue" }, { timeout: 15000 })
        .then(({ result }) => this.renderQueue(result))
        .catch((e) => setText(this.status, formatError(e)));
    },

    renderQueue({ current, next }) {
      const s = getApp().globalData.state;
      const contextUri = s && s.contextUri;

      if (!current && !next.length) {
        setText(this.status, t("queueEmpty"));
        return;
      }
      setText(this.status, "");

      let y = TOP;
      if (current) {
        this.row(y, current, () => back(), { current: true });
        y += ROW_H;
      }
      next.forEach((item, i) => {
        // Inside a playlist/album jump to the track in that context; otherwise play the rest of the queue
        const target = contextUri
          ? { contextUri, offsetUri: item.uri }
          : { uris: next.slice(i).map((t) => t.uri) };
        this.row(y, item, () => this.play(target));
        y += ROW_H;
      });
      text(0, y, W, 120, "");
    },

    buildWatchList() {
      const local = getLocal();
      title(t("watchMusic"));
      if (!local.tracks.length) {
        text(60, 200, W - 120, 80, local.scanning ? t("readingTags") : t("noMusicOnWatch"), {
          size: 26,
          color: GRAY,
          wrap: true,
        });
        return;
      }

      local.tracks.forEach((t, i) => {
        const item = { name: t.title, sub: [t.artist, t.album].filter(Boolean).join(" · ") };
        this.row(TOP + i * ROW_H, item, () => {
          local.playIndex(i);
          back();
        }, { current: i === local.index });
      });
      text(0, TOP + local.tracks.length * ROW_H, W, 120, "");

      // Start with the current track in view
      if (local.index > 1) scrollTo({ y: -px(TOP + (local.index - 1) * ROW_H) });
    },

    row(y, item, onClick, opts = {}) {
      listButton(y, "", onClick, { h: ROW_H - 12, color: opts.current ? 0x1a5c36 : undefined });
      // Labels sit on top of the button, so they forward taps too
      const name = text(90, y + 6, W - 180, 40, item.name, { size: 26, color: opts.current ? GREEN : 0xffffff });
      onTap(name, onClick);
      if (item.sub) {
        const sub = text(90, y + 42, W - 180, 34, item.sub, { size: 20, color: GRAY });
        onTap(sub, onClick);
      }
    },

    play(params) {
      setText(this.status, "");
      this.request({ method: "play_context", params }, { timeout: 10000 })
        .then(() => back())
        .catch((e) => setText(this.status, formatError(e)));
    },
  })
);
