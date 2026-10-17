import { getLocal, isWatchSource } from "./local";

const SEND_DELAY_MS = 350;
export const VOLUME_STEP = 10;

// Volume of the current source: the watch player or the active Spotify device.
// Spotify can't change the volume of phones (supports_volume = false).
export function createVolume(page, onUpdate) {
  const watch = isWatchSource();
  const s = getApp().globalData.state;
  const device = s && s.device;
  const supported = watch || !!(device && device.supportsVolume !== false && typeof device.volume === "number");
  let value = watch ? getLocal().getVolume() : supported ? device.volume : 0;
  let timer = null;

  function send() {
    timer = null;
    const percent = value;
    page
      .request({ method: "volume", params: { percent } }, { timeout: 8000 })
      .then(() => {
        const st = getApp().globalData.state;
        if (st && st.device) st.device.volume = percent;
      })
      .catch((e) => onUpdate && onUpdate(value, e));
  }

  return {
    supported,
    name: watch ? "Часы" : device ? device.name : "",
    get value() {
      return value;
    },
    change(delta) {
      if (!supported) return false;
      value = Math.max(0, Math.min(100, value + delta));
      if (watch) getLocal().setVolume(value);
      else {
        // Debounce: send only the final value after taps stop
        if (timer) clearTimeout(timer);
        timer = setTimeout(send, SEND_DELAY_MS);
      }
      if (onUpdate) onUpdate(value, null);
      return true;
    },
    flush() {
      if (timer) {
        clearTimeout(timer);
        send();
      }
    },
  };
}
