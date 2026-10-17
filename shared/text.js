// Text helpers for local music: byte decoders, cover keys and sorting.
// coverKey() must match tools/import_covers.py exactly.

export function decodeUtf8(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i];
    let cp;
    if (b < 0x80) {
      cp = b;
      i += 1;
    } else if (b >= 0xc0 && b < 0xe0) {
      cp = ((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f);
      i += 2;
    } else if (b >= 0xe0 && b < 0xf0) {
      cp = ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f);
      i += 3;
    } else if (b >= 0xf0) {
      cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
      i += 4;
    } else {
      cp = 0xfffd;
      i += 1;
    }
    out += String.fromCodePoint(cp);
  }
  return out;
}

export function decodeUtf16(bytes, bigEndian) {
  let out = "";
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const code = bigEndian ? (bytes[i] << 8) | bytes[i + 1] : bytes[i] | (bytes[i + 1] << 8);
    out += String.fromCharCode(code);
  }
  return out;
}

// ID3 "ISO-8859-1" text is very often Windows-1251 in Russian files.
// Decode as 1251 when there are enough high letters to look like Cyrillic.
export function decodeSingleByte(bytes) {
  let high = 0;
  for (let i = 0; i < bytes.length; i++) if (bytes[i] >= 0xc0) high++;
  const cyrillic = high >= 3 || (high > 0 && high * 3 >= bytes.length);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (cyrillic && b >= 0xc0) out += String.fromCharCode(0x410 + (b - 0xc0));
    else if (cyrillic && b === 0xa8) out += "Ё";
    else if (cyrillic && b === 0xb8) out += "ё";
    else out += String.fromCharCode(b);
  }
  return out;
}

export function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

// FNV-1a over code points, as 8 hex digits
export function hashKey(s) {
  let h = 0x811c9dc5;
  for (const ch of s) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function albumKey(artist, album) {
  return hashKey(normalize(artist) + "|" + normalize(album));
}

export function trackKey(artist, title) {
  return hashKey(normalize(artist) + "|" + normalize(title));
}

// Regional (non-Latin) letters first, then Latin, then digits and symbols.
// Plain code point ranges: no \p{...}, the watch JS engine may lack Unicode tables.
function scriptRank(s) {
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if ((cp >= 0x61 && cp <= 0x7a) || (cp >= 0x41 && cp <= 0x5a)) return 1;
    if (cp >= 0x30 && cp <= 0x39) return 2;
    // Letters of other scripts (accented Latin counts as Latin)
    if (cp >= 0xc0 && cp <= 0x24f) return 1;
    if (cp >= 0x370 && !(cp >= 0x2000 && cp <= 0x2bff) && !(cp >= 0x3000 && cp <= 0x303f)) return 0;
  }
  return 3;
}

export function compareText(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  const ra = scriptRank(na);
  const rb = scriptRank(nb);
  if (ra !== rb) return ra - rb;
  return na < nb ? -1 : na > nb ? 1 : 0;
}
