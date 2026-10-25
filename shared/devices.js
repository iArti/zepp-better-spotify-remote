// Spotify Connect device.type -> icon; anything else keeps the generic one.
// variant: "" = green 64 px, "_s" = gray 36 px (lists), "_m" / "_mg" = gray / green 64 px (cards).
const DEVICE_ICONS = {
  Computer: "dev_computer",
  Smartphone: "dev_phone",
  Tablet: "dev_tablet",
  Speaker: "dev_speaker",
  CastAudio: "dev_speaker",
  AudioDongle: "dev_speaker",
  AVR: "dev_speaker",
  TV: "dev_tv",
  CastVideo: "dev_tv",
  STB: "dev_tv",
  Automobile: "dev_car",
  Watch: "dev_watch", // "Music from the watch" mode
};

export function deviceIcon(device, variant = "") {
  const name = (device && DEVICE_ICONS[device.type]) || "devices";
  return name + variant + ".png";
}
