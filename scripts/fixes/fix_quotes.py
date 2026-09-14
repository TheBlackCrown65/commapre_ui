import os

files_to_fix = [
    'frontend/src/components/MaskingCanvas.jsx',
    'frontend/src/pages/Dashboard.jsx',
    'frontend/src/pages/OrgSettings.jsx',
    'frontend/src/pages/Settings.jsx'
]

for filepath in files_to_fix:
    if not os.path.exists(filepath):
        continue
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    new_content = content.replace(r"\'Enter\'", "'Enter'").replace(r"\' \'", "' '")

    if new_content != content:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f'Fixed quotes in {filepath}')
