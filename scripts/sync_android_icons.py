"""Write Android mipmap / notification icons from Expo assets."""
from __future__ import annotations

import os
from PIL import Image

ROOT = r"C:\dev\GateAuto"
ASSETS = os.path.join(ROOT, "assets")
RES = os.path.join(ROOT, "android", "app", "src", "main", "res")

# density -> px for legacy launcher / adaptive layers
DENSITIES = {
    "mdpi": 48,
    "hdpi": 72,
    "xhdpi": 96,
    "xxhdpi": 144,
    "xxxhdpi": 192,
}
# Adaptive foreground/background are typically 108dp
ADAPTIVE = {
    "mdpi": 108,
    "hdpi": 162,
    "xhdpi": 216,
    "xxhdpi": 324,
    "xxxhdpi": 432,
}
NOTIF = {
    "mdpi": 24,
    "hdpi": 36,
    "xhdpi": 48,
    "xxhdpi": 72,
    "xxxhdpi": 96,
}


def save_webp(im: Image.Image, path: str) -> None:
    im.save(path, "WEBP", quality=90, method=6)


def main() -> None:
    icon = Image.open(os.path.join(ASSETS, "icon.png")).convert("RGBA")
    fg = Image.open(os.path.join(ASSETS, "android-icon-foreground.png")).convert("RGBA")
    bg = Image.open(os.path.join(ASSETS, "android-icon-background.png")).convert("RGBA")
    mono = Image.open(os.path.join(ASSETS, "android-icon-monochrome.png")).convert("RGBA")

    for dens, px in DENSITIES.items():
        folder = os.path.join(RES, f"mipmap-{dens}")
        os.makedirs(folder, exist_ok=True)
        legacy = icon.resize((px, px), Image.Resampling.LANCZOS)
        save_webp(legacy, os.path.join(folder, "ic_launcher.webp"))
        save_webp(legacy, os.path.join(folder, "ic_launcher_round.webp"))

    for dens, px in ADAPTIVE.items():
        folder = os.path.join(RES, f"mipmap-{dens}")
        save_webp(fg.resize((px, px), Image.Resampling.LANCZOS), os.path.join(folder, "ic_launcher_foreground.webp"))
        save_webp(bg.resize((px, px), Image.Resampling.LANCZOS), os.path.join(folder, "ic_launcher_background.webp"))
        save_webp(mono.resize((px, px), Image.Resampling.LANCZOS), os.path.join(folder, "ic_launcher_monochrome.webp"))

    # Notification: white silhouette on transparent (Android tints it)
    gray = icon.convert("L")
    notif_base = Image.new("RGBA", icon.size, (0, 0, 0, 0))
    gp, npx = gray.load(), notif_base.load()
    w, h = icon.size
    for y in range(h):
        for x in range(w):
            if gp[x, y] > 150:
                npx[x, y] = (255, 255, 255, 255)

    for dens, px in NOTIF.items():
        folder = os.path.join(RES, f"drawable-{dens}")
        os.makedirs(folder, exist_ok=True)
        notif_base.resize((px, px), Image.Resampling.LANCZOS).save(
            os.path.join(folder, "notification_icon.png"), "PNG"
        )

    colors_path = os.path.join(RES, "values", "colors.xml")
    with open(colors_path, encoding="utf-8") as f:
        colors = f.read()
    colors = colors.replace("#1B4D89", "#0D3D42").replace("#E6F4FE", "#0D3D42")
    # ic_launcher_background color if present
    if "ic_launcher_background" in colors and "#0D3D42" not in colors:
        import re

        colors = re.sub(
            r'(<color name="ic_launcher_background">)[^<]+',
            r"\1#0D3D42",
            colors,
        )
    with open(colors_path, "w", encoding="utf-8") as f:
        f.write(colors)
    print("synced icons; colors.xml updated")
    print(open(colors_path, encoding="utf-8").read())


if __name__ == "__main__":
    main()
