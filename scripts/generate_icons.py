"""Генерация иконок для PWA «КБЖУ Дневник» из файла logo.png (с прозрачностью)"""
from PIL import Image
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOGO_PATH = os.path.join(BASE_DIR, 'logo.png')
OUT_DIR = os.path.join(BASE_DIR, 'icons')
os.makedirs(OUT_DIR, exist_ok=True)

GOLD = (212, 160, 23)


def load_logo():
    """Загружает исходный логотип и приводит к квадрату с сохранением прозрачности."""
    img = Image.open(LOGO_PATH).convert('RGBA')

    w, h = img.size
    side = max(w, h)
    if w != h:
        canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
        canvas.paste(img, ((side - w) // 2, (side - h) // 2), img)
        return canvas
    return img


def make_icon(size, maskable=False):
    """Создаёт иконку заданного размера из логотипа с сохранением прозрачности."""
    logo = load_logo()

    if maskable:
        # Maskable: контент в безопасной зоне (~72%), фон золотой по краям
        safe_ratio = 0.72
        target = int(size * safe_ratio)
        logo = logo.resize((target, target), Image.LANCZOS)

        canvas = Image.new('RGBA', (size, size), GOLD + (255,))
        offset = (size - target) // 2
        canvas.paste(logo, (offset, offset), logo)
        return canvas.convert('RGB')

    # Обычная иконка: логотип на всю площадь, прозрачность сохраняется
    pad = int(size * 0.04)
    target = size - pad * 2
    logo = logo.resize((target, target), Image.LANCZOS)

    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.paste(logo, (pad, pad), logo)
    return canvas


# --- Генерация ---
for s in [192, 512]:
    make_icon(s).save(os.path.join(OUT_DIR, f'icon-{s}.png'), 'PNG')
    print(f'OK: icon-{s}.png')

# Maskable (512)
make_icon(512, maskable=True).save(os.path.join(OUT_DIR, 'icon-maskable-512.png'), 'PNG')
print('OK: icon-maskable-512.png')

# Apple touch icon (180x180) — iOS не поддерживает прозрачность, заливаем белым
apple = make_icon(180)
apple_bg = Image.new('RGBA', (180, 180), (255, 255, 255, 255))
apple_bg.paste(apple, (0, 0), apple)
apple_bg.convert('RGB').save(os.path.join(OUT_DIR, 'apple-touch-icon.png'), 'PNG')
print('OK: apple-touch-icon.png')

# Favicon (32x32)
make_icon(32).save(os.path.join(OUT_DIR, 'favicon-32.png'), 'PNG')
print('OK: favicon-32.png')

print('Все иконки созданы из logo.png в папке icons/')