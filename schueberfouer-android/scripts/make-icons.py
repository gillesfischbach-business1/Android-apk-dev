#!/usr/bin/env python3
"""Draws the app icon and splash sources into resources/ (Pillow only).

Outputs (inputs for `npx @capacitor/assets generate --android --assetPath resources`):
  resources/icon-only.png        1024x1024  full icon (legacy / round icons)
  resources/icon-foreground.png  1024x1024  adaptive icon foreground (transparent)
  resources/icon-background.png  1024x1024  adaptive icon background (night gradient)
  resources/splash.png           2732x2732  splash (dark already; no separate splash-dark.png,
                                            which would only duplicate ~2.5 MB of drawables)

Design: dark purple night (#140a2e -> #05030f), glowing yellow-green Ferris wheel
(#c6ff3d), "SCHUEBERFOUER" / "2026" in gold (#ffd166), font Bungee (OFL, @fontsource).
Run from schueberfouer-android/:  python3 scripts/make-icons.py
"""
import math
import os
import random

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "resources")
FONT = os.path.join(ROOT, "node_modules/@fontsource/bungee/files/bungee-latin-400-normal.woff")

TOP = (0x14, 0x0A, 0x2E)
BOTTOM = (0x05, 0x03, 0x0F)
GREEN = (0xC6, 0xFF, 0x3D)
GOLD = (0xFF, 0xD1, 0x66)
PINK = (0xFF, 0x4F, 0xD8)
CYAN = (0x00, 0xF5, 0xD4)


def night(size):
    """Radial-ish vertical gradient #140a2e (top/centre) -> #05030f (edges) plus faint stars."""
    w = h = min(size, 256)  # smooth gradient: render small, upscale
    img = Image.new("RGB", (w, h), BOTTOM)
    px = img.load()
    cx, cy = w * 0.5, h * 0.42
    rmax = math.hypot(w * 0.62, h * 0.62)
    for y in range(h):
        for x in range(0, w):
            t = min(1.0, math.hypot(x - cx, (y - cy) * 1.1) / rmax)
            t = t * t * (3 - 2 * t)
            px[x, y] = tuple(int(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3))
    img = img.resize((size, size), Image.BICUBIC)
    w = h = size
    rnd = random.Random(2026)
    d = ImageDraw.Draw(img)
    for _ in range(int(size * 0.08)):
        x, y = rnd.random() * w, rnd.random() * h * 0.7
        r = rnd.choice([0.6, 0.8, 1.0, 1.4]) * size / 1024
        a = rnd.randint(90, 200)
        d.ellipse([x - r, y - r, x + r, y + r], fill=(a, a, min(255, a + 30)))
    return img


