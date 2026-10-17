import { openSync, readSync, closeSync, statSync, O_RDONLY } from "@zos/fs";
import { decodeUtf8, decodeUtf16, decodeSingleByte } from "./text";

// Reads title / artist / album / track number from an MP3 on the watch.
// Only the head of the tag is read: text frames normally come before the cover.
const HEAD_BYTES = 64 * 1024;

const FRAMES = {
  TIT2: "title",
  TT2: "title",
  TPE1: "artist",
  TP1: "artist",
  TALB: "album",
  TAL: "album",
  TPE2: "albumArtist",
  TP2: "albumArtist",
  TRCK: "track",
  TRK: "track",
};

function read(fd, length, position) {
  const buf = new ArrayBuffer(length);
  const n = readSync({ fd, buffer: buf, options: { length, position } });
  return new Uint8Array(buf, 0, Math.max(0, n || 0));
}

function syncsafe(b, i) {
  return ((b[i] & 0x7f) << 21) | ((b[i + 1] & 0x7f) << 14) | ((b[i + 2] & 0x7f) << 7) | (b[i + 3] & 0x7f);
}

function be(b, i, n) {
  let v = 0;
  for (let k = 0; k < n; k++) v = v * 256 + b[i + k];
  return v;
}

function decodeText(data) {
  if (!data.length) return "";
  const enc = data[0];
  let body = data.subarray(1);
  let s;
  if (enc === 1) {
    // UTF-16 with BOM
    const bigEndian = body[0] === 0xfe && body[1] === 0xff;
    if ((body[0] === 0xff && body[1] === 0xfe) || bigEndian) body = body.subarray(2);
    s = decodeUtf16(body, bigEndian);
  } else if (enc === 2) s = decodeUtf16(body, true);
  else if (enc === 3) s = decodeUtf8(body);
  else s = decodeSingleByte(body);
  // v2.4 separates multiple values with NUL
  return s
    .split("\u0000")
    .filter((p) => p.trim())
    .join(", ")
    .trim();
}

function parseV2(b) {
  const ver = b[3];
  const flags = b[5];
  const end = Math.min(b.length, 10 + syncsafe(b, 6));
  let pos = 10;
  if (flags & 0x40) pos += ver === 4 ? syncsafe(b, pos) : 4 + be(b, pos, 4);

  const idLen = ver === 2 ? 3 : 4;
  const hdrLen = ver === 2 ? 6 : 10;
  const tags = {};
  while (pos + hdrLen <= end) {
    if (b[pos] === 0) break; // padding
    let id = "";
    for (let k = 0; k < idLen; k++) id += String.fromCharCode(b[pos + k]);
    const size = ver === 2 ? be(b, pos + 3, 3) : ver === 4 ? syncsafe(b, pos + 4) : be(b, pos + 4, 4);
    if (size <= 0) break;
    const key = FRAMES[id];
    if (key && !tags[key] && pos + hdrLen + size <= b.length) {
      tags[key] = decodeText(b.subarray(pos + hdrLen, pos + hdrLen + size));
    }
    pos += hdrLen + size;
  }
  return tags;
}

function parseV1(b) {
  if (b.length < 128 || b[0] !== 0x54 || b[1] !== 0x41 || b[2] !== 0x47) return {}; // "TAG"
  const field = (from, len) => {
    let end = from;
    while (end < from + len && b[end] !== 0) end++;
    return decodeSingleByte(b.subarray(from, end)).trim();
  };
  return { title: field(3, 30), artist: field(33, 30), album: field(63, 30) };
}

// relPath is relative to the app data dir (same form readdirSync accepts)
export function readTags(relPath) {
  let fd = -1;
  const result = { size: 0 };
  try {
    const st = statSync({ path: relPath });
    result.size = (st && st.size) || 0;
    fd = openSync({ path: relPath, flag: O_RDONLY });
    if (fd < 0) return result;

    const head = read(fd, Math.min(HEAD_BYTES, result.size || HEAD_BYTES), 0);
    let tags = {};
    if (head.length >= 10 && head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) tags = parseV2(head); // "ID3"
    if ((!tags.title || !tags.artist) && result.size > 128) {
      const v1 = parseV1(read(fd, 128, result.size - 128));
      tags = { ...v1, ...tags };
    }
    Object.assign(result, tags);
    if (result.track) result.track = parseInt(result.track, 10) || 0;
  } catch (e) {
    console.log("readTags failed", relPath, e);
  } finally {
    if (fd >= 0) {
      try {
        closeSync({ fd });
      } catch (e) {}
    }
  }
  return result;
}
