import os
hist_dir = r'C:\Users\user\AppData\Roaming\Code\User\History'
best_file = None
best_len = 0
for root, dirs, files in os.walk(hist_dir):
    for f in files:
        if f == 'entries.json':
            continue
        try:
            path = os.path.join(root, f)
            with open(path, 'r', encoding='utf-8') as file:
                content = file.read()
                if '@router.get("/config")' in content and 'def read_all_configs' in content:
                    length = len(content.splitlines())
                    print('Found in:', path, 'Length:', length)
                    if length > best_len:
                        best_len = length
                        best_file = path
        except Exception:
            pass
if best_file:
    print('Best file:', best_file)
    with open('c:/Users/user/Desktop/robot_verify/recovered_endpoints.py', 'w', encoding='utf-8') as out:
        with open(best_file, 'r', encoding='utf-8') as src:
            out.write(src.read())
    print('Recovered to recovered_endpoints.py')
