import { BasePage } from "@zeppos/zml/base-page";
import { createWidget, widget, prop } from "@zos/ui";
import { px } from "@zos/utils";
import { back } from "@zos/router";
import { scrollTo } from "@zos/page";
import { onKey, offKey, KEY_UP, KEY_DOWN, KEY_SELECT, KEY_EVENT_CLICK, KEY_EVENT_LONG_PRESS } from "@zos/interaction";
import { W, GRAY, GREEN, MINT, DARK, text, setText, listButton, title, formatError, onTap } from "../../shared/ui";
import { getLocal, isWatchSource } from "../../shared/local";
import { t } from "../../shared/i18n";

// Current playlist: what is playing now and what comes next.
// In "music from the watch" mode: the whole watch library in the configured order.
// Keys: Up/Down move the focus frame, Select or holding Down plays the focused row.

const ROW_H = 96;
const TOP = 110;
const FOCUS_LINE = 3;
const SCROLL_ANIM_MS = 200;

Page(
  BasePage({
    build() {
      createWidget(widget.FILL_RECT, { x: 0, y: 0, w: px(W), h: px(W), color: DARK });
      this.rows = [];
      this.focus = 0;
      this.bindKeys();
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
      this.createFocusFrame();
      this.setFocus(0, false);
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
      this.createFocusFrame();
      this.setFocus(Math.max(local.index, 0), false);
    },

    row(y, item, onClick, opts = {}) {
      this.rows.push({ y, onClick });
      listButton(y, "", onClick, { h: ROW_H - 12, color: opts.current ? 0x1a5c36 : undefined });
      // Labels sit on top of the button, so they forward taps too
      const name = text(90, y + 6, W - 180, 40, item.name, { size: 26, color: opts.current ? GREEN : 0xffffff });
      onTap(name, onClick);
      if (item.sub) {
        const sub = text(90, y + 42, W - 180, 34, item.sub, { size: 20, color: GRAY });
        onTap(sub, onClick);
      }
    },

    // --- keys ---

    bindKeys() {
      onKey({
        callback: (key, keyEvent) => {
          if (key === KEY_UP || key === KEY_DOWN) {
            if (keyEvent === KEY_EVENT_CLICK) this.setFocus(this.focus + (key === KEY_UP ? -1 : 1), true);
            else if (key === KEY_DOWN && keyEvent === KEY_EVENT_LONG_PRESS) this.activate();
            return true;
          }
          if (key === KEY_SELECT && keyEvent === KEY_EVENT_CLICK) {
            this.activate();
            return true;
          }
          return false;
        },
      });
    },

    // Outline drawn over the focused row (created after the rows so it is on top)
    createFocusFrame() {
      if (!this.rows.length) return;
      this.frame = createWidget(widget.STROKE_RECT, this.frameGeometry(this.rows[0].y));
      // The frame covers the focused row, so a tap on it is a tap on that row
      onTap(this.frame, () => this.activate());
    },

    frameGeometry(y) {
      return {
        x: px(60),
        y: px(y),
        w: px(W - 120),
        h: px(ROW_H - 12),
        radius: px(38),
        line_width: px(FOCUS_LINE),
        color: MINT,
      };
    },

    setFocus(index, animate) {
      if (!this.frame) return;
      this.focus = Math.max(0, Math.min(this.rows.length - 1, index));
      const rowY = this.rows[this.focus].y;
      this.frame.setProperty(prop.MORE, this.frameGeometry(rowY));
      // Keep the focused row in the middle of the screen
      const y = -px(Math.max(0, rowY + (ROW_H - 12) / 2 - W / 2));
      scrollTo(animate ? { y, animConfig: { anim_rate: "easeout", anim_duration: SCROLL_ANIM_MS } } : { y });
    },

    activate() {
      const row = this.rows[this.focus];
      if (row) row.onClick();
    },

    onDestroy() {
      try {
        offKey();
      } catch (e) {}
    },

    play(params) {
      setText(this.status, "");
      this.request({ method: "play_context", params }, { timeout: 10000 })
        .then(() => back())
        .catch((e) => setText(this.status, formatError(e)));
    },
  })
);
