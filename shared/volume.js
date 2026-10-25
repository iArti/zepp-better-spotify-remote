import { getLocal, isWatchSource } from "./local";
import { t } from "./i18n";

const SEND_DELAY_MS = 350;
export const VOLUME_STEP = 5;

function globalData() {
  const app = getApp();
  return app.globalData || (app._options && app._options.globalData);
}

// Optional SimpleZepp state, filled by the devices page:
// { available, paired, pairing, volume (phone media volume %, or null) }
export function getBridge() {
  const g = globalData();
  if (!g.bridge) g.bridge = { available: false, paired: false, pairing: false, volume: null };
  return g.bridge;
}

// Spotify plays on this phone and can't change its volume: SimpleZepp can
export function wantsBridge() {
  if (isWatchSource()) return false;
  const s = globalData().state;
  const d = s && s.device;
  return !!(d && d.type === "Smartphone" && d.supportsVolume === false);
}

export function usesBridge() {
  return wantsBridge() && getBridge().paired;
}

// Volume of the current source: the watch player, the phone through SimpleZepp,
// or the active Spotify device (Spotify can't change the volume of phones)
export function createVolume(page, onUpdate) {
  const watch = isWatchSource();
  const viaBridge = usesBridge();
  const bridgeState = getBridge();
  const s = globalData().state;
  const device = s && s.device;

  let supported;
  let value;
  if (watch) {
    supported = true;
    value = getLocal().getVolume();
  } else if (viaBridge) {
    supported = typeof bridgeState.volume === "number";
    value = supported ? bridgeState.volume : 0;
  } else {
    supported = !!(device && device.supportsVolume !== false && typeof device.volume === "number");
    value = supported ? device.volume : 0;
  }
  let timer = null;

  function send() {
    timer = null;
    const percent = value;
    const method = viaBridge ? "bridge_volume_set" : "volume";
    page
      .request({ method, params: { percent } }, { timeout: 9000 })
      .then(() => {
        if (viaBridge) bridgeState.volume = percent;
        else {
          const st = globalData().state;
          if (st && st.device) st.device.volume = percent;
        }
      })
      .catch((e) => onUpdate && onUpdate(value, e));
  }

  return {
    get supported() {
      return supported;
    },
    viaBridge,
    name: watch ? t("watch") : device ? device.name + (viaBridge ? " · SimpleZepp" : "") : "",
    get value() {
      return value;
    },
    // Phone volume arrives later (asked through SimpleZepp)
    setKnown(v) {
      supported = true;
      value = v;
      if (onUpdate) onUpdate(value, null);
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