def wheel_layer(size, cx, cy, R, scale):
    """Ferris wheel line art on a transparent layer (drawn at the final pixel size)."""
    lay = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    lw = max(2, int(10 * scale))
    n = 16
    # support legs (A-frame) behind the wheel
    foot = cy + R * 1.32
    for dx in (-0.62, 0.62):
        d.line([(cx, cy), (cx + dx * R, foot)], fill=GREEN + (255,), width=int(lw * 1.4))
    d.line([(cx - 0.75 * R, foot), (cx + 0.75 * R, foot)], fill=GREEN + (255,), width=int(lw * 1.2))
    # rims
    for rr, wmul in ((R, 1.3), (R * 0.93, 0.7), (R * 0.35, 0.8)):
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], outline=GREEN + (255,), width=int(lw * wmul))
    # spokes
    for i in range(n):
        a = 2 * math.pi * i / n
        d.line([(cx, cy), (cx + math.cos(a) * R, cy + math.sin(a) * R)], fill=GREEN + (255,), width=max(1, int(lw * 0.55)))
    # gondolas (alternating gold / pink / cyan)
    cols = [GOLD, PINK, CYAN, GOLD]
    g = R * 0.11
    for i in range(n // 2):
        a = 2 * math.pi * (i + 0.25) / (n // 2)
        x, y = cx + math.cos(a) * R, cy + math.sin(a) * R
        c = cols[i % len(cols)]
        d.line([(x, y), (x, y + g * 0.9)], fill=c + (255,), width=max(1, int(lw * 0.5)))
        d.rounded_rectangle([x - g * 0.8, y + g * 0.6, x + g * 0.8, y + g * 1.9], radius=g * 0.35, fill=c + (255,))
    # hub
    d.ellipse([cx - R * 0.08, cy - R * 0.08, cx + R * 0.08, cy + R * 0.08], fill=GOLD + (255,))
    # light bulbs on the rim
    for i in range(48):
        a = 2 * math.pi * i / 48
        x, y = cx + math.cos(a) * R, cy + math.sin(a) * R
        b = lw * 0.55
        d.ellipse([x - b, y - b, x + b, y + b], fill=(255, 255, 220, 255))
    return lay


def glow(layer, radius, strength=2):
    """Neon glow: blurred copies of the layer under the sharp layer."""
    out = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    for r, k in ((radius * 2.2, strength), (radius, strength)):
        blur = layer.filter(ImageFilter.GaussianBlur(r))
        for _ in range(k):
            out = Image.alpha_composite(out, blur)
    return Image.alpha_composite(out, layer)


def text_layer(size, text, font_px, center, color, glow_color, spacing=0):
    lay = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    f = ImageFont.truetype(FONT, int(font_px))
    # manual letter spacing
    widths = [d.textlength(ch, font=f) for ch in text]
    total = sum(widths) + spacing * (len(text) - 1)
    x = center[0] - total / 2
    for ch, w in zip(text, widths):
        d.text((x, center[1]), ch, font=f, fill=color + (255,), anchor="lm")
        x += w + spacing
    halo = Image.new("RGBA", lay.size, glow_color + (0,))
    halo.putalpha(lay.getchannel("A"))
    halo = halo.filter(ImageFilter.GaussianBlur(font_px * 0.18))
    return Image.alpha_composite(Image.alpha_composite(Image.new("RGBA", lay.size, (0, 0, 0, 0)), halo), lay)


def fit_font(text, target_w, start_px):
    f_px = start_px
    probe = ImageDraw.Draw(Image.new("RGBA", (10, 10)))
    while f_px > 8 and probe.textlength(text, font=ImageFont.truetype(FONT, int(f_px))) > target_w:
        f_px -= 2
    return f_px


def compose(size, with_bg, wheel_scale, text=True, safe=1.0):
    """Ferris wheel + texts. `safe` shrinks everything towards the centre (adaptive-icon safe zone)."""
    s = size / 1024.0
    base = night(size).convert("RGBA") if with_bg else Image.new("RGBA", (size, size), (0, 0, 0, 0))
    c = size / 2
    R = 300 * s * wheel_scale * safe
    cy = c - (95 * s * safe if text else 40 * s * safe)
    wl = wheel_layer(size, c, cy, R, s * safe * wheel_scale)
    base = Image.alpha_composite(base, glow(wl, 14 * s * safe))
    if text:
        t1 = "SCHUEBERFOUER"
        px = fit_font(t1, size * 0.86 * safe, 120 * s * safe)
        ty = cy + R * 1.32 + 70 * s * safe
        band = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        bd = ImageDraw.Draw(band)
        bd.rounded_rectangle([c - size * 0.47 * safe, ty - px * 0.75, c + size * 0.47 * safe, ty + px * 0.75 + px * 1.05],
                             radius=px * 0.35, fill=(5, 3, 15, 170))
        if with_bg:
            base = Image.alpha_composite(base, band)
        base = Image.alpha_composite(base, text_layer(size, t1, px, (c, ty), GOLD, (255, 140, 0)))
        base = Image.alpha_composite(base, text_layer(size, "2026", px * 0.9, (c, ty + px * 1.05), GOLD, (255, 45, 149), spacing=px * 0.25))
    return base


def main():
    os.makedirs(OUT, exist_ok=True)
    # full icon (legacy launchers, Play Store listing 512px is derived from this)
    icon = compose(1024, True, 1.0, text=True)
    icon.convert("RGB").save(os.path.join(OUT, "icon-only.png"), optimize=True)
    # adaptive: @capacitor/assets insets the layers by 16.7% (= the 72dp visible area); keep the art
    # inside the circular mask by shrinking it slightly
    fg = compose(1024, False, 1.0, text=True, safe=0.86)
    fg.save(os.path.join(OUT, "icon-foreground.png"), optimize=True)
    night(1024).save(os.path.join(OUT, "icon-background.png"), optimize=True)
    # splash: big canvas, artwork in the middle ~40% (Android 12+ shows only a centred icon;
    # older devices crop the square to the screen aspect)
    sp = night(2732).convert("RGBA")
    art = compose(1100, False, 1.0, text=True)
    sp.alpha_composite(art, ((2732 - 1100) // 2, (2732 - 1100) // 2))
    sp = sp.convert("RGB")
    sp.save(os.path.join(OUT, "splash.png"), optimize=True)
    print("wrote", sorted(os.listdir(OUT)))


if __name__ == "__main__":
    main()
