import { BasePage } from "@zeppos/zml/base-page";
import { createWidget, deleteWidget, widget, prop, align } from "@zos/ui";
import { px } from "@zos/utils";
import { back } from "@zos/router";
import { getScrollTop } from "@zos/page";
import { localStorage } from "@zos/storage";
import { onGesture, offGesture, GESTURE_DOWN } from "@zos/interaction";
import { W, GRAY, DARK, text, setText, iconButton, formatError, onTap, ignorePalm } from "../../shared/ui";
import { getThumbs } from "../../shared/thumbs";
import { t } from "../../shared/i18n";
import { getLocal, isWatchSource, setSource, SOURCE_SPOTIFY } from "../../shared/local";

const TOP = 100;
const ROW_H = 124;
const THUMB = 96;

Page(
  BasePage({
    state: {
      rows: [], // widgets of the recent items, rebuilt on refresh
      thumbs: {}, // id -> IMG widget
    },

    build() {
      ignorePalm();
      createWidget(widget.FILL_RECT, { x: 0, y: 0, w: px(W), h: px(W), color: DARK });
      iconButton(240, 44, 96, 48, "home.png", () => back());

      this.row(TOP, t("likedSongs"), "liked.png", () => this.play("play_liked", {}));

      this.status = text(60, TOP + ROW_H + 20, W - 120, 60, "", { size: 24, color: GRAY, wrap: true });

      // Render the cached list right away, then refresh from Spotify
      let cached = [];
      try {
        cached = JSON.parse(localStorage.getItem("recent", "[]")) || [];
      } catch (e) {}
      if (cached.length) this.renderItems(cached);
      else setText(this.status, t("loading"));

      getApp().globalData.onThumb = (id, path) => {
        const img = this.state.thumbs[id];
        if (img) img.setProperty(prop.SRC, path);
      };

      this.request({ method: "recent", params: { haveThumbs: Object.keys(getThumbs()) } }, { timeout: 20000 })
        .then(({ result }) => {
          localStorage.setItem("recent", JSON.stringify(result));
          this.renderItems(result);
        })
        .catch((e) => {
          if (!cached.length) setText(this.status, formatError(e));
        });

      // Swipe down at the top of the list returns to the player
      onGesture({
        callback: (gesture) => {
          if (gesture !== GESTURE_DOWN || getScrollTop() > 0) return false;
          back();
          return true;
        },
      });
    },

    renderItems(items) {
      this.state.rows.forEach((w) => deleteWidget(w));
      this.state.rows = [];
      this.state.thumbs = {};
      setText(this.status, items.length ? "" : t("noRecent"));

      const thumbs = getThumbs();
      items.forEach((item, i) => {
        const widgets = this.row(
          TOP + (i + 1) * ROW_H,
          item.name,
          thumbs[item.id] || "thumb_empty.png",
          () => this.play("play_context", { contextUri: item.uri })
        );
        this.state.thumbs[item.id] = widgets[0];
        this.state.rows.push(...widgets);
      });
      // Spacer so the last row can scroll up from the round bottom edge
      this.state.rows.push(text(0, TOP + (items.length + 1) * ROW_H, W, 140, ""));
    },

    row(y, name, src, onClick) {
      const img = createWidget(widget.IMG, {
        x: px(46),
        y: px(y),
        w: px(THUMB),
        h: px(THUMB),
        auto_scale: true,
        src,
      });
      const label = text(162, y, W - 162 - 40, THUMB, name, { size: 32, alignH: align.LEFT });
      onTap(img, onClick);
      onTap(label, onClick);
      return [img, label];
    },

    play(method, params) {
      setText(this.status, "");
      // Starting something on Spotify leaves "music from the watch" mode
      if (isWatchSource()) {
        getLocal().stop();
        setSource(SOURCE_SPOTIFY);
      }
      this.request({ method, params }, { timeout: 10000 })
        .then(() => back())
        .catch((e) => setText(this.status, formatError(e)));
    },

    onDestroy() {
      getApp().globalData.onThumb = null;
      try {
        offGesture();
      } catch (e) {}
    },
  })
);
