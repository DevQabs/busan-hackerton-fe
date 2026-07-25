#!/usr/bin/env python3
"""app/icon.svg 그대로를 PNG로 굽는다 — PWA 설치 아이콘용.

SVG 렌더러 없이 같은 도형을 좌표로 다시 그린다(32단위 좌표계를 크기에 맞춰
확대). 디자인을 바꾸면 icon.svg와 이 파일을 함께 고쳐야 한다.

Run: python3 scripts/make_pwa_icons.py
"""
import os

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public")

BG = "#0b0f1a"
RING = "#22d3ee"
ARC = "#38bdf8"
SS = 4  # supersampling — 곡선 계단현상 제거


def draw(size: int, pad_ratio: float = 0.0) -> Image.Image:
    """pad_ratio > 0 이면 maskable 아이콘(안전 영역 확보)."""
    big = size * SS
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # 32단위 좌표 → 픽셀. maskable은 도형을 안쪽으로 축소하고 배경을 꽉 채운다.
    inner = big * (1 - 2 * pad_ratio)
    off = (big - inner) / 2
    u = inner / 32

    def px(x: float, y: float) -> tuple[float, float]:
        return off + x * u, off + y * u

    if pad_ratio > 0:
        d.rectangle([0, 0, big, big], fill=BG)
    else:
        d.rounded_rectangle([0, 0, big - 1, big - 1], radius=7 * u, fill=BG)

    w = 2.5 * u  # stroke-width
    cx, cy = px(16, 14)
    r = 6.5 * u
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=RING, width=round(w))
    r2 = 2 * u
    d.ellipse([cx - r2, cy - r2, cx + r2, cy + r2], fill=RING)

    # M9 27c2-3 5-4.5 7-4.5s5 1.5 7 4.5 — 어깨선을 원호로 근사한다.
    ax, ay = px(16, 34.2)
    ar = 11.6 * u
    d.arc(
        [ax - ar, ay - ar, ax + ar, ay + ar],
        start=217,
        end=323,
        fill=ARC,
        width=round(w),
    )
    return img.resize((size, size), Image.LANCZOS)


for size in (192, 512):
    draw(size).save(os.path.join(OUT, f"icon-{size}.png"))
    print(f"public/icon-{size}.png")

draw(512, pad_ratio=0.12).save(os.path.join(OUT, "icon-maskable-512.png"))
print("public/icon-maskable-512.png")
