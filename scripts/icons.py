"""Draws the plugin's images: plugin and category icons, each action's list
icon and its key images, at 1x and @2x. python3 scripts/icons.py"""

import os

from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(__file__), "..", "app.keybars.streamdeck.sdPlugin", "imgs")
GREEN, DIM, WHITE, BG = (34, 224, 107), (90, 96, 104), (255, 255, 255), (14, 15, 18)


def bars(d, s, colour):
    heights = [0.35, 0.6, 0.9, 0.7, 0.45]
    w = s / 9
    for i, h in enumerate(heights):
        x = s * 0.14 + i * w * 1.5
        d.rounded_rectangle([x, s * (0.86 - h * 0.7), x + w, s * 0.86], radius=w / 3, fill=colour)


def focus(d, s, colour):
    d.ellipse([s * 0.18, s * 0.18, s * 0.82, s * 0.82], outline=colour, width=max(1, int(s / 14)))
    d.ellipse([s * 0.4, s * 0.4, s * 0.6, s * 0.6], fill=colour)


def play(d, s, colour):
    d.polygon([(s * 0.3, s * 0.2), (s * 0.3, s * 0.8), (s * 0.8, s * 0.5)], fill=colour)


def bolt(d, s, colour):
    d.polygon(
        [(s * 0.55, s * 0.12), (s * 0.25, s * 0.55), (s * 0.48, s * 0.55), (s * 0.42, s * 0.88), (s * 0.75, s * 0.42), (s * 0.52, s * 0.42)],
        fill=colour,
    )


def image(path, size, draw, colour, bg=None):
    for scale, suffix in ((1, ""), (2, "@2x")):
        s = size * scale
        im = Image.new("RGBA", (s, s), bg + (255,) if bg else (0, 0, 0, 0))
        draw(ImageDraw.Draw(im), s, colour)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        im.save(f"{path}{suffix}.png")


image(f"{ROOT}/plugin/icon", 256, bars, GREEN, BG)
image(f"{ROOT}/plugin/category", 28, bars, WHITE)
image(f"{ROOT}/plugin/marketplace", 288, bars, GREEN, BG)
for name, draw in (("focus", focus), ("lights", bars), ("play", play), ("event", bolt)):
    image(f"{ROOT}/actions/{name}/icon", 20, draw, WHITE)
    image(f"{ROOT}/actions/{name}/off", 72, draw, DIM, BG)
    image(f"{ROOT}/actions/{name}/on", 72, draw, GREEN, BG)
