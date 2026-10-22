import { createWidget, widget, align, text_style, event, prop } from "@zos/ui";
import { px } from "@zos/utils";

export const W = 480; // design width; px() scales to the real screen
export const GREEN = 0x1ed760;
export const GRAY = 0xb3b3b3;
export const MINT = 0x7fe0b0;
export const DARK = 0x121212;
export const ROW = 0x282828;

export function text(x, y, w, h, value, opts = {}) {
  return createWidget(widget.TEXT, {
    x: px(x),
    y: px(y),
    w: px(w),
    h: px(h),
    text: value,
    text_size: px(opts.size || 28),
    color: opts.color ?? 0xffffff,
    align_h: opts.alignH ?? align.CENTER_H,
    align_v: align.CENTER_V,
    // NONE = marquee scrolling for long single-line text
    text_style: opts.wrap ? text_style.WRAP : opts.marquee ? text_style.NONE : text_style.ELLIPSIS,
  });
}

export function setText(w, value) {
  w.setProperty(prop.TEXT, value);
}

// Icon image centered in a larger tap area
export function iconButton(cx, cy, area, iconSize, src, onClick) {
  const img = createWidget(widget.IMG, {
    x: px(cx - area / 2),
    y: px(cy - area / 2),
    w: px(area),
    h: px(area),
    pos_x: px((area - iconSize) / 2),
    pos_y: px((area - iconSize) / 2),
    src,
  });
  if (onClick) img.addEventListener(event.CLICK_UP, onClick);
  return img;
}

export function listButton(y, label, onClick, opts = {}) {
  return createWidget(widget.BUTTON, {
    x: px(60),
    y: px(y),
    w: px(W - 120),
    h: px(opts.h || 76),
    radius: px(38),
    normal_color: opts.color ?? ROW,
    press_color: 0x3e3e3e,
    color: 0xffffff,
    text_size: px(26),
    text: label,
    click_func: onClick,
  });
}

export function title(value) {
  return text(80, 40, W - 160, 50, value, { size: 32 });
}

export function formatError(err) {
  const msg = String((err && (err.message || err)) || "");
  if (msg.includes("no_credentials")) return "Нет ключей Spotify (secrets.js)";
  if (msg.includes("auth_failed")) return "Ошибка входа в Spotify";
  if (msg.includes("NO_ACTIVE_DEVICE") || msg.includes("404")) return "Нет активного устройства";
  if (msg.includes("PREMIUM_REQUIRED") || msg.includes("403")) return "Нужен Spotify Premium";
  if (msg.includes("simplezepp_unpaired")) return "SimpleZepp: нужна повторная привязка";
  if (msg.includes("simplezepp")) return "SimpleZepp не отвечает";
  if (msg.toLowerCase().includes("timeout")) return "Нет связи с телефоном";
  return "Ошибка: " + msg.slice(0, 40);
}

export function formatTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return m + ":" + String(s % 60).padStart(2, "0");
}
