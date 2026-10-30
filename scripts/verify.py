"""Проверка структуры проекта «КБЖУ Дневник»."""
import json
import os
import re
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
errors = []


def read(path):
    with open(os.path.join(BASE, path), encoding='utf-8-sig') as fh:
        return fh.read()


def check(path):
    full = os.path.join(BASE, path)
    if not os.path.exists(full):
        errors.append(f'MISSING: {path}')
        return None
    return full


def main():
    required = [
        'index.html', 'manifest.webmanifest', 'sw.js',
        'css/style.css',
        'js/icons.js', 'js/db.js', 'js/api.js', 'js/app.js',
        'icons/icon-192.png', 'icons/icon-512.png',
        'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
        'icons/favicon-32.png',
        'README.md', 'scripts/generate_icons.py',
    ]
    for f in required:
        check(f)

    # --- manifest ---
    manifest_path = check('manifest.webmanifest')
    if manifest_path:
        with open(manifest_path, 'rb') as fh:
            if fh.read(3) == b'\xef\xbb\xbf':
                errors.append('MANIFEST: файл начинается с BOM')
        try:
            manifest = json.loads(read('manifest.webmanifest'))
            if manifest.get('start_url') != './index.html':
                errors.append('MANIFEST: start_url некорректен')
            if len(manifest.get('icons', [])) != 4:
                errors.append('MANIFEST: ожидается 4 иконки')
        except json.JSONDecodeError as e:
            errors.append(f'MANIFEST: невалидный JSON — {e}')

    # --- размеры иконок ---
    try:
        from PIL import Image
        expected = {
            'icons/icon-192.png': (192, 192),
            'icons/icon-512.png': (512, 512),
            'icons/icon-maskable-512.png': (512, 512),
            'icons/apple-touch-icon.png': (180, 180),
            'icons/favicon-32.png': (32, 32),
        }
        for path, size in expected.items():
            full = check(path)
            if full:
                img = Image.open(full)
                if img.size != size:
                    errors.append(f'ICON: {path} — ожидался {size}, получен {img.size}')
    except ImportError:
        print('! Pillow не установлен — проверка размеров иконок пропущена')

    # --- index.html ---
    if check('index.html'):
        html = read('index.html')
        for ref in ['manifest.webmanifest', 'css/style.css', 'js/icons.js',
                    'js/db.js', 'js/api.js', 'js/app.js', 'sw.js']:
            if ref not in html:
                errors.append(f'INDEX: нет ссылки на {ref}')

        # все id, которые ищет app.js, должны быть в разметке
        js = read('js/app.js')
        html_ids = set(re.findall(r'id="([^"]+)"', html))
        js_ids = set(re.findall(r"\$\('([^']+)'\)", js))
        missing = js_ids - html_ids
        if missing:
            errors.append(f'INDEX: нет элементов с id: {sorted(missing)}')

        # у каждой статической кнопки data-action должен быть обработчик
        actions = set(re.findall(r'data-action="([^"]+)"', html))
        handled = set(re.findall(r"case '([^']+)':", js))
        unhandled = actions - handled
        if unhandled:
            errors.append(f'APP: нет обработчика для data-action: {sorted(unhandled)}')

        if 'btn-share' in html:
            errors.append('INDEX: кнопка «Поделиться» должна быть удалена')

    # --- база ---
    if check('js/db.js'):
        dbjs = read('js/db.js')
        if 'DB_VERSION = 3' not in dbjs:
            errors.append('DB: DB_VERSION не равен 3')
        for token in ['STORE_FAVORITES', 'STORE_WEIGHTS', 'DBGetFavorites',
                      'DBAddFavorite', 'DBUpdateFavorite', 'DBAddWeight',
                      'DBGetWeights', 'DBDeleteWeight']:
            if token not in dbjs:
                errors.append(f'DB: отсутствует {token}')

    # --- безопасность: ключи не должны попадать в код ---
    for path in ['js/db.js', 'js/api.js', 'js/app.js', 'js/icons.js', 'index.html']:
        if check(path):
            content = read(path)
            if re.search(r'sk-or-v1-[A-Za-z0-9_-]{8,}', content) or 'AIza' in content:
                errors.append(f'SECURITY: в {path} найден API-ключ')

    # --- API-заголовки: кириллица в HTTP-заголовке ломает fetch ---
    if check('js/api.js'):
        api = read('js/api.js')
        title = re.search(r"'X-Title':\s*'([^']*)'", api)
        if not title:
            errors.append("API: не найден заголовок X-Title")
        elif not title.group(1).isascii():
            errors.append('API: X-Title должен быть только из ASCII-символов')

    # --- вывод ---
    if errors:
        print('ОШИБКИ:')
        for e in errors:
            print(f'  - {e}')
        sys.exit(1)

    print('OK: все проверки пройдены успешно')


if __name__ == '__main__':
    main()
