"""Gera os ícones da PWA (frontend/public/icons) e do app Android (rodar só quando o desenho mudar):
    uvx --with pillow python packaging/icons.py
Sete Favos: sete favos de colmeia em grafite sobre latão, as cores do design system.
O mesmo desenho do <Logo> do menu (frontend/src/components/Logo.tsx).
"""

from __future__ import annotations

import math
import shutil
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "frontend" / "public" / "icons"
ANDROID = ROOT / "android" / "app" / "src" / "main" / "res" / "drawable-nodpi" / "ic_launcher.png"
BRASS = (199, 158, 92)      # --color-accent (oklch 70% 0.105 80), aprox. em sRGB
GRAPHITE = (36, 31, 27)     # --color-on-accent


# Desenho numa grade de 100 (igual ao viewBox do Logo.tsx): favo central + 6 em volta.
CELL_R = 9.5    # raio (centro ao vértice) de cada favo
RING = 21       # distância do centro aos favos de fora
STROKE = 2.5    # contorno da mesma cor: arredonda os cantos
EXTENT = 61     # largura total do desenho na grade


def favos(size: int, glyph: float, radius: float) -> Image.Image:
    """`glyph`: fração do lado ocupada pelos favos; `radius`: canto do fundo (0 = quadrado, p/ maskable)."""
    scale = 4  # desenha grande e reduz: bordas lisas
    s = size * scale
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, s - 1, s - 1), radius=int(s * radius), fill=BRASS)

    u = s * glyph / EXTENT
    centers = [(0.0, 0.0)] + [(RING * math.cos(math.radians(60 * k)), RING * math.sin(math.radians(60 * k))) for k in range(6)]
    for cx, cy in centers:
        pts = [
            (s / 2 + (cx + CELL_R * math.cos(math.radians(60 * k - 90))) * u,
             s / 2 + (cy + CELL_R * math.sin(math.radians(60 * k - 90))) * u)
            for k in range(6)
        ]
        d.polygon(pts, fill=GRAPHITE)
        d.line(pts + pts[:2], fill=GRAPHITE, width=max(1, round(STROKE * u)), joint="curve")
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    favos(192, 0.62, 0.22).save(OUT / "icon-192.png")
    favos(512, 0.62, 0.22).save(OUT / "icon-512.png")
    # maskable: fundo cheio e favos dentro da área segura (círculo de 80%)
    favos(512, 0.5, 0).save(OUT / "maskable-512.png")
    # iOS recorta os cantos sozinho e não aceita transparência
    favos(180, 0.6, 0).convert("RGB").save(OUT / "apple-touch-icon.png")
    favos(64, 0.72, 0.22).save(OUT / "favicon-64.png")
    shutil.copyfile(OUT / "icon-192.png", ANDROID)
    print(f"Ícones em {OUT} e {ANDROID}")


if __name__ == "__main__":
    main()
