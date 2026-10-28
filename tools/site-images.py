#!/usr/bin/env python3
"""The homepage's screenshots (site/img/*.png) from the README's (screenshots/*.png), with the black
margins around the game screen cropped away (the modern graphics' shots: their warm dark background);
og.png (the link preview) = online-team.png.

    python3 tools/site-images.py        (needs Pillow: pip install pillow)

The release workflow runs it before uploading site/ (see .github/workflows/release.yml, job "site")."""
import os
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SHOTS = ["home", "split-screen", "vs-computer", "online-team", "spectator-grid", "spectator-map",
         "online-lobby", "lobby", "create", "modern-game", "modern-retro", "modern-settings",
         # the homepage's modern theme: the same screens in the modern look (readme-screenshots.js ... modern)
         "modern-split-screen", "modern-vs-computer", "modern-online-lobby", "modern-spectator-grid", "modern-spectator-map",
         # 6.0's new screens, both looks (v6-screenshots.js)
         "quickplay", "challenge", "map-editor", "modern-quickplay", "modern-challenge", "modern-map-editor",
         # 1.2: 3D, the map picker (the release's own shots)
         "modern-3d", "map-picker", "modern-map-picker"]

def crop(src, dst, pad=6):
    im = Image.open(src).convert("RGB")
    # what differs from the background (the top left pixel: black, or modern's warm dark) by more than 12
    bg = im.getpixel((0, 0))
    diff = Image.merge("RGB", [ch.point(lambda v, b=b: 255 if abs(v - b) > 12 else 0)
                               for ch, b in zip(im.split(), bg)])
    box = diff.convert("L").point(lambda v: 255 if v else 0).getbbox()
    if box:
        x0, y0, x1, y1 = box
        im = im.crop((max(0, x0 - pad), max(0, y0 - pad), min(im.width, x1 + pad), min(im.height, y1 + pad)))
    if dst.endswith(".jpg"):
        im.save(dst, quality=86, optimize=True, progressive=True)
    else:
        im.save(dst, optimize=True)
    return im.size

JPEG = ["modern-game", "modern-split-screen", "modern-spectator-grid", "modern-spectator-map", "modern-map-editor", "modern-3d"]  # lit, textured: much smaller as JPEG

for name in SHOTS:
    ext = ".jpg" if name in JPEG else ".png"
    size = crop(os.path.join(ROOT, "screenshots", name + ".png"), os.path.join(ROOT, "site", "img", name + ext))
    print(name, size)
crop(os.path.join(ROOT, "screenshots", "online-team.png"), os.path.join(ROOT, "site", "img", "og.png"))
