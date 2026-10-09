#!/usr/bin/env python3
"""Renders the slide backgrounds into assets/. pptx gradients don't survive a Google Slides
import, so the glow is baked into images. Run: python3 slides-build/make-backgrounds.py"""
from pathlib import Path

from PIL import Image, ImageChops, ImageOps

SIZE = (1600, 900)  # pptxgenjs stores one copy per slide, so keep these small
BASE = (14, 14, 14)  # Paiflow surface-container-lowest
PINK = (255, 74, 141)  # Paiflow primary-container
BLUE = (0, 162, 253)  # Paiflow secondary-container
OUT = Path(__file__).parent / 'assets'
EDGE = 80  # inverted radial_gradient value at the middle of a box edge (measured: ~75)


def glow(img, center, radius, color, strength, falloff=2.2):
    """Composite a soft elliptical glow. strength 0..1 is the peak opacity at the centre."""
    rx, ry = radius
    grad = ImageOps.invert(Image.radial_gradient('L')).resize((rx * 2, ry * 2), Image.BICUBIC)
    # radial_gradient is normalised to the corner, so the box edge sits at EDGE, not 0.
    # Remap EDGE..255 to 0..1 or the glow ends in a visible rectangle.
    grad = grad.point(lambda v: int((max(0.0, (v - EDGE) / (255 - EDGE)) ** falloff) * 255 * strength))
    mask = Image.new('L', SIZE, 0)
    mask.paste(grad, (center[0] - rx, center[1] - ry))
    return Image.composite(Image.new('RGB', SIZE, color), img, mask)


def dither(img, sigma=2):
    """Fine noise so the gradient doesn't band after JPEG compression or projector scaling."""
    noise = Image.effect_noise(SIZE, sigma).convert('RGB')
    return ImageChops.add(img, noise, 1, -128)


def render(name, glows):
    img = Image.new('RGB', SIZE, BASE)
    k = SIZE[0] / 1920  # glow geometry below is specified on a 1920x1080 canvas
    for (cx, cy), (rx, ry), color, strength in glows:
        img = glow(img, (int(cx * k), int(cy * k)), (int(rx * k), int(ry * k)), color, strength)
    OUT.mkdir(exist_ok=True)
    path = OUT / f'{name}.jpg'
    dither(img).save(path, quality=86)
    print(path.name, f'{path.stat().st_size // 1024} KB')


# (center, radius, color, strength)
render('bg-tr', [
    ((1800, -80), (1500, 1050), PINK, 0.28),
    ((40, 1180), (1300, 950), BLUE, 0.16),
])
render('bg-bl', [
    ((100, 1180), (1500, 1050), PINK, 0.25),
    ((1880, -100), (1300, 950), BLUE, 0.16),
])
render('bg-hero', [
    ((1400, 520), (1300, 980), PINK, 0.32),
    ((160, 1200), (1300, 950), BLUE, 0.18),
])
