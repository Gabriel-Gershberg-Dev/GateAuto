"""Process generated GateAuto icon into Expo/Android asset slots."""
from __future__ import annotations

import os
from PIL import Image

SRC = r"C:\Users\Gabriel\.cursor\projects\c-dev-GateAuto\assets\gateauto-icon.png"
OUT = r"C:\dev\GateAuto\assets"
SIZE = 1024


def avg_at(im: Image.Image, box: tuple[int, int, int, int]) -> tuple[float, float, float, float]:
    c = im.crop(box)
    px = list(c.getdata())
    n = max(len(px), 1)
    return (
        sum(p[0] for p in px) / n,
        sum(p[1] for p in px) / n,
        sum(p[2] for p in px) / n,
        sum(p[3] for p in px) / n,
    )


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    img = Image.open(SRC).convert("RGBA").resize((SIZE, SIZE), Image.Resampling.LANCZOS)

    bg_sample = avg_at(img, (48, 48, 96, 96))
    bg = (int(bg_sample[0]), int(bg_sample[1]), int(bg_sample[2]), 255)
    print("bg_sample", bg)

    # Full-bleed RGB icon (fills any rounded-corner transparency)
    full = Image.new("RGBA", (SIZE, SIZE), bg)
    full.paste(img, (0, 0), img)
    full_rgb = full.convert("RGB")

    icon_path = os.path.join(OUT, "icon.png")
    full_rgb.save(icon_path, "PNG", optimize=True)
    print("wrote", icon_path)

    full_rgb.resize((48, 48), Image.Resampling.LANCZOS).save(
        os.path.join(OUT, "favicon.png"), "PNG"
    )
    full_rgb.save(os.path.join(OUT, "gateauto-icon.png"), "PNG")

    # Adaptive background — deep teal matching the mark
    teal = (13, 61, 66, 255)  # #0D3D42
    Image.new("RGBA", (SIZE, SIZE), teal).save(
        os.path.join(OUT, "android-icon-background.png"), "PNG"
    )

    # Adaptive foreground: full artwork (Expo masks); matching bgColor in app.json
    full.save(os.path.join(OUT, "android-icon-foreground.png"), "PNG")

    # Monochrome: bright shapes → white, scaled into safe zone
    gray = full.convert("L")
    mono = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    gp = gray.load()
    mp = mono.load()
    for y in range(SIZE):
        for x in range(SIZE):
            if gp[x, y] > 145:
                mp[x, y] = (255, 255, 255, 255)

    m_size = int(SIZE * 0.72)
    m_resized = mono.resize((m_size, m_size), Image.Resampling.LANCZOS)
    mono_final = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    mono_final.paste(m_resized, ((SIZE - m_size) // 2, (SIZE - m_size) // 2), m_resized)
    mono_final.save(os.path.join(OUT, "android-icon-monochrome.png"), "PNG")
    print("wrote monochrome")
    print("assets:", os.listdir(OUT))


if __name__ == "__main__":
    main()
