/* eslint-disable react/prop-types */
import { useState, useEffect } from 'react';
import client from '../api/client';
import { Building2, Users, Plus, Trash2, Edit2, ChevronRight, Loader2 } from 'lucide-react';
import Swal from 'sweetalert2';
import { useAuth } from '../contexts/AuthContext';

export default function OrgSettings() {
    const { user } = useAuth();
    const isSuperAdmin = user?.role === 'ADMIN' && !user?.custom_role_id;
    // Any user reaching this page has the 'org' menu permission, 
    // so they are allowed to manage squads in the departments they see.
    const canManageSquads = true;

    const [departments, setDepartments] = useState([]);
    const [selectedDept, setSelectedDept] = useState(null);
    const [loading, setLoading] = useState(true);
    const [globalMaxImages, setGlobalMaxImages] = useState('');

    const fetchDepartments = async (silent = false) => {
        try {
            if (!silent) setLoading(true);
            const res = await client.get('/api/v1/org/departments');
            setDepartments(res.data);

            // Sync selectedDept with fresh data from server
            setSelectedDept(prev => {
                if (!prev) return res.data.length > 0 ? res.data[0] : null;
                const updated = res.data.find(d => d.id === prev.id);
                return updated || res.data[0] || null;
            });
        } catch (err) {
            console.error(err);
        } finally {
            if (!silent) setLoading(false);
        }
    };

    useEffect(() => {
        fetchDepartments();

        // Fetch global config
        client.get('/api/v1/config')
            .then(res => {
                const maxImgConfig = res.data.find(c => c.key === 'max_images_per_flow');
                if (maxImgConfig) setGlobalMaxImages(maxImgConfig.value);
            })
            .catch(err => console.error("Failed to load global config:", err));

        // 🟢 Real-time SSE updates
        const API_URL = client.defaults.baseURL || '';
        const eventSource = new EventSource(`${API_URL}/api/v1/jobs/stream`);

        const handleUpdate = () => {
            fetchDepartments(true); // Fetch silently to avoid flickering
        };

        eventSource.addEventListener('dept_created', handleUpdate);
        eventSource.addEventListener('dept_deleted', handleUpdate);
        eventSource.addEventListener('dept_updated', handleUpdate);
        eventSource.addEventListener('squad_created', handleUpdate);
        eventSource.addEventListener('squad_deleted', handleUpdate);
        eventSource.addEventListener('squad_updated', handleUpdate);

        return () => {
            eventSource.close();
        };
    }, []);

    // --- Department Actions ---
    const handleAddDepartment = async () => {
        const { value: formValues } = await Swal.fire({
            title: 'Create New Department',
            html: `
                <input id="swal-input1" class="swal2-input" placeholder="Department Name">
                ${isSuperAdmin ? `<div class="mt-4 text-sm text-left px-1 text-slate-500">Max Images Per Flow (Override) - Optional</div><input id="swal-input2" type="number" min="1" class="swal2-input mt-1" placeholder="Global default is ${globalMaxImages}" value="">` : ''}
            `,
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: 'Create',
            cancelButtonText: 'Cancel',
            preConfirm: () => {
                const name = document.getElementById('swal-input1').value;
                const imagesStr = isSuperAdmin ? document.getElementById('swal-input2').value : '';
                if (!name) {
                    Swal.showValidationMessage('Department Name is required');
                }
                return { 
                    name, 
                    max_images_per_flow: imagesStr ? Number.parseInt(imagesStr, 10) : null 
                };
            }
        });

        if (formValues) {
            try {
                await client.post('/api/v1/org/departments', formValues);
                // No need to fetchDepartments() manually, SSE will trigger it
                Swal.fire('Success', 'Department created successfully', 'success');
            } catch (err) {
                Swal.fire('Error', err.response?.data?.detail || 'Failed', 'error');
            }
        }
    };

    const handleRenameDepartment = async (dept) => {
        const { value: formValues } = await Swal.fire({
            title: 'Rename Department',
            html: `
                <input id="swal-input1" class="swal2-input" placeholder="Department Name" value="${dept.name}">
                ${isSuperAdmin ? `<div class="mt-4 text-sm text-left px-1 text-slate-500">Max Images Per Flow (Override) - Optional</div><input id="swal-input2" type="number" min="1" class="swal2-input mt-1" placeholder="Global default is ${globalMaxImages}" value="${dept.max_images_per_flow || ''}">` : ''}
            `,
            showCancelButton: true,
            preConfirm: () => {
                const name = document.getElementById('swal-input1').value;
                const imagesStr = isSuperAdmin ? document.getElementById('swal-input2').value : '';
                return { 
                    name, 
                    max_images_per_flow: imagesStr ? Number.parseInt(imagesStr, 10) : null 
                };
            }
        });
        if (formValues) {
            // Check if anything actually changed
            if (formValues.name === dept.name && formValues.max_images_per_flow === dept.max_images_per_flow) {
                return; // no change
            }
            try {
                await client.put(`/api/v1/org/departments/${dept.id}`, formValues);
                fetchDepartments(true);
            } catch (err) {
                Swal.fire('Error', err.response?.data?.detail || 'Failed', 'error');
            }
        }
    };

    const handleDeleteDepartment = async (dept) => {
        const result = await Swal.fire({
            title: `Delete "${dept.name}"?`,
            text: 'All Squads inside will also be deleted!',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#ef4444',
            confirmButtonText: 'Delete',
            cancelButtonText: 'Cancel',
        });
        if (result.isConfirmed) {
            try {
                await client.delete(`/api/v1/org/departments/${dept.id}`);
                // SSE will handle refresh
            } catch (err) {
                Swal.fire('Error', err.response?.data?.detail || 'Failed', 'error');
            }
        }
    };

    // --- Squad Actions ---
    const handleAddSquad = async () => {
        if (!selectedDept) return;
        const { value: name } = await Swal.fire({
            title: `Create Squad in "${selectedDept.name}"`,
            input: 'text',
            inputPlaceholder: 'Squad Name',
            showCancelButton: true,
            confirmButtonText: 'Create',
            cancelButtonText: 'Cancel',
        });
        if (name) {
            try {
                await client.post('/api/v1/org/squads', { name, department_id: selectedDept.id });
                // SSE will handle refresh
                Swal.fire('Success', 'Squad created successfully', 'success');
            } catch (err) {
                Swal.fire('Error', err.response?.data?.detail || 'Failed', 'error');
            }
        }
    };

    const handleRenameSquad = async (squad) => {
        const { value: newName } = await Swal.fire({
            title: 'Rename Squad',
            input: 'text',
            inputValue: squad.name,
            showCancelButton: true,
        });
        if (newName && newName !== squad.name) {
            try {
                await client.put(`/api/v1/org/squads/${squad.id}`, { name: newName });
                fetchDepartments(true);
            } catch (err) {
                Swal.fire('Error', err.response?.data?.detail || 'Failed', 'error');
            }
        }
    };

    const handleDeleteSquad = async (squad) => {
        const result = await Swal.fire({
            title: `Delete Squad "${squad.name}"?`,
            text: 'Folders and Flows inside will NOT be deleted, but moved to unassigned',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#ef4444',
            confirmButtonText: 'Delete',
            cancelButtonText: 'Cancel',
        });
        if (result.isConfirmed) {
            try {
                await client.delete(`/api/v1/org/squads/${squad.id}`);
                // SSE will handle refresh
            } catch (err) {
                Swal.fire('Error', err.response?.data?.detail || 'Failed', 'error');
            }
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            </div>
        );
    }

    return (
        <div className="max-w-5xl mx-auto">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-slate-800">Organization Settings</h1>
                <p className="text-sm text-slate-500 mt-1">Manage Departments and Squads to group flows</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                {/* Department List */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col max-h-[calc(100vh-8rem)]">
                    <div className="flex items-center justify-between p-4 border-b border-slate-100 shrink-0">
                        <div className="flex items-center gap-2">
                            <Building2 size={18} className="text-blue-600" />
                            <h2 className="font-semibold text-slate-700">Departments</h2>
                            <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                                {departments.length}
                            </span>
                        </div>
                        {isSuperAdmin && (
                            <button
                                onClick={handleAddDepartment}
                                className="flex items-center gap-1 px-3 py-1.5 text-xs bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"
                            >
                                <Plus size={14} /> Add
                            </button>
                        )}
                    </div>

                    <div className="divide-y divide-slate-50 overflow-y-auto">
                        {departments.map(dept => (
                            <div
                                key={dept.id}
                                className={`relative flex items-center justify-between px-4 py-3 transition-colors group ${selectedDept?.id === dept.id
                                    ? 'bg-blue-50 border-l-2 border-blue-500'
                                    : 'hover:bg-slate-50 border-l-2 border-transparent'
                                    }`}
                            >
                                <button
                                    type="button"
                                    onClick={() => setSelectedDept(dept)}
                                    className="absolute inset-0 w-full h-full cursor-pointer bg-transparent border-none outline-none"
                                    aria-label={`Select department ${dept.name}`}
                                />
                                <div className="relative z-10 pointer-events-none flex items-center gap-2 min-w-0">
                                    <ChevronRight size={14} className={`transition-transform ${selectedDept?.id === dept.id ? 'text-blue-500' : 'text-slate-400'
                                        }`} />
                                    <span className="font-medium text-slate-700 truncate">{dept.name}</span>
                                    <span className="text-xs text-slate-400">{dept.squads?.length || 0} squads</span>
                                </div>
                                {isSuperAdmin && (
                                    <div className="relative z-10 pointer-events-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handleRenameDepartment(dept); }}
                                            className="p-1 hover:bg-slate-200 rounded"
                                        >
                                            <Edit2 size={12} className="text-slate-400" />
                                        </button>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handleDeleteDepartment(dept); }}
                                            className="p-1 hover:bg-red-100 rounded"
                                        >
                                            <Trash2 size={12} className="text-red-400" />
                                        </button>
                                    </div>
                                )}
                            </div>
                        ))}
                        {departments.length === 0 && (
                            <div className="p-8 text-center text-slate-400 text-sm">
                                No Departments found
                            </div>
                        )}
                    </div>
                </div>

                {/* Squad List */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col max-h-[calc(100vh-8rem)]">
                    <div className="flex items-center justify-between p-4 border-b border-slate-100 shrink-0">
                        <div className="flex items-center gap-2">
                            <Users size={18} className="text-indigo-600" />
                            <h2 className="font-semibold text-slate-700">
                                Squads
                                {selectedDept && (
                                    <span className="text-slate-400 font-normal ml-1">— {selectedDept.name}</span>
                                )}
                            </h2>
                            <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                                {selectedDept?.squads?.length || 0}
                            </span>
                        </div>
                        {canManageSquads && selectedDept && (
                            <button
                                onClick={handleAddSquad}
                                className="flex items-center gap-1 px-3 py-1.5 text-xs bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition-colors"
                            >
                                <Plus size={14} /> Add Squad
                            </button>
                        )}
                    </div>

                    <div className="divide-y divide-slate-50 overflow-y-auto">
                        {selectedDept?.squads?.map(squad => (
                            <div
                                key={squad.id}
                                className="flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors group"
                            >
                                <div className="flex items-center gap-2 min-w-0">
                                    <div className="w-2 h-2 rounded-full bg-indigo-400" />
                                    <span className="font-medium text-slate-700 truncate">{squad.name}</span>
                                </div>
                                {canManageSquads && (
                                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                            onClick={() => handleRenameSquad(squad)}
                                            className="p-1 hover:bg-slate-200 rounded"
                                        >
                                            <Edit2 size={12} className="text-slate-400" />
                                        </button>
                                        <button
                                            onClick={() => handleDeleteSquad(squad)}
                                            className="p-1 hover:bg-red-100 rounded"
                                        >
                                            <Trash2 size={12} className="text-red-400" />
                                        </button>
                                    </div>
                                )}
                            </div>
                        ))}
                        {(!selectedDept || selectedDept.squads?.length === 0) && (
                            <div className="p-8 text-center text-slate-400 text-sm">
                                {selectedDept ? 'No Squads found — click Add Squad' : 'Select Department on the left'}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
