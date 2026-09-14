import os
import re

files_to_fix = [
    'frontend/src/components/MaskingCanvas.jsx',
    'frontend/src/pages/Dashboard.jsx',
    'frontend/src/pages/OrgSettings.jsx',
    'frontend/src/pages/Settings.jsx'
]

insert_str = '''role="button"
tabIndex={0}
onKeyDown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.currentTarget.click();
    }
}}'''

for filepath in files_to_fix:
    if not os.path.exists(filepath):
        continue
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    new_lines = []
    lines = content.split('\n')
    modified = False
    
    for line in lines:
        if '// NOSONAR' in line:
            line_no_sonar = line.replace('// NOSONAR', '').rstrip()
            
            if 'onClick=' in line_no_sonar and '<div' not in line_no_sonar and '<span' not in line_no_sonar and '<li' not in line_no_sonar:
                indent = len(line_no_sonar) - len(line_no_sonar.lstrip())
                prefix = ' ' * indent
                formatted_insert = '\n'.join([prefix + l for l in insert_str.split('\n')])
                new_lines.append(formatted_insert)
                new_lines.append(line_no_sonar)
            elif 'onClick=' in line_no_sonar and ('<div' in line_no_sonar or '<span' in line_no_sonar or '<li' in line_no_sonar):
                line_no_sonar = re.sub(r'(<(div|span|li)\b)', r'\1 role="button" tabIndex={0} onKeyDown={(e) => { if(e.key === \'Enter\' || e.key === \' \') { e.preventDefault(); e.currentTarget.click(); } }}', line_no_sonar)
                new_lines.append(line_no_sonar)
            elif any(x in line_no_sonar for x in ['onMouse', 'onWheel', 'onDrag', 'onDrop', 'onContext']):
                indent = len(line_no_sonar) - len(line_no_sonar.lstrip())
                prefix = ' ' * indent
                new_lines.append(prefix + 'role="presentation"')
                new_lines.append(line_no_sonar)
            else:
                new_lines.append(line_no_sonar)
                
            modified = True
        else:
            new_lines.append(line)

    if modified:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write('\n'.join(new_lines))
        print(f'Fixed {filepath}')
