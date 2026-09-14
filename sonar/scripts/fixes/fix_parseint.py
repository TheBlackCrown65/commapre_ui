
import os
import re

directory = 'frontend/src'

for root, _, files in os.walk(directory):
    for file in files:
        if file.endswith('.jsx') or file.endswith('.js'):
            filepath = os.path.join(root, file)
            with open(filepath, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # Using negative lookbehind to ensure we don't replace 'Number.parseInt'
            # (?<!Number\.)parseInt\(
            new_content = re.sub(r'(?<!Number\.)\bparseInt\(', 'Number.parseInt(', content)
            
            if new_content != content:
                with open(filepath, 'w', encoding='utf-8') as f:
                    f.write(new_content)
                print(f'Fixed {filepath}')

