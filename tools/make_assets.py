"""Generate icons and the cover vignette as PNGs without external deps.

Run: python tools/make_assets.py  (writes into assets/common.r)
Shapes are rasterized with 4x4 supersampling for antialiasing.
"""
import math
import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "common.r")
SS = 4  # supersampling factor


def write_png(path, w, h, rgba_rows):
    raw = b"".join(b"\x00" + bytes(row) for row in rgba_rows)

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


# --- shape primitives: each returns inside(x, y) for coords in 0..1 space ---

def poly(points):
    def inside(x, y):
        res = False
        j = len(points) - 1
        for i in range(len(points)):
            xi, yi = points[i]
            xj, yj = points[j]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                res = not res
            j = i
        return res
    return inside


def rect(x0, y0, x1, y1, r=0.0):
    def inside(x, y):
        if not (x0 <= x <= x1 and y0 <= y <= y1):
            return False
        cx = min(max(x, x0 + r), x1 - r)
        cy = min(max(y, y0 + r), y1 - r)
        return (x - cx) ** 2 + (y - cy) ** 2 <= r * r + 1e-9
    return inside


def circle(cx, cy, r):
    return lambda x, y: (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def ring(cx, cy, r0, r1, a0=None, a1=None):
    def inside(x, y):
        d = math.hypot(x - cx, y - cy)
        if not (r0 <= d <= r1):
            return False
        if a0 is None:
            return True
        a = math.degrees(math.atan2(y - cy, x - cx))
        return a0 <= a <= a1
    return inside


def union(*shapes):
    return lambda x, y: any(s(x, y) for s in shapes)


def minus(a, b):
    return lambda x, y: a(x, y) and not b(x, y)


def render_icon(name, size, shape, color=(255, 255, 255)):
    render_layers(name, size, [(shape, color)])


def render_layers(name, size, layers):
    """Later layers paint over earlier ones (per subsample)."""
    rows = []
    n = SS * SS
    for py in range(size):
        row = []
        for px in range(size):
            acc = [0, 0, 0]
            hits = 0
            for sy in range(SS):
                for sx in range(SS):
                    x = (px + (sx + 0.5) / SS) / size
                    y = (py + (sy + 0.5) / SS) / size
                    for shape, color in reversed(layers):
                        if shape(x, y):
                            c = color(x, y) if callable(color) else color
                            acc = [a + v for a, v in zip(acc, c)]
                            hits += 1
                            break
            if hits:
                row += [round(a / hits) for a in acc] + [round(255 * hits / n)]
            else:
                row += [0, 0, 0, 0]
        rows.append(row)
    write_png(os.path.join(OUT, name + ".png"), size, size, rows)


def render_alpha(name, size, alpha_fn):
    rows = []
    c = (size - 1) / 2
    for y in range(size):
        row = []
        for x in range(size):
            a = alpha_fn(math.hypot(x - c, y - c) / c, y / (size - 1))
            row += [0, 0, 0, round(255 * min(1.0, max(0.0, a)))]
        rows.append(row)
    write_png(os.path.join(OUT, name + ".png"), size, size, rows)


def smooth(t):
    t = min(max(t, 0.0), 1.0)
    return t * t * (3 - 2 * t)


def render_vignette(size):
    """Darkens the cover: base dim + radial edge falloff, the same on every side."""
    rows = []
    c = (size - 1) / 2
    for y in range(size):
        row = []
        for x in range(size):
            r = math.hypot(x - c, y - c) / c
            t = min(max((r - 0.35) / 0.65, 0.0), 1.0)
            edge = t * t * (3 - 2 * t)
            a = min(1.0, 0.30 + 0.65 * edge)
            row += [0, 0, 0, round(255 * a)]
        rows.append(row)
    write_png(os.path.join(OUT, "vignette.png"), size, size, rows)


def main():
    os.makedirs(OUT, exist_ok=True)

    play = poly([(0.26, 0.10), (0.26, 0.90), (0.90, 0.50)])
    pause = union(rect(0.22, 0.10, 0.40, 0.90, 0.06), rect(0.60, 0.10, 0.78, 0.90, 0.06))
    nxt = union(poly([(0.08, 0.10), (0.08, 0.90), (0.72, 0.50)]), rect(0.76, 0.10, 0.92, 0.90, 0.03))
    prev = lambda x, y: nxt(1 - x, y)
    plus = union(rect(0.44, 0.18, 0.56, 0.82, 0.03), rect(0.18, 0.44, 0.82, 0.56, 0.03))
    minus_ = rect(0.18, 0.44, 0.82, 0.56, 0.03)
    speaker = union(rect(0.10, 0.36, 0.30, 0.64, 0.02),
                    poly([(0.26, 0.36), (0.50, 0.14), (0.50, 0.86), (0.26, 0.64)]),
                    ring(0.50, 0.50, 0.14, 0.22, -45, 45),
                    ring(0.50, 0.50, 0.30, 0.38, -50, 50))
    # "Add to library": ring with a plus
    like_add = union(ring(0.5, 0.5, 0.42, 0.49),
                     rect(0.46, 0.27, 0.54, 0.73, 0.02), rect(0.27, 0.46, 0.73, 0.54, 0.02))
    check = poly([(0.24, 0.52), (0.32, 0.44), (0.44, 0.56), (0.70, 0.30), (0.78, 0.38), (0.44, 0.72)])
    # Queue / playlists: outlined pill on top, two lines below
    queue = union(minus(rect(0.10, 0.08, 0.90, 0.36, 0.14), rect(0.17, 0.15, 0.83, 0.29, 0.07)),
                  rect(0.10, 0.54, 0.90, 0.62, 0.02), rect(0.10, 0.80, 0.90, 0.88, 0.02))
    # Devices: phone outline + speaker with a wave
    devices = union(minus(rect(0.06, 0.34, 0.50, 0.96, 0.07), rect(0.13, 0.41, 0.43, 0.89, 0.03)),
                    circle(0.28, 0.79, 0.04),
                    minus(poly([(0.54, 0.22), (0.80, 0.04), (0.80, 0.50)]), poly([(0.61, 0.23), (0.74, 0.14), (0.74, 0.37)])),
                    rect(0.50, 0.17, 0.60, 0.33, 0.01),
                    ring(0.80, 0.27, 0.10, 0.16, -60, 60))

    render_icon("play", 88, play)
    render_icon("pause", 88, pause)
    render_icon("next", 84, nxt)
    render_icon("prev", 84, prev)
    render_icon("plus", 72, plus)
    render_icon("minus", 72, minus_)
    render_icon("volume", 44, speaker)
    render_icon("like_add", 64, like_add)
    render_layers("like_done", 64, [(circle(0.5, 0.5, 0.49), (30, 215, 96)), (check, (18, 18, 18))])
    render_icon("queue", 54, queue)
    render_icon("devices", 64, devices, (30, 215, 96))

    # Active device type icons (Spotify Connect device.type). Glyphs span the full
    # height of the box so they line up top and bottom with the like ring.
    green = (30, 215, 96)
    laptop = union(minus(rect(0.12, 0.02, 0.88, 0.74, 0.05), rect(0.20, 0.10, 0.80, 0.66)),
                   rect(0.0, 0.82, 1.0, 0.98, 0.03))
    phone = minus(minus(rect(0.24, 0.02, 0.76, 0.98, 0.10), rect(0.31, 0.11, 0.69, 0.80, 0.03)),
                  circle(0.50, 0.89, 0.04))
    tablet = minus(minus(rect(0.08, 0.02, 0.92, 0.98, 0.08), rect(0.16, 0.10, 0.84, 0.82, 0.03)),
                   circle(0.50, 0.90, 0.035))
    speaker_box = union(minus(rect(0.20, 0.02, 0.80, 0.98, 0.09), rect(0.27, 0.09, 0.73, 0.91, 0.05)),
                        ring(0.50, 0.64, 0.14, 0.21), circle(0.50, 0.64, 0.06), circle(0.50, 0.25, 0.08))
    tv = union(minus(rect(0.0, 0.02, 1.0, 0.76, 0.05), rect(0.07, 0.09, 0.93, 0.69)),
               rect(0.43, 0.76, 0.57, 0.88), rect(0.22, 0.88, 0.78, 0.98, 0.04))
    car = union(minus(poly([(0.24, 0.06), (0.76, 0.06), (0.90, 0.42), (0.10, 0.42)]),
                      poly([(0.30, 0.14), (0.70, 0.14), (0.79, 0.40), (0.21, 0.40)])),
                rect(0.0, 0.40, 1.0, 0.80, 0.08),
                circle(0.24, 0.84, 0.14), circle(0.76, 0.84, 0.14))
    render_icon("dev_computer", 64, laptop, green)
    render_icon("dev_phone", 64, phone, green)
    render_icon("dev_tablet", 64, tablet, green)
    render_icon("dev_speaker", 64, speaker_box, green)
    render_icon("dev_tv", 64, tv, green)
    render_icon("dev_car", 64, car, green)
    # "Music from the watch": round watch with straps and hands
    watch = union(rect(0.33, 0.02, 0.67, 0.24, 0.04), rect(0.33, 0.76, 0.67, 0.98, 0.04),
                  minus(circle(0.5, 0.5, 0.34), circle(0.5, 0.5, 0.26)),
                  rect(0.475, 0.33, 0.525, 0.53, 0.02), rect(0.475, 0.475, 0.64, 0.525, 0.02),
                  rect(0.84, 0.44, 0.90, 0.56, 0.02))
    render_icon("dev_watch", 64, watch, green)
    render_icon("knob", 18, circle(0.5, 0.5, 0.5))
    # app icon: green disc with a dark play triangle
    render_layers("icon", 248, [(circle(0.5, 0.5, 0.5), (30, 215, 96)),
                                (poly([(0.40, 0.30), (0.40, 0.70), (0.72, 0.50)]), (18, 18, 18))])
    heart = union(circle(0.36, 0.40, 0.15), circle(0.64, 0.40, 0.15),
                  poly([(0.22, 0.46), (0.78, 0.46), (0.50, 0.76)]))
    note = union(circle(0.40, 0.66, 0.10), rect(0.46, 0.26, 0.52, 0.66),
                 poly([(0.46, 0.26), (0.70, 0.34), (0.70, 0.42), (0.52, 0.36)]))
    home = union(poly([(0.50, 0.10), (0.92, 0.48), (0.08, 0.48)]), rect(0.20, 0.44, 0.80, 0.90, 0.05))

    def liked_gradient(x, y):
        t = (x + (1 - y)) / 2  # bottom-left -> top-right
        a, b = (74, 46, 232), (164, 228, 214)
        return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))

    render_layers("liked", 96, [(rect(0, 0, 1, 1, 0.06), liked_gradient), (heart, (255, 255, 255))])
    render_layers("thumb_empty", 96, [(rect(0, 0, 1, 1, 0.06), (60, 60, 60)), (note, (160, 160, 160))])
    render_icon("home", 48, home)
    render_vignette(466)
    # Screensaver: cover stays clear in the middle, edges darken evenly
    render_alpha("vignette_light", 466,
                 lambda r, v: 0.12 + 0.78 * smooth((r - 0.45) / 0.55))


if __name__ == "__main__":
    main()
