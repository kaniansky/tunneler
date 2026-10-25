"""The installable web app's icons (src/icons/, src/manifest.webmanifest) from the desktop app's icon
(src-tauri/app-icon.png, 1024 x 1024 pixel art): 192 and 512 px as they are, and maskable versions on an
opaque square (the rounded corners filled with the dirt's colour - a launcher cuts its own shape).
    python3 tools/make-pwa-icons.py        (needs Pillow: pip install pillow)"""
import os
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
src = Image.open(os.path.join(ROOT, "src-tauri", "app-icon.png")).convert("RGBA")
out = os.path.join(ROOT, "src", "icons")
os.makedirs(out, exist_ok=True)
DIRT = (196, 104, 28, 255)
for size in (192, 512):
    src.resize((size, size), Image.NEAREST).save(os.path.join(out, "icon-%d.png" % size), optimize=True)
    full = Image.new("RGBA", src.size, DIRT)
    full.alpha_composite(src)
    full.resize((size, size), Image.NEAREST).convert("RGB").save(os.path.join(out, "maskable-%d.png" % size), optimize=True)
print("src/icons: icon-192/512, maskable-192/512")
