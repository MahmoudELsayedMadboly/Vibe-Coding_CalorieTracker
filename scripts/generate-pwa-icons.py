#!/usr/bin/env python3
"""Generate placeholder PWA icons: solid teal background, white "CT" initials.

Run with: python3 scripts/generate-pwa-icons.py
Requires: pip install pillow

These are placeholders meant to be swapped for real branding/logo art later.
"""
import os
from PIL import Image, ImageDraw, ImageFont

TEAL = (20, 107, 107, 255)  # #146B6B
WHITE = (255, 255, 255, 255)

FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Supplemental/Helvetica.ttc",
    "/Library/Fonts/Arial Bold.ttf",
]

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "icons")


def find_font():
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            return path
    raise SystemExit("No suitable bold font found; install one or add a path to FONT_CANDIDATES.")


def draw_icon(size, text_scale, out_path):
    img = Image.new("RGBA", (size, size), TEAL)
    draw = ImageDraw.Draw(img)

    font_path = find_font()
    font_size = int(size * text_scale)
    font = ImageFont.truetype(font_path, font_size)

    text = "CT"
    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    x = (size - text_w) / 2 - bbox[0]
    y = (size - text_h) / 2 - bbox[1]

    draw.text((x, y), text, font=font, fill=WHITE)
    img.save(out_path)
    print(f"wrote {out_path} ({size}x{size})")


if __name__ == "__main__":
    os.makedirs(OUT_DIR, exist_ok=True)
    # Standard "any" purpose icons: content can fill most of the canvas.
    draw_icon(192, 0.46, os.path.join(OUT_DIR, "pwa-192x192.png"))
    draw_icon(512, 0.46, os.path.join(OUT_DIR, "pwa-512x512.png"))
    # Maskable icon: OS applies a shape mask (circle/squircle/etc.), so keep
    # the glyph within the ~80% center "safe zone" by shrinking it further.
    draw_icon(512, 0.32, os.path.join(OUT_DIR, "pwa-maskable-512x512.png"))
