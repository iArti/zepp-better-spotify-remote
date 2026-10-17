"""Extract album covers from a music folder into the app ("music from the watch").

Usage: python -I tools/import_covers.py <music folder> [--size 240]

For every MP3 it reads the ID3 tags the same way the watch does (shared/id3.js,
shared/text.js), extracts the embedded cover with ffmpeg, scales it to a square
8-bit RGBA PNG and writes:
  assets/common.r/covers/<key>.png
  assets/common.r/covers/index.json   {"albums": {key: file}, "tracks": {key: file}}
Keys are FNV-1a hashes of "artist|album" (or "artist|title" without an album).
Rebuild the app afterwards. The covers folder is gitignored.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "common.r", "covers")
AUDIO_EXT = (".mp3",)
HEAD_BYTES = 64 * 1024

FRAMES = {
    "TIT2": "title", "TT2": "title",
    "TPE1": "artist", "TP1": "artist",
    "TALB": "album", "TAL": "album",
}


# --- must match shared/text.js ---

def decode_single_byte(b):
    high = sum(1 for x in b if x >= 0xC0)
    cyrillic = high >= 3 or (high > 0 and high * 3 >= len(b))
    out = []
    for x in b:
        if cyrillic and x >= 0xC0:
            out.append(chr(0x410 + x - 0xC0))
        elif cyrillic and x == 0xA8:
            out.append("Ё")
        elif cyrillic and x == 0xB8:
            out.append("ё")
        else:
            out.append(chr(x))
    return "".join(out)


def normalize(s):
    return re.sub(r"\s+", " ", (s or "").lower().replace("ё", "е")).strip()


def hash_key(s):
    h = 0x811C9DC5
    for ch in s:
        h ^= ord(ch)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return "%08x" % h


def album_key(artist, album):
    return hash_key(normalize(artist) + "|" + normalize(album))


def track_key(artist, title):
    return hash_key(normalize(artist) + "|" + normalize(title))


# --- must match shared/id3.js ---

def syncsafe(b, i):
    return ((b[i] & 0x7F) << 21) | ((b[i + 1] & 0x7F) << 14) | ((b[i + 2] & 0x7F) << 7) | (b[i + 3] & 0x7F)


def be(b, i, n):
    return int.from_bytes(b[i:i + n], "big")


def decode_text(data):
    if not data:
        return ""
    enc, body = data[0], data[1:]
    if enc == 1:
        big = body[:2] == b"\xfe\xff"
        if body[:2] in (b"\xff\xfe", b"\xfe\xff"):
            body = body[2:]
        s = body[: len(body) // 2 * 2].decode("utf-16-be" if big else "utf-16-le", "replace")
    elif enc == 2:
        s = body[: len(body) // 2 * 2].decode("utf-16-be", "replace")
    elif enc == 3:
        s = body.decode("utf-8", "replace")
    else:
        s = decode_single_byte(body)
    return ", ".join(p for p in s.split("\x00") if p.strip()).strip()


def parse_v2(b):
    ver, flags = b[3], b[5]
    end = min(len(b), 10 + syncsafe(b, 6))
    pos = 10
    if flags & 0x40:
        pos += syncsafe(b, pos) if ver == 4 else 4 + be(b, pos, 4)
    id_len, hdr_len = (3, 6) if ver == 2 else (4, 10)
    tags = {}
    while pos + hdr_len <= end:
        if b[pos] == 0:
            break
        fid = b[pos:pos + id_len].decode("latin-1")
        size = be(b, pos + 3, 3) if ver == 2 else syncsafe(b, pos + 4) if ver == 4 else be(b, pos + 4, 4)
        if size <= 0:
            break
        key = FRAMES.get(fid)
        if key and key not in tags and pos + hdr_len + size <= len(b):
            tags[key] = decode_text(b[pos + hdr_len:pos + hdr_len + size])
        pos += hdr_len + size
    return tags


def parse_v1(b):
    if len(b) < 128 or b[:3] != b"TAG":
        return {}
    def field(start, n):
        return decode_single_byte(b[start:start + n].split(b"\x00")[0]).strip()
    return {"title": field(3, 30), "artist": field(33, 30), "album": field(63, 30)}


def read_tags(path):
    size = os.path.getsize(path)
    with open(path, "rb") as f:
        head = f.read(min(HEAD_BYTES, size))
        tags = parse_v2(head) if head[:3] == b"ID3" and len(head) >= 10 else {}
        if (not tags.get("title") or not tags.get("artist")) and size > 128:
            f.seek(size - 128)
            v1 = parse_v1(f.read(128))
            tags = {**{k: v for k, v in v1.items() if v}, **tags}
    title = tags.get("title") or os.path.splitext(os.path.basename(path))[0]
    return title, tags.get("artist", ""), tags.get("album", "")


# --- covers ---

def extract_cover(src, dst, size):
    vf = f"scale={size}:{size}:force_original_aspect_ratio=increase,crop={size}:{size}"
    cmd = ["ffmpeg", "-v", "error", "-y", "-i", src, "-map", "0:v:0", "-frames:v", "1",
           "-vf", vf, "-pix_fmt", "rgba", dst]
    return subprocess.run(cmd, capture_output=True).returncode == 0 and os.path.exists(dst)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("music_dir")
    ap.add_argument("--size", type=int, default=240, help="cover side in px (default 240)")
    args = ap.parse_args()

    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg not found on PATH")

    files = []
    for root, _, names in os.walk(args.music_dir):
        files += [os.path.join(root, n) for n in names if n.lower().endswith(AUDIO_EXT)]
    if not files:
        sys.exit("no MP3 files in " + args.music_dir)

    shutil.rmtree(OUT, ignore_errors=True)
    os.makedirs(OUT)
    index = {"albums": {}, "tracks": {}}
    tried_albums = set()
    no_cover = 0

    for i, path in enumerate(sorted(files), 1):
        title, artist, album = read_tags(path)
        if album:
            key, bucket = album_key(artist, album), "albums"
            if key in tried_albums:
                continue  # one cover per album
            tried_albums.add(key)
        else:
            key, bucket = track_key(artist, title), "tracks"
        name = key + ".png"
        if extract_cover(path, os.path.join(OUT, name), args.size):
            index[bucket][key] = name
        else:
            no_cover += 1
        print(f"[{i}/{len(files)}] {artist} - {album or title}", flush=True)

    with open(os.path.join(OUT, "index.json"), "w", encoding="ascii") as f:
        json.dump(index, f, separators=(",", ":"))

    total = sum(os.path.getsize(os.path.join(OUT, n)) for n in os.listdir(OUT))
    count = len(index["albums"]) + len(index["tracks"])
    print(f"\n{count} covers ({total // 1024} KB PNG), {no_cover} without a cover -> {os.path.normpath(OUT)}")
    print("Rebuild the app (zeus preview) to put them on the watch.")


if __name__ == "__main__":
    main()
