filepath = 'frontend/src/components/MaskingCanvas.jsx'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

lines = content.split('\n')
new_lines = []
in_div = False
for line in lines:
    if 'role="presentation"' in line:
        if not in_div:
            new_lines.append(line)
            in_div = True
    else:
        new_lines.append(line)
        if '<div' in line:
            in_div = False
        elif '>' in line:
            in_div = False

with open(filepath, 'w', encoding='utf-8') as f:
    f.write('\n'.join(new_lines))
print('Fixed duplicates')
