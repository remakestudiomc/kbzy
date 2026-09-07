"""Проверка структуры проекта КБЖУ Дневник"""
import json
import os
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
errors = []

def check(path):
    full = os.path.join(BASE, path)
    if not os.path.exists(full):
        errors.append(f'MISSING: {path}')
        return None
    return full

def main():
    # Ключевые файлы
    required_files = [
        'index.html', 'manifest.webmanifest', 'sw.js',
        'css/style.css',
        'js/db.js', 'js/api.js', 'js/app.js',
        'icons/icon-192.png', 'icons/icon-512.png',
        'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
        'icons/favicon-32.png',
        'README.md', 'scripts/generate_icons.py',
    ]
    for f in required_files:
        check(f)

    # Валидность manifest JSON (без BOM)
    manifest_path = check('manifest.webmanifest')
    if manifest_path:
        with open(manifest_path, 'rb') as fh:
            raw = fh.read(3)
            if raw == b'\xef\xbb\xbf':
                errors.append('BOM: manifest.webmanifest начинается с BOM')

        with open(manifest_path, 'r', encoding='utf-8-sig') as fh:
            try:
                manifest = json.load(fh)
                if manifest.get('start_url') != './index.html':
                    errors.append('MANIFEST: start_url некорректен')
                if len(manifest.get('icons', [])) != 4:
                    errors.append('MANIFEST: ожидается 4 иконки')
            except json.JSONDecodeError as e:
                errors.append(f'MANIFEST: невалидный JSON - {e}')

    # Размеры иконок
    from PIL import Image
    expected_sizes = {
        'icons/icon-192.png': (192, 192),
        'icons/icon-512.png': (512, 512),
        'icons/icon-maskable-512.png': (512, 512),
        'icons/apple-touch-icon.png': (180, 180),
        'icons/favicon-32.png': (32, 32),
    }
    for path, size in expected_sizes.items():
        full = check(path)
        if full:
            try:
                img = Image.open(full)
                if img.size != size:
                    errors.append(f'ICON: {path} - ожидался {size}, получил {img.size}')
            except Exception as e:
                errors.append(f'ICON: не удалось открыть {path}: {e}')

    # Проверка что index.html ссылается на все нужные ресурсы
    index_path = check('index.html')
    if index_path:
        with open(index_path, 'r', encoding='utf-8-sig') as fh:
            html = fh.read()
        for ref in ['manifest.webmanifest', 'css/style.css', 'js/db.js', 'js/api.js', 'js/app.js', 'sw.js']:
            if ref not in html:
                errors.append(f'INDEX: нет ссылки на {ref}')

    # Простая проверка ID в HTML против ID в app.js
    if index_path:
        with open(index_path, 'r', encoding='utf-8-sig') as fh:
            html = fh.read()
        with open(os.path.join(BASE, 'js/app.js'), 'r', encoding='utf-8-sig') as fh:
            js = fh.read()

        import re
        html_ids = set(re.findall(r'id="([^"]+)"', html))
        js_gets = set(re.findall(r"\$\('([^']+)'\)", js))
        missing = js_gets - html_ids
        if missing:
            errors.append(f'INDEX: нет элементов с id для: {sorted(missing)}')

    # Проверка версии IndexedDB (3: записи, избранное, вес)
    dbjs_path = check('js/db.js')
    if dbjs_path:
        with open(dbjs_path, 'r', encoding='utf-8-sig') as fh:
            dbjs = fh.read()
        if 'DB_VERSION = 3' not in dbjs:
            errors.append('DB: DB_VERSION не равен 3 (нужно для store weights)')
        if 'STORE_FAVORITES' not in dbjs:
            errors.append('DB: отсутствует STORE_FAVORITES')
        if 'STORE_WEIGHTS' not in dbjs:
            errors.append('DB: отсутствует STORE_WEIGHTS')
        if 'DBGetFavorites' not in dbjs or 'DBAddFavorite' not in dbjs:
            errors.append('DB: отсутствуют функции для избранного')
        if 'DBAddWeight' not in dbjs or 'DBGetWeights' not in dbjs or 'DBDeleteWeight' not in dbjs:
            errors.append('DB: отсутствуют функции для веса')

    # Проверка, что API-ключ НЕ зашит в код приложения
    import re as _re
    for path in ['js/db.js', 'js/api.js', 'js/app.js', 'index.html']:
        full = check(path)
        if full:
            content = open(full, encoding='utf-8-sig').read()
            has_gemini_key = 'AIza' in content or 'AQ.Ab8' in content
            has_or_key = bool(_re.search(r'sk-or-v1-[A-Za-z0-9_-]{8,}', content))
            if has_gemini_key or has_or_key:
                errors.append(f'SECURITY: в {path} найден API-ключ — ключ должен храниться только в localStorage')

    # Проверка наличия избранного, веса и ключа в HTML
    if index_path:
        with open(index_path, 'r', encoding='utf-8-sig') as fh:
            html = fh.read()
        if 'btn-save-favorite' not in html or 'favorites-list' not in html:
            errors.append('INDEX: отсутствуют элементы избранного (btn-save-favorite / favorites-list)')
        for el in ['weight-input', 'btn-add-weight', 'weight-list']:
            if el not in html:
                errors.append(f'INDEX: отсутствует элемент веса ({el})')
        if 'set-api-key' not in html or 'btn-toggle-key' not in html:
            errors.append('INDEX: отсутствует поле API-ключа (set-api-key / btn-toggle-key)')
        # Кнопка "Поделиться" должна быть удалена
        if 'btn-share' in html:
            errors.append('INDEX: кнопка btn-share должна быть удалена')
        if 'btn-share' in open(os.path.join(BASE, 'js/app.js'), encoding='utf-8-sig').read():
            errors.append('APP: обработчик btn-share должен быть удалён')

    # Вывод
    if errors:
        print('ОШИБКИ:')
        for e in errors:
            print(f'  - {e}')
        sys.exit(1)
    else:
        print('OK: все проверки пройдены успешно')

if __name__ == '__main__':
    main()