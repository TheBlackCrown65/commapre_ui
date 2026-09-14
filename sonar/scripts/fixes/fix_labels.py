import os

replacements = [
    ('frontend/src/pages/Settings.jsx', 
        '<label className="p-1 hover:bg-slate-200 rounded text-blue-600 cursor-pointer" title="Upload Folder">', 
        '<label htmlFor="upload-folder-input" className="p-1 hover:bg-slate-200 rounded text-blue-600 cursor-pointer" title="Upload Folder">'),
    ('frontend/src/pages/Settings.jsx', 
        '<input type="file"', 
        '<input id="upload-folder-input" type="file"'),
        
    ('frontend/src/pages/RunTest.jsx', 
        '<label className="bg-white border border-slate-300 hover:bg-slate-50 px-3 py-1 rounded text-sm cursor-pointer shadow-sm transition-colors text-slate-600 font-medium select-none">', 
        '<label htmlFor="upload-files-input" className="bg-white border border-slate-300 hover:bg-slate-50 px-3 py-1 rounded text-sm cursor-pointer shadow-sm transition-colors text-slate-600 font-medium select-none">'),
    ('frontend/src/pages/RunTest.jsx', 
        '<input type="file" multiple', 
        '<input id="upload-files-input" type="file" multiple'),

    ('frontend/src/pages/RunTest.jsx', 
        '<label className={clsx("font-semibold text-sm whitespace-nowrap", !selectedSquadId ? "text-slate-300" : (selectedSquadId && !selectedFlow) ? "text-teal-600" : "text-teal-600")}>Flow:</label>', 
        '<label htmlFor="flow-select" className={clsx("font-semibold text-sm whitespace-nowrap", !selectedSquadId ? "text-slate-300" : (selectedSquadId && !selectedFlow) ? "text-teal-600" : "text-teal-600")}>Flow:</label>'),
    ('frontend/src/pages/RunTest.jsx', 
        '<select\n                                    value={selectedFlow?.id || \'\'}', 
        '<select id="flow-select"\n                                    value={selectedFlow?.id || \'\'}'),
        
    ('frontend/src/pages/RunTest.jsx', 
        '<label className="relative inline-flex items-center cursor-pointer">', 
        '<label htmlFor="generate-diff-toggle" className="relative inline-flex items-center cursor-pointer">'),
    ('frontend/src/pages/RunTest.jsx', 
        '<input\n                                        type="checkbox"', 
        '<input id="generate-diff-toggle"\n                                        type="checkbox"'),
        
    ('frontend/src/pages/Register.jsx', 
        '<label className="block text-sm font-medium text-slate-300 mb-1.5">Username</label>\n                            <input\n                                type="text"', 
        '<label htmlFor="reg-username" className="block text-sm font-medium text-slate-300 mb-1.5">Username</label>\n                            <input id="reg-username"\n                                type="text"'),
    ('frontend/src/pages/Register.jsx', 
        '<label className="block text-sm font-medium text-slate-300 mb-1.5">Department</label>\n                            <select\n                                value={selectedDeptId}', 
        '<label htmlFor="reg-dept" className="block text-sm font-medium text-slate-300 mb-1.5">Department</label>\n                            <select id="reg-dept"\n                                value={selectedDeptId}'),
    ('frontend/src/pages/Register.jsx', 
        '<label className="block text-sm font-medium text-slate-300 mb-1.5">Squad</label>\n                            <select\n                                value={selectedSquadId}', 
        '<label htmlFor="reg-squad" className="block text-sm font-medium text-slate-300 mb-1.5">Squad</label>\n                            <select id="reg-squad"\n                                value={selectedSquadId}'),
    ('frontend/src/pages/Register.jsx', 
        '<label className="block text-sm font-medium text-slate-300 mb-1.5">Job Role</label>\n                            <select\n                                value={customRoleId}', 
        '<label htmlFor="reg-role" className="block text-sm font-medium text-slate-300 mb-1.5">Job Role</label>\n                            <select id="reg-role"\n                                value={customRoleId}'),

    ('frontend/src/pages/Login.jsx', 
        '<label className="block text-sm font-medium text-slate-300 mb-1.5">Username</label>\n                            <input\n                                id="login-username"', 
        '<label htmlFor="login-username" className="block text-sm font-medium text-slate-300 mb-1.5">Username</label>\n                            <input\n                                id="login-username"'),
    ('frontend/src/pages/Login.jsx', 
        '<label className="block text-sm font-medium text-slate-300 mb-1.5">Password</label>\n                            <input\n                                id="login-password"', 
        '<label htmlFor="login-password" className="block text-sm font-medium text-slate-300 mb-1.5">Password</label>\n                            <input\n                                id="login-password"'),
        
    ('frontend/src/pages/ChangePassword.jsx', 
        '<label className="block text-sm font-medium text-slate-300 mb-1.5">Current Password</label>\n                            <input\n                                type="password"\n                                value={currentPassword}', 
        '<label htmlFor="cp-current" className="block text-sm font-medium text-slate-300 mb-1.5">Current Password</label>\n                            <input id="cp-current"\n                                type="password"\n                                value={currentPassword}'),
    ('frontend/src/pages/ChangePassword.jsx', 
        '<label className="block text-sm font-medium text-slate-300 mb-1.5">New Password</label>\n                            <input\n                                type="password"\n                                value={newPassword}', 
        '<label htmlFor="cp-new" className="block text-sm font-medium text-slate-300 mb-1.5">New Password</label>\n                            <input id="cp-new"\n                                type="password"\n                                value={newPassword}'),
    ('frontend/src/pages/ChangePassword.jsx', 
        '<label className="block text-sm font-medium text-slate-300 mb-1.5">Confirm New Password</label>\n                            <input\n                                type="password"\n                                value={confirmPassword}', 
        '<label htmlFor="cp-confirm" className="block text-sm font-medium text-slate-300 mb-1.5">Confirm New Password</label>\n                            <input id="cp-confirm"\n                                type="password"\n                                value={confirmPassword}'),
        
    ('frontend/src/pages/AdminConfig.jsx', 
        '<label className="font-semibold text-slate-800 block">{config.key}</label>\n                                        <input\n                                            type="number"', 
        '<label htmlFor={`config-${config.key}`} className="font-semibold text-slate-800 block">{config.key}</label>\n                                        <input id={`config-${config.key}`}\n                                            type="number"'),
    ('frontend/src/pages/AdminConfig.jsx', 
        '<label className="font-semibold text-slate-800 block">job_retention_days</label>\n                            <input\n                                type="number"', 
        '<label htmlFor="config-job-retention" className="font-semibold text-slate-800 block">job_retention_days</label>\n                            <input id="config-job-retention"\n                                type="number"'),
        
    ('frontend/src/pages/ActivityLog.jsx', 
        '<label className="flex items-center gap-3 text-sm font-medium text-slate-700 cursor-pointer">\n                            <input \n                                type="checkbox"', 
        '<label htmlFor="auto-refresh-toggle" className="flex items-center gap-3 text-sm font-medium text-slate-700 cursor-pointer">\n                            <input id="auto-refresh-toggle"\n                                type="checkbox"'),
        
    ('frontend/src/pages/ManageUsers.jsx', 
        '<label class="flex items-center gap-3 cursor-pointer p-3 border rounded-lg hover:bg-slate-50 transition-colors ${u.role === \'ADMIN\' ? \'border-indigo-500 bg-indigo-50\' : \'border-slate-200\'}">\n                        <input\n                            type="radio"', 
        '<label htmlFor={`role-admin-${u.id}`} class="flex items-center gap-3 cursor-pointer p-3 border rounded-lg hover:bg-slate-50 transition-colors ${u.role === \'ADMIN\' ? \'border-indigo-500 bg-indigo-50\' : \'border-slate-200\'}">\n                        <input id={`role-admin-${u.id}`}\n                            type="radio"'),
    ('frontend/src/pages/ManageUsers.jsx', 
        '<label class="flex items-center gap-3 cursor-pointer p-3 border rounded-lg hover:bg-slate-50 transition-colors ${u.role === \'USER\' ? \'border-blue-500 bg-blue-50\' : \'border-slate-200\'}">\n                        <input\n                            type="radio"', 
        '<label htmlFor={`role-user-${u.id}`} class="flex items-center gap-3 cursor-pointer p-3 border rounded-lg hover:bg-slate-50 transition-colors ${u.role === \'USER\' ? \'border-blue-500 bg-blue-50\' : \'border-slate-200\'}">\n                        <input id={`role-user-${u.id}`}\n                            type="radio"'),
    ('frontend/src/pages/ManageUsers.jsx', 
        '<label class="block text-sm font-medium text-slate-700 mb-1">Confirm with your Admin Password</label>\n                    <input\n                        type="password"', 
        '<label htmlFor="admin-confirm-password" class="block text-sm font-medium text-slate-700 mb-1">Confirm with your Admin Password</label>\n                    <input id="admin-confirm-password"\n                        type="password"'),
        
    ('frontend/src/pages/ManageUsers.jsx', 
        '<label className="block text-sm font-medium text-slate-700 mb-1">Username <span className="text-red-500">*</span></label>\n                                    <input\n                                        type="text"', 
        '<label htmlFor="mu-username" className="block text-sm font-medium text-slate-700 mb-1">Username <span className="text-red-500">*</span></label>\n                                    <input id="mu-username"\n                                        type="text"'),
    ('frontend/src/pages/ManageUsers.jsx', 
        '<label className="block text-sm font-medium text-slate-700 mb-1">Role <span className="text-red-500">*</span></label>\n                                    <select\n                                        value={formData.role}', 
        '<label htmlFor="mu-role" className="block text-sm font-medium text-slate-700 mb-1">Role <span className="text-red-500">*</span></label>\n                                    <select id="mu-role"\n                                        value={formData.role}'),
    ('frontend/src/pages/ManageUsers.jsx', 
        '<label className="block text-sm font-medium text-slate-700 mb-1">Job Role</label>\n                                    <select\n                                        value={formData.custom_role_id || \'\'}', 
        '<label htmlFor="mu-job-role" className="block text-sm font-medium text-slate-700 mb-1">Job Role</label>\n                                    <select id="mu-job-role"\n                                        value={formData.custom_role_id || \'\'}'),
    ('frontend/src/pages/ManageUsers.jsx', 
        '<label className="block text-sm font-medium text-slate-700 mb-1">Primary Department <span className="text-red-500">*</span></label>\n                                    <select\n                                        value={formData.department_id || \'\'}', 
        '<label htmlFor="mu-dept" className="block text-sm font-medium text-slate-700 mb-1">Primary Department <span className="text-red-500">*</span></label>\n                                    <select id="mu-dept"\n                                        value={formData.department_id || \'\'}'),
    ('frontend/src/pages/ManageUsers.jsx', 
        '<label className="block text-sm font-medium text-slate-700">Expire Date</label>\n                                        <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">\n                                            <input\n                                                type="checkbox"', 
        '<label htmlFor="mu-expire" className="block text-sm font-medium text-slate-700">Expire Date</label>\n                                        <label htmlFor="mu-no-expire" className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">\n                                            <input id="mu-no-expire"\n                                                type="checkbox"'),
    ('frontend/src/pages/ManageUsers.jsx', 
        '<input\n                                            type="date"\n                                            value={formData.expire_date || \'\'}', 
        '<input id="mu-expire"\n                                            type="date"\n                                            value={formData.expire_date || \'\'}'),
        
    ('frontend/src/pages/ManageRoles.jsx', 
        '<label className="block text-sm font-medium text-slate-700 mb-1">Role Name</label>\n                                    <input\n                                        type="text"', 
        '<label htmlFor="mr-role-name" className="block text-sm font-medium text-slate-700 mb-1">Role Name</label>\n                                    <input id="mr-role-name"\n                                        type="text"'),
    ('frontend/src/pages/ManageRoles.jsx', 
        '<label className="block text-sm font-medium text-slate-700 mb-1">Description (Optional)</label>\n                                    <textarea\n                                        value={formData.description}', 
        '<label htmlFor="mr-role-desc" className="block text-sm font-medium text-slate-700 mb-1">Description (Optional)</label>\n                                    <textarea id="mr-role-desc"\n                                        value={formData.description}'),
    ('frontend/src/pages/ManageRoles.jsx', 
        '<label className="block text-sm font-medium text-slate-700 mb-2">Menu Access Permissions</label>', 
        '<label id="mr-menu-perms-label" className="block text-sm font-medium text-slate-700 mb-2">Menu Access Permissions</label>'),
    ('frontend/src/pages/ManageRoles.jsx', 
        '<label key={menu.key} className="flex items-center gap-2 cursor-pointer p-1 rounded hover:bg-slate-100">\n                                                <input\n                                                    type="checkbox"', 
        '<label key={menu.key} htmlFor={`mr-menu-${menu.key}`} className="flex items-center gap-2 cursor-pointer p-1 rounded hover:bg-slate-100">\n                                                <input id={`mr-menu-${menu.key}`}\n                                                    type="checkbox"')
]

for filepath, old_str, new_str in replacements:
    if os.path.exists(filepath):
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
        if old_str in content:
            content = content.replace(old_str, new_str)
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(content)
            print(f"Replaced in {filepath}")
        else:
            print(f"Pattern not found in {filepath}: {old_str[:50]}...")
