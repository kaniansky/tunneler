#!/usr/bin/env python3
"""The homepage's screenshots (site/img/*.png) from the README's (screenshots/*.png), with the black
margins around the game screen cropped away; og.png (the link preview) = online-team.png.

    python3 tools/site-images.py        (needs Pillow: pip install pillow)

The release workflow runs it before uploading site/ (see .github/workflows/release.yml, job "site")."""
import os
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SHOTS = ["home", "split-screen", "vs-computer", "online-team", "spectator-grid", "spectator-map",
         "online-lobby", "lobby", "create"]

def crop(src, dst, pad=6):
    im = Image.open(src).convert("RGB")
    box = im.point(lambda v: 255 if v > 12 else 0).getbbox()
    if box:
        x0, y0, x1, y1 = box
        im = im.crop((max(0, x0 - pad), max(0, y0 - pad), min(im.width, x1 + pad), min(im.height, y1 + pad)))
    im.save(dst, optimize=True)
    return im.size

for name in SHOTS:
    size = crop(os.path.join(ROOT, "screenshots", name + ".png"), os.path.join(ROOT, "site", "img", name + ".png"))
    print(name, size)
crop(os.path.join(ROOT, "screenshots", "online-team.png"), os.path.join(ROOT, "site", "img", "og.png"))
