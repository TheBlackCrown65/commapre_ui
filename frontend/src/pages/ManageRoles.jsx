/* eslint-disable react/prop-types */
import { useState, useEffect } from 'react';
import { ShieldCheck, Plus, Pencil, Trash2, X, Check } from 'lucide-react';
import client from '../api/client';
import Swal from 'sweetalert2';

export default function ManageRoles() {
    const [roles, setRoles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editingRole, setEditingRole] = useState(null);
    const [formData, setFormData] = useState({ name: '', description: '', menu_permissions: ['dashboard', 'run', 'setting'] });

    const availableMenus = [
        { key: 'dashboard', label: 'Dashboard' },
        { key: 'run', label: 'Run Test' },
        { key: 'setting', label: 'Settings' },
        { key: 'org', label: 'Organization' },
        { key: 'manage-users', label: 'Manage Users' },
        { key: 'manage-roles', label: 'Manage Roles' },
        { key: 'api-keys', label: 'API Keys' },
        { key: 'config', label: 'System Config' },
        { key: 'monitor', label: 'System Monitor' },
        { key: 'activity-log', label: 'Activity Log' }
    ];

    const fetchRoles = async () => {
        try {
            const res = await client.get('/api/v1/roles');
            const sortedRoles = res.data.sort((a, b) => a.name.localeCompare(b.name));
            setRoles(sortedRoles);
        } catch (error) {
            console.error('Error fetching roles:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchRoles();
    }, []);

    const handleSave = async (e) => {
        e.preventDefault();
        try {
            if (editingRole) {
                await client.put(`/api/v1/roles/${editingRole.id}`, formData);
                Swal.fire('Success', 'Role updated successfully', 'success');
            } else {
                await client.post('/api/v1/roles', formData);
                Swal.fire('Success', 'Role created successfully', 'success');
            }
            setShowModal(false);
            fetchRoles();
        } catch (error) {
            Swal.fire('Error', error.response?.data?.detail || 'Failed to save role', 'error');
        }
    };

    const handleDelete = async (role) => {
        const result = await Swal.fire({
            title: 'Are you sure?',
            text: `You are about to delete role "${role.name}"`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Yes, delete it!'
        });

        if (result.isConfirmed) {
            try {
                await client.delete(`/api/v1/roles/${role.id}`);
                Swal.fire('Deleted!', 'Role has been deleted.', 'success');
                fetchRoles();
            } catch (error) {
                Swal.fire('Error', error.response?.data?.detail || 'Failed to delete role', 'error');
            }
        }
    };

    const togglePermission = (key) => {
        setFormData(prev => {
            const perms = prev.menu_permissions.includes(key)
                ? prev.menu_permissions.filter(p => p !== key)
                : [...prev.menu_permissions, key];
            return { ...prev, menu_permissions: perms };
        });
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                        <ShieldCheck className="text-blue-600" /> Manage Roles
                    </h1>
                    <p className="text-slate-500 text-sm mt-1">Configure job roles and menu permissions</p>
                </div>
                <button
                    onClick={() => {
                        setEditingRole(null);
                        setFormData({ name: '', description: '', menu_permissions: ['dashboard', 'run', 'setting'] });
                        setShowModal(true);
                    }}
                    className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
                >
                    <Plus size={20} />
                    New Role
                </button>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium text-sm">
                                <th className="p-4 w-16 text-center">No.</th>
                                <th className="p-4">Role Name</th>
                                <th className="p-4">Description</th>
                                <th className="p-4">Menu Access</th>
                                <th className="p-4 text-center">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {loading ? (
                                <tr>
                                    <td colSpan="5" className="p-8 text-center text-slate-500">Loading roles...</td>
                                </tr>
                            ) : roles.length === 0 ? (
                                <tr>
                                    <td colSpan="5" className="p-8 text-center text-slate-500">No roles found. Create one to get started.</td>
                                </tr>
                            ) : (
                                roles.map((role, index) => (
                                    <tr key={role.id} className="hover:bg-slate-50 transition-colors">
                                        <td className="p-4 text-center text-slate-500">{index + 1}</td>
                                        <td className="p-4 font-semibold text-slate-800">{role.name}</td>
                                        <td className="p-4 text-slate-500">{role.description || '-'}</td>
                                        <td className="p-4">
                                            <div className="flex flex-wrap gap-1">
                                                {role.menu_permissions.map(p => (
                                                    <span key={p} className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded-full font-medium">
                                                        {p}
                                                    </span>
                                                ))}
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            <div className="flex justify-center gap-2">
                                                <button
                                                    onClick={() => {
                                                        setEditingRole(role);
                                                        setFormData({
                                                            name: role.name,
                                                            description: role.description || '',
                                                            menu_permissions: role.menu_permissions
                                                        });
                                                        setShowModal(true);
                                                    }}
                                                    className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                                    title="Edit"
                                                >
                                                    <Pencil size={18} />
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(role)}
                                                    className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                                    title="Delete"
                                                >
                                                    <Trash2 size={18} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Role Modal */}
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
                        <div className="p-4 sm:p-6 border-b border-slate-200 flex justify-between items-center bg-slate-50 shrink-0">
                            <h2 className="text-xl font-bold text-slate-800">
                                {editingRole ? 'Edit Role' : 'Create New Role'}
                            </h2>
                            <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600 transition-colors">
                                <X size={24} />
                            </button>
                        </div>

                        <div className="p-4 sm:p-6 overflow-y-auto">
                            <form id="roleForm" onSubmit={handleSave} className="space-y-4">
                                <div>
                                    <label htmlFor="mr-role-name" className="block text-sm font-medium text-slate-700 mb-1">Role Name</label>
                                    <input id="mr-role-name"
                                        type="text"
                                        required
                                        value={formData.name}
                                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                                        className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                        placeholder="e.g., QA, Developer, BA"
                                    />
                                </div>
                                <div>
                                    <label htmlFor="mr-role-desc" className="block text-sm font-medium text-slate-700 mb-1">Description (Optional)</label>
                                    <input
                                        id="mr-role-desc"
                                        type="text"
                                        value={formData.description}
                                        onChange={e => setFormData({ ...formData, description: e.target.value })}
                                        className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    />
                                </div>
                                <div>
                                    <div id="mr-menu-perms-label" className="block text-sm font-medium text-slate-700 mb-2">Menu Access Permissions</div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 border border-slate-200 p-4 rounded-lg bg-slate-50">
                                        {availableMenus.map(menu => (
                                            <label key={menu.key} htmlFor={`mr-menu-${menu.key}`} className="flex items-center gap-2 cursor-pointer p-1 rounded hover:bg-slate-100">
                                                <input id={`mr-menu-${menu.key}`}
                                                    type="checkbox"
                                                    checked={formData.menu_permissions.includes(menu.key)}
                                                    onChange={() => togglePermission(menu.key)}
                                                    className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                                                />
                                                <span className="text-sm text-slate-700">{menu.label}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            </form>
                        </div>

                        <div className="p-4 sm:p-6 border-t border-slate-200 flex justify-end gap-3 bg-slate-50 shrink-0">
                            <button
                                type="button"
                                onClick={() => setShowModal(false)}
                                className="px-4 py-2 text-slate-700 font-medium hover:bg-slate-200 rounded-lg transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                form="roleForm"
                                className="px-4 py-2 bg-blue-600 text-white font-medium hover:bg-blue-700 rounded-lg transition-colors flex items-center gap-2"
                            >
                                <Check size={18} />
                                {editingRole ? 'Update' : 'Create'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
