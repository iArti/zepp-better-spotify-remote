// Spotify Connect device.type -> icon; anything else keeps the generic one.
// small = gray 36 px variant for lists, otherwise the green 64 px one.
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

export function deviceIcon(device, small = false) {
  const name = (device && DEVICE_ICONS[device.type]) || "devices";
  return name + (small ? "_s" : "") + ".png";
}
