/* eslint-disable react/prop-types */
import { useState, useEffect } from 'react';
import { Shield, Search, KeyRound, CheckCircle2, AlertCircle, RefreshCw, UserPlus, Loader2, Trash2, Building2, Plus, Check, X, CornerDownRight, XCircle, UserCog } from 'lucide-react';
import client from '../api/client';
import Swal from 'sweetalert2';
import clsx from 'clsx';
import { useAuth } from '../contexts/AuthContext';

function UserRowGroup({ u, rowNo, departments, roles, currentUser, refreshUsers, silentFetchUsers, onStatusChange, onResetPassword, onDeleteUser, onChangeRole, onChangeExpireDate }) {
    const [mainDraft, setMainDraft] = useState(null);
    const [supportDrafts, setSupportDrafts] = useState({});
    const [tempSupports, setTempSupports] = useState([]);

    const isMainEdited = mainDraft !== null;
    const currentDeptId = mainDraft?.department_id ?? u.department_id ?? '';
    const currentSquadId = mainDraft?.squad_id ?? u.squad_id ?? '';
    const currentCustomRoleId = mainDraft?.custom_role_id !== undefined ? mainDraft.custom_role_id : (u.custom_role_id ?? '');
    const currentExpireDate = mainDraft?.expire_date !== undefined ? mainDraft.expire_date : (u.expire_date ? u.expire_date.substring(0, 10) : '');
    const isSuperAdmin = currentUser?.role === 'ADMIN' && !currentUser?.custom_role_id;
    const todayStr = new Date().toISOString().split('T')[0];

    const selectedDepts = [
        currentDeptId,
        ...(u.support_roles || []).map(sr => supportDrafts[sr.id]?.department_id ?? sr.department_id),
        ...tempSupports.map(t => t.department_id)
    ].filter(Boolean).map(String);

    const isDeptDisabled = (deptId, currentVal) => String(deptId) !== String(currentVal) && selectedDepts.includes(String(deptId));

    const handleMainDraftChange = (field, value) => {
        setMainDraft(prev => ({
            department_id: currentDeptId,
            squad_id: currentSquadId,
            custom_role_id: currentCustomRoleId,
            expire_date: currentExpireDate,
            ...(prev || {}),
            [field]: value
        }));
    };

    const saveMain = async () => {
        try {
            if (mainDraft.department_id !== undefined || mainDraft.squad_id !== undefined || mainDraft.custom_role_id !== undefined) {
                await client.put(`/api/v1/users/${u.id}`, {
                    department_id: mainDraft.department_id ? Number(mainDraft.department_id) : null,
                    squad_id: mainDraft.squad_id ? Number(mainDraft.squad_id) : null,
                    custom_role_id: mainDraft.custom_role_id ? Number(mainDraft.custom_role_id) : null
                });
            }
            if (mainDraft.expire_date !== undefined) {
                await client.put(`/api/v1/users/${u.id}/expire`, {
                    expire_date: mainDraft.expire_date ? new Date(mainDraft.expire_date).toISOString() : null
                });
            }
            Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Saved', showConfirmButton: false, timer: 1500 });
            setMainDraft(null);
            silentFetchUsers();
        } catch (err) {
            Swal.fire('Error', err.response?.data?.detail || 'Failed to save', 'error');
        }
    };

    const cancelMain = () => setMainDraft(null);

    const handleSupportDraftChange = (srId, field, value) => {
        const sr = u.support_roles.find(r => r.id === srId);
        setSupportDrafts(prev => ({
            ...prev,
            [srId]: {
                department_id: prev[srId]?.department_id ?? sr.department_id ?? '',
                squad_id: prev[srId]?.squad_id ?? sr.squad_id ?? '',
                [field]: value
            }
        }));
    };

    const saveSupport = async (srId) => {
        const draft = supportDrafts[srId];
        if (!draft.department_id) {
            Swal.fire('Error', 'Department is required', 'error');
            return;
        }

        const sr = u.support_roles.find(r => r.id === srId);

        const updatedSupportRoles = u.support_roles.map(r => {
            if (r.id === srId) {
                return {
                    id: r.id,
                    department_id: Number(draft.department_id),
                    squad_id: draft.squad_id ? Number(draft.squad_id) : null,
                    custom_role_id: r.custom_role_id 
                };
            }
            return r;
        });

        try {
            await client.put(`/api/v1/users/${u.id}`, { support_roles: updatedSupportRoles });
            Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Saved', showConfirmButton: false, timer: 1500 });
            setSupportDrafts(prev => { const d = { ...prev }; delete d[srId]; return d; });
            silentFetchUsers();
        } catch (err) {
            Swal.fire('Error', err.response?.data?.detail || 'Failed to save', 'error');
        }
    };

    const deleteSupport = async (srId) => {
        const result = await Swal.fire({
            title: 'Remove Support Role?',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#ef4444',
            confirmButtonText: 'Yes, remove'
        });

        if (result.isConfirmed) {
            const updatedSupportRoles = u.support_roles.filter(sr => sr.id !== srId);
            try {
                await client.put(`/api/v1/users/${u.id}`, { support_roles: updatedSupportRoles });
                Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Removed', showConfirmButton: false, timer: 1500 });
                setSupportDrafts(prev => { const d = { ...prev }; delete d[srId]; return d; });
                silentFetchUsers();
            } catch (err) {
                Swal.fire('Error', err.response?.data?.detail || 'Failed to remove', 'error');
            }
        }
    };

    const addTempSupport = () => {
        setTempSupports(prev => [...prev, { id: Date.now().toString(), department_id: '', squad_id: '' }]);
    };

    const updateTempSupport = (id, field, value) => {
        setTempSupports(prev => prev.map(t => t.id === id ? { ...t, [field]: value } : t));
    };

    const saveTempSupport = async (id) => {
        const temp = tempSupports.find(t => t.id === id);
        if (!temp.department_id) {
            Swal.fire('Error', 'Department is required', 'error');
            return;
        }

        const newSupportRole = {
            department_id: Number(temp.department_id),
            squad_id: temp.squad_id ? Number(temp.squad_id) : null
        };

        const currentSupportRoles = u.support_roles || [];
        const payload = [...currentSupportRoles, newSupportRole];

        try {
            await client.put(`/api/v1/users/${u.id}`, { support_roles: payload });
            Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Added', showConfirmButton: false, timer: 1500 });
            setTempSupports(prev => prev.filter(t => t.id !== id));
            silentFetchUsers();
        } catch (err) {
            Swal.fire('Error', err.response?.data?.detail || 'Failed to add', 'error');
        }
    };

    return (
        <>
            <tr className="hover:bg-slate-50/50 transition-colors">
                <td className="py-3 px-4 text-center text-slate-400 text-sm">{rowNo}</td>
                <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                        <div className={clsx(
                            "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0",
                            u.role === 'ADMIN' ? 'bg-indigo-500' : 'bg-slate-400'
                        )}>
                            {u.username.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex flex-col gap-1">
                            <div className="font-medium text-slate-700 flex items-center gap-2 leading-none">
                                {u.username}
                                {currentUser?.id === u.id && (
                                    <span className="bg-blue-100 text-blue-700 text-[10px] px-1.5 py-0.5 rounded font-medium border border-blue-200 leading-none">YOU</span>
                                )}
                            </div>
                            <div className="flex items-center gap-1">
                                <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">{u.role}</span>
                                <span className="text-slate-300">•</span>
                                <select
                                    value={currentCustomRoleId}
                                    onChange={(e) => handleMainDraftChange('custom_role_id', e.target.value)}
                                    className="bg-white border border-slate-200 text-xs rounded px-1 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 text-slate-600 max-w-[120px]"
                                >
                                    <option value="">— No Job Role —</option>
                                    {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                                </select>
                            </div>
                        </div>
                    </div>
                </td>
                <td className="py-3 px-4">
                    <select
                        value={currentDeptId}
                        onChange={(e) => {
                            handleMainDraftChange('department_id', e.target.value);
                            handleMainDraftChange('squad_id', '');
                        }}
                        className="bg-white border border-slate-200 text-sm rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 text-slate-700 w-full min-w-[130px]"
                    >
                        <option value="">— Select Dept —</option>
                        {departments.map(d => <option key={d.id} value={d.id} disabled={isDeptDisabled(d.id, currentDeptId)}>{d.name}</option>)}
                    </select>
                </td>
                <td className="py-3 px-4 relative">
                    <div className="flex items-center gap-2">
                        <select
                            value={currentSquadId}
                            onChange={(e) => handleMainDraftChange('squad_id', e.target.value)}
                            disabled={!currentDeptId}
                            className="bg-white border border-slate-200 text-sm rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 text-slate-700 disabled:bg-slate-50 disabled:text-slate-400 w-full min-w-[130px]"
                        >
                            <option value="">— None —</option>
                            {(departments.find(d => d.id === Number(currentDeptId))?.squads || []).map(s => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                        </select>
                        <button
                            onClick={addTempSupport}
                            className="bg-blue-100 text-blue-600 hover:bg-blue-600 hover:text-white p-1 rounded-full transition-colors flex-shrink-0"
                            title="Add Support Dept/Squad"
                        >
                            <Plus size={14} />
                        </button>
                    </div>
                </td>
                <td className="py-3 px-4">
                    <select
                        value={u.status}
                        onChange={(e) => onStatusChange(u.id, u.status, e.target.value)}
                        disabled={u.id === currentUser?.id}
                        className={clsx(
                            "border text-xs font-semibold rounded-full px-3 py-1.5 focus:outline-none focus:ring-2 w-full text-center appearance-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-70",
                            u.status === 'ACTIVE' && "bg-emerald-50 text-emerald-700 border-emerald-200 focus:ring-emerald-500/20",
                            u.status === 'PENDING' && "bg-amber-50 text-amber-700 border-amber-200 focus:ring-amber-500/20",
                            u.status === 'SUSPENDED' && "bg-red-50 text-red-700 border-red-200 focus:ring-red-500/20"
                        )}
                    >
                        <option value="ACTIVE">● ACTIVE</option>
                        <option value="PENDING">● PENDING</option>
                        <option value="SUSPENDED">● SUSPENDED</option>
                    </select>
                </td>
                <td className="py-3 px-4 text-center">
                    {u.must_change_password ? (
                        <span className="inline-flex items-center justify-center gap-1 text-[10px] font-medium text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full" title="User must change password on next login">
                            <AlertCircle size={12} /> Pending Reset
                        </span>
                    ) : (
                        <span className="inline-flex items-center justify-center gap-1 text-[10px] font-medium text-slate-400" title="Password is secure">
                            <CheckCircle2 size={12} /> Secure
                        </span>
                    )}
                </td>
                <td className="py-3 px-4 text-center">
                    <div className="flex justify-center items-center h-[28px]">
                        {!currentExpireDate && !isMainEdited && mainDraft?.expire_date === undefined ? (
                            <button
                                onClick={() => handleMainDraftChange('expire_date', '')}
                                disabled={!isSuperAdmin && u.role === 'ADMIN'}
                                className="text-[11px] font-semibold text-slate-400 hover:text-blue-600 hover:bg-blue-50 px-2 py-1 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-transparent"
                            >
                                No Expire
                            </button>
                        ) : (
                            <input
                                type="date"
                                min={todayStr}
                                value={currentExpireDate}
                                onChange={(e) => handleMainDraftChange('expire_date', e.target.value)}
                                disabled={!isSuperAdmin && u.role === 'ADMIN'}
                                className={clsx(
                                    "bg-white border border-slate-200 text-[11px] rounded px-1.5 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 text-slate-700 disabled:bg-slate-50 disabled:text-slate-400 max-w-[110px]",
                                    !currentExpireDate && "text-transparent"
                                )}
                            />
                        )}
                    </div>
                </td>
                <td className="py-3 px-4 text-right">
                    <div className="flex justify-end gap-1 items-center">
                        {isMainEdited ? (
                            <>
                                <button onClick={saveMain} className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded" title="Save">
                                    <Check size={18} />
                                </button>
                                <button onClick={cancelMain} className="p-1.5 text-red-600 hover:bg-red-50 rounded" title="Cancel">
                                    <X size={18} />
                                </button>
                            </>
                        ) : (
                            <>
                                <div className="p-1.5 text-emerald-400" title="Saved">
                                    <Check size={18} />
                                </div>
                                {currentUser?.role === 'ADMIN' && !currentUser.custom_role_id && u.id !== currentUser?.id && (
                                    <button
                                        onClick={() => onChangeRole(u)}
                                        className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                                        title="Change System Role"
                                    >
                                        <UserCog size={18} />
                                    </button>
                                )}
                                <button
                                    onClick={() => onResetPassword(u.id, u.username)}
                                    className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                                    title="Reset Password"
                                >
                                    <KeyRound size={18} />
                                </button>
                                <button
                                    onClick={() => onDeleteUser(u.id, u.username)}
                                    className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                    title="Delete User"
                                >
                                    <Trash2 size={18} />
                                </button>
                            </>
                        )}
                    </div>
                </td>
            </tr>

            
            {u.support_roles?.map((sr, idx) => {
                const draft = supportDrafts[sr.id];
                const isEdited = !!draft;
                const deptId = draft?.department_id ?? sr.department_id ?? '';
                const squadId = draft?.squad_id ?? sr.squad_id ?? '';

                return (
                    <tr key={`sr-${sr.id}`} className="bg-slate-50/50 hover:bg-slate-50 border-b border-slate-100 last:border-b-0">
                        <td className="py-2 px-4"></td>
                        <td className="py-2 px-4 text-xs font-medium text-slate-400 flex items-center justify-end pr-8 gap-2">
                            <CornerDownRight size={14} className="text-blue-300" />
                            Support {idx + 1}
                        </td>
                        <td className="py-2 px-4">
                            <select
                                value={deptId}
                                onChange={e => {
                                    handleSupportDraftChange(sr.id, 'department_id', e.target.value);
                                    handleSupportDraftChange(sr.id, 'squad_id', '');
                                }}
                                className="bg-white border border-slate-200 text-sm rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 text-slate-700 w-full min-w-[130px]"
                            >
                                <option value="">— Select Dept —</option>
                                {departments.map(d => <option key={d.id} value={d.id} disabled={isDeptDisabled(d.id, deptId)}>{d.name}</option>)}
                            </select>
                        </td>
                        <td className="py-2 px-4">
                            <div className="flex items-center gap-2">
                                <select
                                    value={squadId}
                                    onChange={e => handleSupportDraftChange(sr.id, 'squad_id', e.target.value)}
                                    disabled={!deptId}
                                    className="bg-white border border-slate-200 text-sm rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 text-slate-700 w-full min-w-[130px] disabled:bg-slate-50 disabled:text-slate-400"
                                >
                                    <option value="">— None —</option>
                                    {(departments.find(d => d.id === Number(deptId))?.squads || []).map(s => (
                                        <option key={s.id} value={s.id}>{s.name}</option>
                                    ))}
                                </select>
                                <div className="w-[22px] shrink-0"></div>
                            </div>
                        </td>
                        <td colSpan="3"></td>
                        <td className="py-2 px-4 text-right">
                            <div className="flex justify-end gap-1 items-center">
                                {isEdited ? (
                                    <>
                                        <button onClick={() => saveSupport(sr.id)} className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded" title="Save Support">
                                            <Check size={16} />
                                        </button>
                                        <button onClick={() => setSupportDrafts(p => { const d = { ...p }; delete d[sr.id]; return d; })} className="p-1.5 text-red-600 hover:bg-red-50 rounded" title="Cancel">
                                            <X size={16} />
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <div className="p-1.5 text-emerald-400" title="Saved">
                                            <Check size={16} />
                                        </div>
                                        <button onClick={() => deleteSupport(sr.id)} className="p-1.5 text-slate-400 hover:text-red-500 rounded" title="Remove Support">
                                            <Trash2 size={16} />
                                        </button>
                                    </>
                                )}
                            </div>
                        </td>
                    </tr>
                );
            })}

            
            {tempSupports.map((temp) => (
                <tr key={temp.id} className="bg-blue-50/20 border-b border-slate-100">
                    <td className="py-2 px-4"></td>
                    <td className="py-2 px-4 text-xs font-bold text-blue-500 flex items-center justify-end pr-8 gap-2">
                        <CornerDownRight size={14} className="text-blue-400" />
                        New Support
                    </td>
                    <td className="py-2 px-4">
                        <select
                            value={temp.department_id}
                            onChange={e => {
                                updateTempSupport(temp.id, 'department_id', e.target.value);
                                updateTempSupport(temp.id, 'squad_id', '');
                            }}
                            className="bg-white border border-blue-200 text-sm rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 text-slate-700 w-full min-w-[130px]"
                        >
                            <option value="">— Select Dept —</option>
                            {departments.map(d => <option key={d.id} value={d.id} disabled={isDeptDisabled(d.id, temp.department_id)}>{d.name}</option>)}
                        </select>
                    </td>
                    <td className="py-2 px-4">
                        <div className="flex items-center gap-2">
                            <select
                                value={temp.squad_id}
                                onChange={e => updateTempSupport(temp.id, 'squad_id', e.target.value)}
                                disabled={!temp.department_id}
                                className="bg-white border border-blue-200 text-sm rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 text-slate-700 w-full min-w-[130px] disabled:bg-blue-50/50 disabled:text-slate-400"
                            >
                                <option value="">— None —</option>
                                {(departments.find(d => d.id === Number(temp.department_id))?.squads || []).map(s => (
                                    <option key={s.id} value={s.id}>{s.name}</option>
                                ))}
                            </select>
                            <div className="w-[22px] shrink-0"></div>
                        </div>
                    </td>
                    <td colSpan="3"></td>
                    <td className="py-2 px-4 text-right">
                        <div className="flex justify-end gap-1 items-center">
                            <button onClick={() => saveTempSupport(temp.id)} className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded bg-white shadow-sm" title="Save New Support">
                                <Check size={16} />
                            </button>
                            <button onClick={() => setTempSupports(p => p.filter(t => t.id !== temp.id))} className="p-1.5 text-red-600 hover:bg-red-50 rounded bg-white shadow-sm" title="Cancel">
                                <X size={16} />
                            </button>
                        </div>
                    </td>
                </tr>
            ))}
        </>
    );
}

export default function ManageUsers() {
    const { user: currentUser, logout } = useAuth();
    const [users, setUsers] = useState([]);
    const [departments, setDepartments] = useState([]);
    const [roles, setRoles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [deptFilter, setDeptFilter] = useState('');

    const isSuperAdmin = currentUser?.role === 'ADMIN' && !currentUser?.custom_role_id;

    
    const fullCurrentUser = users.find(u => u.id === currentUser?.id) || currentUser;
    const allowedDeptIds = fullCurrentUser ? [
        fullCurrentUser.department_id,
        ...(fullCurrentUser.support_roles?.map(sr => sr.department_id) || [])
    ].filter(Boolean) : [];

    const displayDepartments = isSuperAdmin
        ? departments
        : departments.filter(d => allowedDeptIds.includes(d.id));

    
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [newUsername, setNewUsername] = useState('');
    const [newRole, setNewRole] = useState('USER');
    const [newDeptId, setNewDeptId] = useState('');
    const [newSquadId, setNewSquadId] = useState('');
    const [newCustomRoleId, setNewCustomRoleId] = useState('');
    const [newExpireDate, setNewExpireDate] = useState('');
    const [newNoExpiry, setNewNoExpiry] = useState(false);

    const todayStr = new Date().toISOString().split('T')[0];

    const getPwdHtml = (username, password, msg) => `
        <div class="text-left mt-4">
            ${username ? `<p class="mb-1 text-slate-700">Username: <strong class="text-slate-900">${username}</strong></p>` : ''}
            <div class="flex items-center gap-2 mb-2 text-slate-700">
                <span>${username ? 'Generated Password:' : 'New Password:'}</span> 
                <code class="bg-slate-100 border border-slate-200 px-2 py-1 rounded text-red-500 font-bold tracking-wide">${password}</code>
                <button id="copy-pwd-btn" class="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors focus:outline-none flex items-center justify-center" title="Copy Credentials">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                </button>
            </div>
            <p class="text-sm text-slate-500 mt-2">${msg}</p>
        </div>
    `;

    const setupCopyBtn = (username, password, msg) => {
        const copyBtn = document.getElementById('copy-pwd-btn');
        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                const textToCopy = username 
                    ? `Username: ${username}\nPassword: ${password}\n\n${msg}`
                    : `Password: ${password}\n\n${msg}`;
                
                navigator.clipboard.writeText(textToCopy);
                
                const originalHtml = copyBtn.innerHTML;
                copyBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-emerald-500"><polyline points="20 6 9 17 4 12"></polyline></svg>';
                
                setTimeout(() => { 
                    if(document.body.contains(copyBtn)) {
                        copyBtn.innerHTML = originalHtml; 
                    }
                }, 1500);
            });
        }
    };

    const fetchUsers = async () => {
        setLoading(true);
        try {
            const res = await client.get('/api/v1/users');
            setUsers(res.data);
        } catch (err) {
            Swal.fire('Error', 'Failed to fetch users', 'error');
        } finally {
            setLoading(false);
        }
    };

    const silentFetchUsers = async () => {
        try {
            const res = await client.get('/api/v1/users');
            setUsers(res.data);
        } catch (err) {
            console.error('Silent fetch failed', err);
        }
    };

    const fetchDepartments = async () => {
        try {
            const res = await client.get('/api/v1/org/departments');
            setDepartments(res.data);
        } catch (err) {
            console.error('Failed to fetch departments', err);
        }
    };

    const fetchRoles = async () => {
        try {
            const res = await client.get('/api/v1/roles');
            setRoles(res.data);
        } catch (err) {
            console.error('Failed to fetch roles', err);
        }
    };

    useEffect(() => {
        fetchUsers();
        fetchDepartments();
        fetchRoles();
    }, []);

    useEffect(() => {
        const evtSource = new EventSource(`${client.defaults.baseURL || ''}/api/v1/jobs/stream`);

        const handleRealtimeUpdate = () => {
            silentFetchUsers();
        };

        evtSource.addEventListener("user_registered", handleRealtimeUpdate);
        evtSource.addEventListener("user_created", handleRealtimeUpdate);
        evtSource.addEventListener("user_status_changed", handleRealtimeUpdate);
        evtSource.addEventListener("user_role_changed", handleRealtimeUpdate);
        evtSource.addEventListener("user_org_updated", handleRealtimeUpdate);
        evtSource.addEventListener("user_approved", handleRealtimeUpdate);
        evtSource.addEventListener("user_deleted", handleRealtimeUpdate);
        evtSource.addEventListener("user_password_changed", handleRealtimeUpdate);

        return () => evtSource.close();
    }, []);

    const handleCreateUser = async (e) => {
        e.preventDefault();
        try {
            const payload = {
                username: newUsername,
                role: newRole,
                department_id: newDeptId ? Number(newDeptId) : null,
                squad_id: newSquadId ? Number(newSquadId) : null,
                custom_role_id: newCustomRoleId ? Number(newCustomRoleId) : null,
                support_roles: []
            };
            if (!newNoExpiry && newExpireDate) {
                payload.expire_date = new Date(newExpireDate).toISOString();
            }

            const res = await client.post('/api/v1/users', payload);
            setIsCreateModalOpen(false);
            setNewUsername('');
            setNewRole('USER');
            setNewDeptId('');
            setNewSquadId('');
            setNewCustomRoleId('');
            setNewExpireDate('');
            setNewNoExpiry(false);

            Swal.fire({
                icon: 'success',
                title: 'User Created',
                html: getPwdHtml(
                    res.data.user?.username || newUsername, 
                    res.data.generated_password, 
                    "Please save this password. The user will be required to change it on their first login."
                ),
                confirmButtonColor: '#3b82f6',
                didOpen: () => setupCopyBtn(
                    res.data.user?.username || newUsername, 
                    res.data.generated_password, 
                    "Please save this password. The user will be required to change it on their first login."
                )
            });
            fetchUsers();
        } catch (err) {
            Swal.fire('Error', err.response?.data?.detail || 'Failed to create user', 'error');
        }
    };

    const handleStatusChange = async (userId, currentStatus, newStatus) => {
        if (userId === currentUser?.id) {
            Swal.fire('Warning', 'You cannot change your own status', 'warning');
            return;
        }

        try {
            const res = await client.put(`/api/v1/users/${userId}/status`, { status: newStatus });

            if (res.data.generated_password) {
                Swal.fire({
                    icon: 'success',
                    title: 'User Approved',
                    html: getPwdHtml(
                        res.data.username,
                        res.data.generated_password,
                        "Please share these credentials with the user. They will be required to change the password on first login."
                    ),
                    confirmButtonColor: '#3b82f6',
                    didOpen: () => setupCopyBtn(
                        res.data.username, 
                        res.data.generated_password, 
                        "Please share these credentials with the user. They will be required to change the password on first login."
                    )
                });
            } else {
                Swal.fire({
                    toast: true, position: 'top-end', icon: 'success', title: 'Status updated', showConfirmButton: false, timer: 1500
                });
            }
            silentFetchUsers();
        } catch (err) {
            Swal.fire('Error', err.response?.data?.detail || 'Failed to update status', 'error');
        }
    };

    const handleResetPassword = async (userId, username) => {
        const result = await Swal.fire({
            title: 'Reset Password',
            text: `Are you sure you want to reset the password for ${username}?`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            cancelButtonColor: '#3085d6',
            confirmButtonText: 'Yes, reset and kick out'
        });

        if (result.isConfirmed) {
            try {
                const res = await client.post(`/api/v1/users/${userId}/reset-password`);
                Swal.fire({
                    icon: 'success',
                    title: 'Password Reset Successful',
                    html: getPwdHtml(
                        username,
                        res.data.generated_password,
                        userId === currentUser?.id 
                            ? "Please copy this password. You will be logged out when you close this popup."
                            : "The user has been forced to logout. They will be required to change this password on their next login."
                    ),
                    confirmButtonColor: '#3b82f6',
                    didOpen: () => setupCopyBtn(
                        username, 
                        res.data.generated_password, 
                        userId === currentUser?.id 
                            ? "Please copy this password. You will be logged out when you close this popup."
                            : "The user has been forced to logout. They will be required to change this password on their next login."
                    )
                }).then(() => {
                    if (userId === currentUser?.id) {
                        // User reset their own password, log them out manually after they close the popup
                        logout();
                    }
                });
                silentFetchUsers();
            } catch (err) {
                Swal.fire('Error', err.response?.data?.detail || 'Failed to reset password', 'error');
            }
        }
    };

    const handleDeleteUser = async (userId, username) => {
        if (userId === currentUser?.id) {
            Swal.fire('Warning', 'You cannot delete your own account', 'warning');
            return;
        }

        const { value: password } = await Swal.fire({
            title: 'Delete User',
            html: `
                <p class="mb-4 text-sm text-slate-500">Are you sure you want to delete user <strong>${username}</strong>?</p>
                <form id="delete-form" class="m-0">
                    <input type="password" id="admin-password" class="swal2-input" placeholder="Enter your Admin password to confirm" style="margin-top:0">
                </form>
            `,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#ef4444',
            confirmButtonText: 'Delete User',
            didOpen: () => {
                const form = document.getElementById('delete-form');
                const input = document.getElementById('admin-password');
                input.focus();
                form.addEventListener('submit', (e) => {
                    e.preventDefault();
                    Swal.clickConfirm();
                });
            },
            preConfirm: () => {
                const pass = document.getElementById('admin-password').value;
                if (!pass) Swal.showValidationMessage('Password is required');
                return pass;
            }
        });

        if (password) {
            try {
                await client.post(`/api/v1/users/${userId}/delete`, { admin_password: password });
                Swal.fire('Deleted!', 'The user has been successfully deleted.', 'success');
                silentFetchUsers();
            } catch (err) {
                Swal.fire('Error', err.response?.data?.detail || 'Failed to delete user', 'error');
            }
        }
    };

    const handleChangeRole = async (u) => {
        const result = await Swal.fire({
            title: `Change Role for ${u.username}`,
            html: `
                <div class="flex flex-col gap-3 text-left mt-4">
                    <label for="swal-role-admin" class="flex items-center gap-3 cursor-pointer p-3 border rounded-lg hover:bg-slate-50 transition-colors ${u.role === 'ADMIN' ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200'}">
                        <input id="swal-role-admin" type="radio" name="swal-role" value="ADMIN" ${u.role === 'ADMIN' ? 'checked' : ''} class="w-4 h-4 text-indigo-600 focus:ring-indigo-500">
                        <div class="flex flex-col">
                            <span class="font-bold text-indigo-900">Admin</span>
                            <span class="text-xs text-slate-500">Full system access</span>
                        </div>
                    </label>
                    <label for="swal-role-user" class="flex items-center gap-3 cursor-pointer p-3 border rounded-lg hover:bg-slate-50 transition-colors ${u.role === 'USER' ? 'border-blue-500 bg-blue-50' : 'border-slate-200'}">
                        <input id="swal-role-user" type="radio" name="swal-role" value="USER" ${u.role === 'USER' ? 'checked' : ''} class="w-4 h-4 text-blue-600 focus:ring-blue-500">
                        <div class="flex flex-col">
                            <span class="font-bold text-slate-900">User</span>
                            <span class="text-xs text-slate-500">Limited access based on job roles</span>
                        </div>
                    </label>
                </div>
                <div class="mt-6 text-left">
                    <label for="swal-admin-password" class="block text-sm font-medium text-slate-700 mb-1">Confirm with your Admin Password</label>
                    <input type="password" id="swal-admin-password" class="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" placeholder="Enter password...">
                </div>
            `,
            showCancelButton: true,
            confirmButtonText: 'Save Changes',
            confirmButtonColor: '#4f46e5',
            didOpen: () => {
                const pwdInput = document.getElementById('swal-admin-password');
                pwdInput.focus();
                pwdInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') { e.preventDefault(); Swal.clickConfirm(); }
                });
            },
            preConfirm: () => {
                const selected = document.querySelector('input[name="swal-role"]:checked');
                const password = document.getElementById('swal-admin-password').value;
                if (!selected) {
                    Swal.showValidationMessage('Please select a role');
                    return false;
                }
                if (!password) {
                    Swal.showValidationMessage('Admin password is required');
                    return false;
                }
                return { role: selected.value, admin_password: password };
            }
        });

        if (result.isConfirmed && result.value) {
            if (result.value.role === u.role) {
                Swal.fire({ toast: true, position: 'top-end', icon: 'info', title: 'No changes made', showConfirmButton: false, timer: 1500 });
                return;
            }
            try {
                await client.put(`/api/v1/users/${u.id}/role`, { role: result.value.role, admin_password: result.value.admin_password });
                Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Role updated', showConfirmButton: false, timer: 1500 });
                silentFetchUsers();
            } catch (err) {
                Swal.fire('Error', err.response?.data?.detail || 'Failed to update role', 'error');
            }
        }
    };

    const handleChangeExpireDate = async (userId, dateStr) => {
        try {
            const payload = { expire_date: dateStr ? new Date(dateStr).toISOString() : null };
            await client.put(`/api/v1/users/${userId}/expire`, payload);
            Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Expire date updated', showConfirmButton: false, timer: 1500 });
            silentFetchUsers();
        } catch (err) {
            Swal.fire('Error', err.response?.data?.detail || 'Failed to update expire date', 'error');
        }
    };

    
    const filteredUsers = users.filter(u => {
        if (!isSuperAdmin) {
            if (u.role === 'ADMIN') return false; 

            const userDeptIds = [u.department_id, ...(u.support_roles?.map(sr => sr.department_id) || [])].filter(Boolean);
            const hasAccessToUser = userDeptIds.some(id => allowedDeptIds.includes(id));
            if (!hasAccessToUser) return false;
        }

        const matchesSearch = u.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (u.department_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
            (u.custom_role_name || '').toLowerCase().includes(searchTerm.toLowerCase());

        const matchesDept = deptFilter ? (u.department_id === Number(deptFilter) || u.support_roles?.some(sr => sr.department_id === Number(deptFilter))) : true;

        return matchesSearch && matchesDept;
    });

    const groupUsers = (userList) => {
        const adminUsers = userList.filter(u => u.role === 'ADMIN');
        const nonAdminUsers = userList.filter(u => u.role !== 'ADMIN');

        const deptMap = {};
        const noDeptUsers = [];

        nonAdminUsers.forEach(u => {
            const deptName = u.department_name || null;
            if (deptName) {
                if (!deptMap[deptName]) deptMap[deptName] = [];
                deptMap[deptName].push(u);
            } else {
                noDeptUsers.push(u);
            }
        });

        const sortedDeptNames = Object.keys(deptMap).sort((a, b) => a.localeCompare(b));
        const groups = [];

        if (adminUsers.length > 0) {
            groups.push({ label: 'Admin', icon: 'admin', users: adminUsers });
        }

        sortedDeptNames.forEach(deptName => {
            groups.push({ label: deptName, icon: 'dept', users: deptMap[deptName] });
        });

        if (noDeptUsers.length > 0) {
            groups.push({ label: 'Unassigned', icon: 'none', users: noDeptUsers });
        }

        return groups;
    };

    const groups = groupUsers(filteredUsers);
    let rowCounter = 0;

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                        <Shield className="w-6 h-6 text-blue-600" />
                        Manage Users
                    </h2>
                    <p className="text-slate-500 text-sm mt-1">
                        Control access, approve registrations, and manage roles
                    </p>
                </div>

                <button
                    onClick={() => setIsCreateModalOpen(true)}
                    className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors shadow-sm whitespace-nowrap font-medium"
                >
                    <UserPlus size={18} />
                    <span>Create User</span>
                </button>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden flex flex-col min-h-[500px]">
                <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center gap-4 flex-wrap">
                    <div className="relative flex-1 max-w-md min-w-[200px]">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Search users..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm"
                        />
                    </div>

                    
                    <div className="flex items-center gap-2">
                        <div className="w-48 relative">
                            <select
                                value={deptFilter}
                                onChange={(e) => setDeptFilter(e.target.value)}
                                className="w-full pl-3 pr-8 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm bg-white appearance-none"
                            >
                                <option value="">All Departments</option>
                                {displayDepartments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                            </select>
                            <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none text-slate-400">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                            </div>
                        </div>
                        {deptFilter && (
                            <button
                                onClick={() => setDeptFilter('')}
                                className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                title="Clear filter"
                            >
                                <XCircle size={18} />
                            </button>
                        )}
                    </div>

                    <button
                        onClick={() => { fetchUsers(); fetchDepartments(); }}
                        className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors ml-auto"
                        title="Refresh list"
                    >
                        <RefreshCw size={20} className={clsx(loading && "animate-spin")} />
                    </button>
                </div>

                <div className="flex-1 overflow-auto">
                    <table className="w-full text-left border-collapse min-w-[1000px]">
                        <thead>
                            <tr className="border-b border-slate-200 bg-white sticky top-0 z-10 shadow-sm text-sm font-semibold text-slate-600">
                                <th className="py-3 px-4 w-12 text-center">No.</th>
                                <th className="py-3 px-4 w-56">Username (Job Role)</th>
                                <th className="py-3 px-4 w-40">Department</th>
                                <th className="py-3 px-4 w-48">Squad</th>
                                <th className="py-3 px-4 w-36">Status</th>
                                <th className="py-3 px-4 w-28 text-center">Security</th>
                                <th className="py-3 px-4 w-32 text-center">Expire Date</th>
                                <th className="py-3 px-4 w-32 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {loading && users.length === 0 ? (
                                <tr>
                                    <td colSpan="8" className="py-8 text-center text-slate-500">
                                        <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-500" />
                                        Loading users...
                                    </td>
                                </tr>
                            ) : groups.length === 0 ? (
                                <tr>
                                    <td colSpan="8" className="py-8 text-center text-slate-500">
                                        No users found
                                    </td>
                                </tr>
                            ) : (
                                groups.map((group, gi) => {
                                    const groupColor = group.icon === 'admin'
                                        ? 'bg-indigo-50 text-indigo-700 border-indigo-100'
                                        : group.icon === 'dept'
                                            ? 'bg-blue-50 text-blue-700 border-blue-100'
                                            : 'bg-slate-50 text-slate-500 border-slate-100';
                                    const groupIconEl = group.icon === 'admin'
                                        ? <Shield size={14} />
                                        : <Building2 size={14} />;

                                    return [
                                        <tr key={`group-${gi}`} className={clsx("border-b", groupColor)}>
                                            <td colSpan="8" className="py-2 px-4">
                                                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider">
                                                    {groupIconEl}
                                                    {group.label}
                                                    <span className="text-[10px] font-normal opacity-70 lowercase tracking-normal">
                                                        ({group.users.length} {group.users.length === 1 ? 'user' : 'users'})
                                                    </span>
                                                </div>
                                            </td>
                                        </tr>,
                                        ...group.users.map((u) => {
                                            rowCounter++;
                                            return <UserRowGroup
                                                key={u.id}
                                                u={u}
                                                rowNo={rowCounter}
                                                departments={displayDepartments}
                                                roles={roles}
                                                currentUser={currentUser}
                                                refreshUsers={fetchUsers}
                                                silentFetchUsers={silentFetchUsers}
                                                onStatusChange={handleStatusChange}
                                                onResetPassword={handleResetPassword}
                                                onDeleteUser={handleDeleteUser}
                                                onChangeRole={handleChangeRole}
                                                onChangeExpireDate={handleChangeExpireDate}
                                            />;
                                        })
                                    ];
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            
            {isCreateModalOpen && (
                <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                            <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                                <UserPlus className="w-5 h-5 text-blue-600" />
                                Create New User
                            </h3>
                            <button
                                onClick={() => setIsCreateModalOpen(false)}
                                className="p-1 hover:bg-slate-100 rounded-full text-slate-400 transition-colors"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <form onSubmit={handleCreateUser} className="p-6">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="sm:col-span-2">
                                    <label htmlFor="mu-username" className="block text-sm font-medium text-slate-700 mb-1">Username <span className="text-red-500">*</span></label>
                                    <input id="mu-username"
                                        type="text"
                                        value={newUsername}
                                        onChange={(e) => setNewUsername(e.target.value)}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                        placeholder="Enter username"
                                        required
                                        autoFocus
                                    />
                                </div>

                                <div>
                                    <label htmlFor="mu-role" className="block text-sm font-medium text-slate-700 mb-1">Role <span className="text-red-500">*</span></label>
                                    <select
                                        id="mu-role"
                                        value={newRole}
                                        onChange={(e) => setNewRole(e.target.value)}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                                    >
                                        <option value="USER">User</option>
                                        <option value="ADMIN">Admin</option>
                                    </select>
                                </div>

                                <div>
                                    <label htmlFor="mu-job-role" className="block text-sm font-medium text-slate-700 mb-1">Job Role</label>
                                    <select
                                        id="mu-job-role"
                                        value={newCustomRoleId}
                                        onChange={(e) => setNewCustomRoleId(e.target.value)}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                                    >
                                        <option value="">— Select Job Role —</option>
                                        {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                                    </select>
                                </div>

                                <div className="sm:col-span-2">
                                    <label htmlFor="mu-dept" className="block text-sm font-medium text-slate-700 mb-1">Primary Department <span className="text-red-500">*</span></label>
                                    <select
                                        id="mu-dept"
                                        value={newDeptId}
                                        onChange={(e) => {
                                            setNewDeptId(e.target.value);
                                            setNewSquadId('');
                                        }}
                                        required
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                                    >
                                        <option value="">— Select Department —</option>
                                        {displayDepartments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                                    </select>
                                </div>

                                <div className="sm:col-span-2">
                                    <label htmlFor="mu-squad" className="block text-sm font-medium text-slate-700 mb-1">Squad</label>
                                    <select
                                        id="mu-squad"
                                        value={newSquadId}
                                        onChange={(e) => setNewSquadId(e.target.value)}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white disabled:bg-slate-50 disabled:text-slate-400"
                                        disabled={!newDeptId}
                                    >
                                        <option value="">— No Squad —</option>
                                        {(displayDepartments.find(d => d.id === Number(newDeptId))?.squads || []).map(s => (
                                            <option key={s.id} value={s.id}>{s.name}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="sm:col-span-2">
                                    <div className="flex items-center justify-between mb-1">
                                        <label htmlFor="mu-expire" className="block text-sm font-medium text-slate-700">Expire Date</label>
                                        <label htmlFor="mu-no-expire" className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                                            <div className="relative">
                                                <input
                                                    id="mu-no-expire"
                                                    type="checkbox"
                                                    checked={newNoExpiry}
                                                    onChange={(e) => {
                                                        setNewNoExpiry(e.target.checked);
                                                        if (e.target.checked) setNewExpireDate('');
                                                    }}
                                                    className="sr-only peer"
                                                />
                                                <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                                            </div>
                                            No Expiry
                                        </label>
                                    </div>
                                    <input
                                        type="date"
                                        min={todayStr}
                                        value={newExpireDate}
                                        onChange={(e) => setNewExpireDate(e.target.value)}
                                        disabled={newNoExpiry}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50 disabled:text-slate-400"
                                    />
                                </div>

                                <div className="sm:col-span-2 bg-blue-50 border border-blue-100 rounded-lg p-3 flex gap-3 text-sm text-blue-800 mt-2">
                                    <AlertCircle className="w-5 h-5 shrink-0 text-blue-600" />
                                    <p>A random password will be generated automatically. The user will be required to change it upon their first login.</p>
                                </div>
                            </div>

                            <div className="mt-8 flex justify-end gap-3">
                                <button
                                    type="button"
                                    onClick={() => setIsCreateModalOpen(false)}
                                    className="px-4 py-2 border border-slate-200 text-slate-600 font-medium rounded-lg hover:bg-slate-50 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow-sm transition-colors"
                                >
                                    Create User
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}