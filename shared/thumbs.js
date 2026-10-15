import { localStorage } from "@zos/storage";

// Playlist/album thumbnails received from the phone: { id: filePath }
export function getThumbs() {
  try {
    return JSON.parse(localStorage.getItem("thumbs", "{}")) || {};
  } catch (e) {
    return {};
  }
}
