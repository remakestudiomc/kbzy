"""Генерация иконок для PWA «КБЖУ Дневник»"""
from PIL import Image, ImageDraw, ImageFont
import os

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'icons')
os.makedirs(OUT_DIR, exist_ok=True)

# Цвета приложения
ORANGE = (249, 115, 22)
ORANGE_DARK = (234, 106, 11)
YELLOW = (251, 191, 36)
WHITE = (255, 255, 255)
LIGHT = (255, 243, 232)

def draw_icon(size, maskable=False):
    """Рисует иконку: градиент + тарелка с вилкой"""
    img = Image.new('RGB', (size, size), WHITE)
    draw = ImageDraw.Draw(img)

    # --- Градиентный фон (оранжевый → жёлтый) ---
    for y in range(size):
        t = y / size
        r = int(ORANGE[0] + (YELLOW[0] - ORANGE[0]) * t)
        g = int(ORANGE[1] + (YELLOW[1] - ORANGE[1]) * t)
        b = int(ORANGE[2] + (YELLOW[2] - ORANGE[2]) * t)
        draw.line([(0, y), (size, y)], fill=(r, g, b))

    # --- Мягкий круглый фон для тарелки (немного светлее центра) ---
    center = size / 2
    plate_r = size * 0.30
    shadow_r = size * 0.32

    # Тень
    draw.ellipse(
        [center - shadow_r, center - shadow_r + size*0.02,
         center + shadow_r, center + shadow_r + size*0.02],
        fill=(0, 0, 0, 0),
        outline=(180, 90, 20),
        width=max(2, int(size * 0.01))
    )

    # Тарелка (белый круг)
    draw.ellipse(
        [center - plate_r, center - plate_r, center + plate_r, center + plate_r],
        fill=WHITE
    )

    # Внутренняя каёмка тарелки
    inner_r = plate_r * 0.72
    draw.ellipse(
        [center - inner_r, center - inner_r, center + inner_r, center + inner_r],
        outline=(230, 230, 235),
        width=max(2, int(size * 0.012))
    )

    # --- Вилка (белая, с тенью) ---
    fork_w = size * 0.07
    fork_len = size * 0.22
    fork_x = center + size * 0.02
    fork_top = center - size * 0.15

    # Тень вилки
    fork_shadow_x = fork_x + size * 0.012
    fork_shadow_top = fork_top + size * 0.012
    draw.rounded_rectangle(
        [fork_shadow_x - fork_w/2, fork_shadow_top,
         fork_shadow_x + fork_w/2, fork_shadow_top + fork_len],
        radius=max(2, int(size * 0.02)),
        fill=(200, 100, 20)
    )

    # Ручка вилки
    draw.rounded_rectangle(
        [fork_x - fork_w/2, fork_top,
         fork_x + fork_w/2, fork_top + fork_len],
        radius=max(2, int(size * 0.02)),
        fill=WHITE
    )

    # Зубцы вилки
    tine_w = size * 0.018
    tine_h = size * 0.065
    gap = fork_w / 4
    tine_y = fork_top - tine_h - size * 0.004
    for i in range(3):
        tine_x = fork_x - fork_w/2 + gap * (i + 0.5) - tine_w/2 + gap*0.35
        draw.rounded_rectangle(
            [tine_x, tine_y, tine_x + tine_w, tine_y + tine_h],
            radius=max(1, int(size * 0.005)),
            fill=WHITE
        )

    # --- Нож (белый, слева) ---
    knife_x = center - size * 0.12
    knife_len = size * 0.18
    knife_top = center + size * 0.02

    # Тень ножа
    draw.rounded_rectangle(
        [knife_x - fork_w/2 + size*0.012, knife_top + size*0.012,
         knife_x + fork_w/2 + size*0.012, knife_top + knife_len + size*0.012],
        radius=max(2, int(size * 0.02)),
        fill=(200, 100, 20)
    )

    # Лезвие ножа (овальное)
    blade_w = fork_w * 0.85
    blade_h = knife_len * 0.5
    draw.rounded_rectangle(
        [knife_x - blade_w/2, knife_top - blade_h + size*0.02,
         knife_x + blade_w/2, knife_top + size*0.02],
        radius=max(2, int(size * 0.02)),
        fill=WHITE
    )

    # Ручка ножа
    draw.rounded_rectangle(
        [knife_x - fork_w/2, knife_top,
         knife_x + fork_w/2, knife_top + knife_len],
        radius=max(2, int(size * 0.02)),
        fill=WHITE
    )

    # --- Небольшие точки-"калории" вокруг ---
    dot_positions = [
        (center - size*0.26, center - size*0.30),
        (center - size*0.30, center - size*0.10),
        (center + size*0.26, center - size*0.28),
        (center + size*0.30, center - size*0.05),
        (center - size*0.32, center + size*0.22),
        (center + size*0.32, center + size*0.20),
    ]
    dot_r = size * 0.018
    for dx, dy in dot_positions:
        draw.ellipse(
            [dx - dot_r, dy - dot_r, dx + dot_r, dy + dot_r],
            fill=WHITE
        )

    # --- Обрезка под maskable: безопасная зона 80% ---
    if maskable:
        # Добавляем белый фон по краям (для адаптивных иконок Android)
        safe = size * 0.8
        offset = (size - safe) / 2
        img_safe = Image.new('RGBA', (size, size), (249, 115, 22, 0))
        # Рисуем белую подложку в безопасной зоне
        white_bg = Image.new('RGB', (size, size), ORANGE)
        # Просто оставляем как есть — градиент уже на всю площадь
        img = img.convert('RGBA')

    return img

# --- Генерация ---
sizes = [192, 512]
for s in sizes:
    icon = draw_icon(s, maskable=False)
    icon.save(os.path.join(OUT_DIR, f'icon-{s}.png'), 'PNG')
    print(f'OK: icon-{s}.png')

# Maskable (512) — с большим отступом безопасной зоны
maskable = draw_icon(512, maskable=True)
maskable.save(os.path.join(OUT_DIR, 'icon-maskable-512.png'), 'PNG')
print('OK: icon-maskable-512.png')

# Apple touch icon (180x180)
apple = draw_icon(180, maskable=False)
apple.save(os.path.join(OUT_DIR, 'apple-touch-icon.png'), 'PNG')
print('OK: apple-touch-icon.png')

print('Все иконки созданы в папке icons/')