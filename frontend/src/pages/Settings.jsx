/* eslint-disable react/prop-types */
import { useState, useEffect, useRef, useMemo } from 'react';
import client, { API_URL } from '../api/client';
import { Plus, Trash2, Layers, ImageIcon, GripVertical, FolderPlus, Folder, ChevronRight, ChevronDown, FilePlus, FileText, Edit2, PanelLeftOpen, PanelLeftClose, RefreshCw, Building2, Users, MessageSquare, LayoutGrid, X } from 'lucide-react';
import Swal from 'sweetalert2';
import MaskingCanvas from '../components/MaskingCanvas';
import Breadcrumb from '../components/Breadcrumb';
import clsx from 'clsx';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { useAuth } from '../contexts/AuthContext';

export default function Settings() {
    const { user: currentUser } = useAuth();
    const isAdmin = currentUser?.role === 'ADMIN';
    const [folders, setFolders] = useState([]);
    const [flows, setFlows] = useState([]);
    const [pages, setPages] = useState([]);

    const [expandedFolders, setExpandedFolders] = useState([]);
    const [selectedFlow, setSelectedFlow] = useState(null);
    const [selectedPage, setSelectedPage] = useState(null);
    const [showGridPreview, setShowGridPreview] = useState(false);
    const [isUploading, setIsUploading] = useState(false);

    // Organization filter
    const [departments, setDepartments] = useState([]);
    const [selectedDeptId, setSelectedDeptId] = useState('');
    const [selectedSquadId, setSelectedSquadId] = useState('');
    const selectedSquadIdRef = useRef(selectedSquadId);

    useEffect(() => {
        selectedSquadIdRef.current = selectedSquadId;
    }, [selectedSquadId]);

    const [mode, setMode] = useState('GLOBAL');

    // For auto-refresh
    const selectedFlowRef = useRef(selectedFlow);
    useEffect(() => {
        selectedFlowRef.current = selectedFlow;
    }, [selectedFlow]);

    const silentFetchFoldersAndFlows = async () => {
        if (!selectedSquadIdRef.current) return;
        try {
            const squadParam = `&squad_id=${selectedSquadIdRef.current}`;
            const timestamp = new Date().getTime();
            const [resFolders, resFlows] = await Promise.all([
                client.get(`/api/v1/folders?t=${timestamp}${squadParam}`),
                client.get(`/api/v1/flows?t=${timestamp}${squadParam}`)
            ]);
            setFolders(resFolders.data || []);
            setFlows(resFlows.data || []);
        } catch (err) { }
    };

    const silentFetchPages = async (flowId) => {
        try {
            const timestamp = new Date().getTime();
            const res = await client.get(`/api/v1/pages?flow_id=${flowId}&t=${timestamp}`);
            const sorted = res.data
                .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
                .map(p => ({ ...p, _t: timestamp }));

            setPages(sorted);
            setSelectedPage(prev => {
                if (!prev) return prev;
                return sorted.find(p => p.id === prev.id) || null;
            });
        } catch (err) { }
    };

    useEffect(() => {
        if (!selectedSquadId) return;

        const evtSource = new EventSource(`${API_URL}/api/v1/jobs/stream`);

        const handleFolderFlowUpdate = (e) => {
            const data = JSON.parse(e.data);
            if (data.squad_id === Number(selectedSquadIdRef.current)) {
                silentFetchFoldersAndFlows();
            }
        };

        const handlePageUpdate = (e) => {
            const data = JSON.parse(e.data);
            if (data.flow_id === selectedFlowRef.current?.id) {
                silentFetchPages(data.flow_id);
            }
            if (data.squad_id === Number(selectedSquadIdRef.current)) {
                silentFetchFoldersAndFlows();
            }
        };

        evtSource.addEventListener("folder_created", handleFolderFlowUpdate);
        evtSource.addEventListener("folder_updated", handleFolderFlowUpdate);
        evtSource.addEventListener("folder_deleted", handleFolderFlowUpdate);
        evtSource.addEventListener("flow_created", handleFolderFlowUpdate);
        evtSource.addEventListener("flow_updated", handleFolderFlowUpdate);
        evtSource.addEventListener("flow_deleted", handleFolderFlowUpdate);
        evtSource.addEventListener("flows_reordered", handleFolderFlowUpdate);

        evtSource.addEventListener("page_created", handlePageUpdate);
        evtSource.addEventListener("page_updated", handlePageUpdate);
        evtSource.addEventListener("page_deleted", handlePageUpdate);
        evtSource.addEventListener("pages_reordered", handlePageUpdate);
        evtSource.addEventListener("page_image_changed", handlePageUpdate);

        return () => evtSource.close();
    }, [selectedSquadId]);

    const [masks, setMasks] = useState([]);
    const [isLoading, setIsLoading] = useState(false);

    const [dragOverFolderId, setDragOverFolderId] = useState(null);
    const [showSettingsSidebar, setShowSettingsSidebar] = useState(true);
    const changeImageInputRef = useRef(null);
    const [changeImagePageId, setChangeImagePageId] = useState(null);

    const [maxImagesLimit, setMaxImagesLimit] = useState(50);
    const [maxNoteLength, setMaxNoteLength] = useState(500);

    useEffect(() => {
        fetchDepartments();
        fetchLimit();
    }, []);

    const fetchLimit = async () => {
        try {
            const res = await client.get('/api/v1/config/max_images_per_flow');
            if (res.data && res.data.value) {
                setMaxImagesLimit(Number.parseInt(res.data.value, 10) || 50);
            }
        } catch (err) {
            console.warn('Could not fetch config limit, using default: 50');
        }
        try {
            const res = await client.get('/api/v1/config/max_flow_note_length');
            if (res.data && res.data.value) {
                setMaxNoteLength(Number.parseInt(res.data.value, 10) || 500);
            }
        } catch (err) {
            console.warn('Could not fetch note length config, using default: 500');
        }
    };

    useEffect(() => {
        if (selectedSquadId) {
            fetchFoldersAndFlows();
        } else {
            setFolders([]); setFlows([]);
            setSelectedFlow(null); setPages([]); setSelectedPage(null);
        }
    }, [selectedSquadId]);

    const fetchDepartments = async () => {
        try {
            const res = await client.get('/api/v1/org/departments');
            let deptList = res.data;
            // Non-admin users can only see their own department
            if (!isAdmin && currentUser?.department_id) {
                deptList = deptList.filter(d => d.id === currentUser.department_id);
                // Auto-select their department
                if (deptList.length > 0 && !selectedDeptId) {
                    setSelectedDeptId(String(deptList[0].id));
                }
            }
            setDepartments(deptList);
        } catch (err) { console.error(err); }
    };

    const fetchFoldersAndFlows = async () => {
        try {
            const timestamp = new Date().getTime();
            const squadParam = selectedSquadId ? `&squad_id=${selectedSquadId}` : '';
            const [resFolders, resFlows] = await Promise.all([
                client.get(`/api/v1/folders?t=${timestamp}${squadParam}`),
                client.get(`/api/v1/flows?t=${timestamp}${squadParam}`)
            ]);
            setFolders(resFolders.data || []);
            setFlows(resFlows.data || []);
        } catch (err) {
            console.error("API Fetch Error:", err);
            Swal.fire('Database Error', 'Failed to fetch Flow data', 'error');
        }
    };

    const fetchPages = async (flowId) => {
        try {
            const timestamp = new Date().getTime();
            const res = await client.get(`/api/v1/pages?flow_id=${flowId}&t=${timestamp}`);
            const sorted = res.data
                .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
                .map(p => ({ ...p, _t: timestamp })); // cache buster version

            setPages(sorted);
            setSelectedPage(prev => {
                if (!prev) return prev;
                return sorted.find(p => p.id === prev.id) || null;
            });
        } catch (err) { console.error(err); }
    };

    const fetchMasks = async (flowId) => {
        try {
            const timestamp = new Date().getTime();
            const res = await client.get(`/api/v1/masks/${flowId}?t=${timestamp}`);
            setMasks(res.data);
        } catch (err) { console.error(err); }
    };

    const handleRenameFolder = async (e, folder) => {
        e.stopPropagation();
        const { value: newName } = await Swal.fire({
            title: 'Rename Folder',
            input: 'text',
            inputValue: folder.name,
            showCancelButton: true,
            inputValidator: (v) => !v && 'Name is required!'
        });
        if (newName && newName !== folder.name) {
            try {
                await client.put(`/api/v1/folders/${folder.id}`, { name: newName });
                fetchFoldersAndFlows();
            } catch (err) { Swal.fire('Error', 'Failed to rename folder', 'error'); }
        }
    };

    const handleRenameFlow = async (e, flow) => {
        e.stopPropagation();
        const { value: newName } = await Swal.fire({
            title: 'Rename Flow',
            input: 'text',
            inputValue: flow.name,
            showCancelButton: true,
            inputValidator: (v) => !v && 'Name is required!'
        });
        if (newName && newName !== flow.name) {
            try {
                await client.put(`/api/v1/flows/${flow.id}`, { name: newName });
                if (selectedFlow?.id === flow.id) setSelectedFlow({ ...flow, name: newName });
                fetchFoldersAndFlows();
            } catch (err) { Swal.fire('Error', 'Failed to rename flow', 'error'); }
        }
    };

    const handleFlowNote = async (e, flow) => {
        e.stopPropagation();
        const { value: note } = await Swal.fire({
            title: `📝 Note — ${flow.name}`,
            input: 'textarea',
            inputValue: flow.note || '',
            inputPlaceholder: 'Add details or comment for this flow...',
            inputAttributes: {
                maxlength: maxNoteLength,
                style: 'height: 150px; font-size: 14px;'
            },
            showCancelButton: true,
            confirmButtonText: 'Save',
            cancelButtonText: 'Cancel',
            footer: `<span id="swal-note-counter" style="color:#94a3b8;font-size:12px">${(flow.note || '').length}/${maxNoteLength} characters</span>`,
            didOpen: () => {
                const textarea = Swal.getInput();
                const counter = document.getElementById('swal-note-counter');
                if (textarea && counter) {
                    textarea.addEventListener('input', () => {
                        const len = textarea.value.length;
                        counter.textContent = `${len}/${maxNoteLength} characters`;
                        counter.style.color = len >= maxNoteLength ? '#ef4444' : '#94a3b8';
                    });
                }
            },
        });
        if (note !== undefined) {
            try {
                await client.put(`/api/v1/flows/${flow.id}`, { note: note });
                fetchFoldersAndFlows();
                if (selectedFlow?.id === flow.id) setSelectedFlow({ ...selectedFlow, note: note || null });
                Swal.fire({ icon: 'success', title: 'Saved', timer: 1000, showConfirmButton: false });
            } catch (err) {
                const msg = err.response?.data?.detail || 'Failed to save note';
                Swal.fire('Error', msg, 'error');
            }
        }
    };

    const handleRenamePage = async (e, page) => {
        e.stopPropagation();
        const { value: newName } = await Swal.fire({
            title: 'Rename Page',
            input: 'text',
            inputValue: page.page_name,
            showCancelButton: true,
            inputValidator: (v) => !v && 'Name is required!'
        });
        if (newName && newName !== page.page_name) {
            try {
                await client.put(`/api/v1/pages/${page.id}`, { page_name: newName });
                fetchPages(selectedFlow.id);
            } catch (err) { Swal.fire('Error', 'Failed to rename page', 'error'); }
        }
    };

    const handleDragStartFlow = (e, flowId) => {
        e.dataTransfer.setData("flowId", flowId);
        e.dataTransfer.effectAllowed = "move";
    };

    const handleDropToFolder = async (e, targetFolderId) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOverFolderId(null);

        const flowIdStr = e.dataTransfer.getData("flowId");
        if (!flowIdStr) return;

        const flowId = Number.parseInt(flowIdStr, 10);

        // Optimistic UI update
        setFlows(prev => prev.map(f => f.id === flowId ? { ...f, folder_id: targetFolderId } : f));

        try {
            await client.put(`/api/v1/flows/${flowId}`, { folder_id: targetFolderId });
            // Let SSE handle fetching/syncing, or if you want to be safe, fetch here
        } catch (err) {
            fetchFoldersAndFlows();
            Swal.fire('Error', 'Failed to move flow', 'error');
        }
    };

    const toggleFolder = (id) => {
        setExpandedFolders(prev => prev.includes(id) ? prev.filter(fId => fId !== id) : [...prev, id]);
    };

    const promptAddFolder = async (parentId) => {
        if (!selectedSquadId) {
            return Swal.fire('Select Squad first', 'Please select Department and Squad before creating a Folder', 'warning');
        }
        const { value: name } = await Swal.fire({
            title: 'New Folder', input: 'text', showCancelButton: true,
            inputValidator: (value) => !value && 'Name is required!'
        });
        if (name) {
            try {
                await client.post('/api/v1/folders', { name, parent_id: parentId, squad_id: selectedSquadId });
                fetchFoldersAndFlows();
                if (parentId && !expandedFolders.includes(parentId)) toggleFolder(parentId);
            } catch (err) {
                Swal.fire('Error', err.response?.data?.detail || 'Failed to create folder', 'error');
            }
        }
    };

    const promptAddFlow = async (folderId) => {
        if (!selectedSquadId) {
            return Swal.fire('Select Squad first', 'Please select Department and Squad before creating a Flow', 'warning');
        }
        const { value: name } = await Swal.fire({
            title: 'New Flow Name', input: 'text', showCancelButton: true,
            inputValidator: (value) => !value && 'Name is required!'
        });
        if (name) {
            try {
                await client.post('/api/v1/flows', { name, folder_id: folderId, squad_id: Number(selectedSquadId) });
                fetchFoldersAndFlows();
                if (folderId && !expandedFolders.includes(folderId)) toggleFolder(folderId);
            } catch (err) { Swal.fire('Error', 'Failed to create flow', 'error'); }
        }
    };

    const handleDeleteFolder = async (id) => {
        if (isUploading) return Swal.fire('Warning', 'Cannot delete folder while uploading.', 'warning');
        const result = await Swal.fire({
            title: 'Delete Folder?', text: "All contents inside will be deleted!", icon: 'warning',
            showCancelButton: true, confirmButtonColor: '#d33', confirmButtonText: 'Yes, delete it!'
        });
        if (result.isConfirmed) {
            try {
                await client.delete(`/api/v1/folders/${id}`);
                if (selectedFlow?.folder_id === id) { setSelectedFlow(null); setPages([]); }
                fetchFoldersAndFlows();
            } catch (err) { Swal.fire('Error', 'Failed to delete folder', 'error'); }
        }
    };

    const handleDeleteFlow = async (e, flow) => {
        e.stopPropagation();
        if (isUploading) return Swal.fire('Warning', 'Cannot delete flow while uploading master images.', 'warning');
        const result = await Swal.fire({
            title: `Delete Flow "${flow.name}"?`, icon: 'warning',
            showCancelButton: true, confirmButtonColor: '#d33', confirmButtonText: 'Yes, delete it!'
        });
        if (result.isConfirmed) {
            try {
                await client.delete(`/api/v1/flows/${flow.id}`);
                if (selectedFlow?.id === flow.id) { setSelectedFlow(null); setPages([]); setSelectedPage(null); }
                fetchFoldersAndFlows();
            } catch (err) {
                const errMsg = err.response?.data?.detail || 'Failed to delete flow';
                Swal.fire('Error', errMsg, 'error');
            }
        }
    };

    const handleSelectFlow = async (flow) => {
        setIsLoading(true); setSelectedFlow(flow); setSelectedPage(null); setMasks([]);
        await Promise.all([
            fetchPages(flow.id),
            fetchMasks(flow.id)
        ]);
        setIsLoading(false);
    };

    const renderTree = (parentId, level) => {
        const childFolders = folders.filter(f => (f.parent_id == null ? null : f.parent_id) === (parentId == null ? null : parentId)).sort((a, b) => a.name.localeCompare(b.name));
        const childFlows = flows.filter(f => (f.folder_id == null ? null : f.folder_id) === (parentId == null ? null : parentId)).sort((a, b) => a.name.localeCompare(b.name));

        return (
            <div className="space-y-0.5">
                {childFolders.map(folder => (
                    <div key={`folder-${folder.id}`}>
                        <div // NOSONAR
                            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverFolderId(folder.id); }}
                            onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverFolderId(null); }}
                            onDrop={(e) => handleDropToFolder(e, folder.id)}
                            className={clsx(
                                "flex items-center justify-between py-1.5 pr-0 rounded group transition-colors",
                                dragOverFolderId === folder.id ? "bg-blue-100 ring-1 ring-blue-300" : "bg-white hover:bg-slate-100"
                            )}
                            style={{ paddingLeft: `${level * 16 + 8}px` }}
                        >
                            <button
                                type="button"
                                onClick={() => toggleFolder(folder.id)}
                                className="flex items-center gap-1 bg-transparent border-none outline-none cursor-pointer text-left flex-1"
                            >
                                <span className="text-slate-400 shrink-0">
                                    {expandedFolders.includes(folder.id) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                </span>
                                <Folder size={16} className="text-blue-500 shrink-0" />
                                <span className="text-sm font-medium text-slate-700 whitespace-nowrap select-none ml-1">{folder.name}</span>
                            </button>
                            <div className={clsx(
                                "sticky right-0 flex gap-1.5 opacity-0 group-hover:opacity-100 shrink-0 px-2 py-0.5 z-10 rounded-l-md pointer-events-auto",
                                dragOverFolderId === folder.id ? "bg-blue-100" : "bg-white group-hover:bg-slate-100"
                            )}>
                                <button onClick={(e) => handleRenameFolder(e, folder)} className="p-1 hover:bg-slate-200 rounded text-slate-400 hover:text-amber-500 transition-all" title="Rename Folder"><Edit2 size={16} /></button>
                                <button onClick={(e) => { e.stopPropagation(); promptAddFolder(folder.id); }} className="p-1 hover:bg-slate-200 rounded text-slate-400 hover:text-blue-600 transition-all" title="Add Subfolder"><FolderPlus size={16} /></button>
                                <button onClick={(e) => { e.stopPropagation(); promptAddFlow(folder.id); }} className="p-1 hover:bg-slate-200 rounded text-slate-400 hover:text-green-600 transition-all" title="Add Flow"><FilePlus size={16} /></button>
                                <button onClick={(e) => { e.stopPropagation(); handleDeleteFolder(folder.id); }} className="p-1 hover:bg-slate-200 rounded text-slate-400 hover:text-red-500 transition-all" title="Delete Folder"><Trash2 size={16} /></button>
                            </div>
                        </div>
                        {expandedFolders.includes(folder.id) && (
                            <div className="mt-0.5 border-l border-slate-200 ml-4">
                                {renderTree(folder.id, level + 1)}
                            </div>
                        )}
                    </div>
                ))}

                {childFlows.map(flow => (
                    <div // NOSONAR
                        key={`flow-${flow.id}`}
                        draggable="true"
                        onDragStart={(e) => handleDragStartFlow(e, flow.id)}
                        className={clsx(
                            "flex items-center justify-between py-1.5 pr-0 rounded cursor-grab active:cursor-grabbing group transition-colors",
                            selectedFlow?.id === flow.id ? "bg-blue-50 border-l-2 border-blue-500" : "bg-white hover:bg-slate-50 border-l-2 border-transparent"
                        )}
                        style={{ paddingLeft: `${level * 16 + 24}px` }}
                        title="Drag to move folder"
                    >
                        <button
                            type="button"
                            onClick={() => handleSelectFlow(flow)}
                            className="flex items-center gap-2 bg-transparent border-none outline-none cursor-pointer text-left flex-1"
                        >
                            <FileText size={14} className={selectedFlow?.id === flow.id ? "text-blue-600" : "text-slate-400"} shrink-0 />
                            <span className={clsx("text-sm whitespace-nowrap select-none flex items-center gap-1.5", selectedFlow?.id === flow.id ? "text-blue-700 font-medium" : "text-slate-600")}>
                                {flow.name}
                            </span>
                        </button>
                        <div className={clsx(
                            "sticky right-0 flex gap-1.5 opacity-0 group-hover:opacity-100 shrink-0 px-2 py-0.5 z-10 rounded-l-md pointer-events-auto",
                            selectedFlow?.id === flow.id ? "bg-blue-50" : "bg-white group-hover:bg-slate-50"
                        )}>
                            <button onClick={(e) => handleFlowNote(e, flow)} className={clsx("p-1 hover:bg-slate-200 rounded transition-all", flow.note ? "text-blue-500" : "text-slate-400 hover:text-blue-500")} title={flow.note ? `Note: ${flow.note.substring(0, 100)}...` : "Add Note"}>
                                <MessageSquare size={16} fill={flow.note ? "currentColor" : "none"} />
                            </button>
                            <button onClick={(e) => handleRenameFlow(e, flow)} className="p-1 hover:bg-slate-200 rounded text-slate-400 hover:text-amber-500 transition-all" title="Rename Flow"><Edit2 size={16} /></button>
                            <button onClick={(e) => handleDeleteFlow(e, flow)} className="p-1 hover:bg-slate-200 rounded text-slate-400 hover:text-red-500 transition-all" title="Delete Flow">
                                <Trash2 size={16} />
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        );
    };

    const getEffectiveLimit = () => {
        if (!selectedDeptId) return maxImagesLimit;
        const activeDept = departments.find(d => String(d.id) === String(selectedDeptId));
        return activeDept?.max_images_per_flow || maxImagesLimit;
    };

    const handleAddPage = async () => {
        if (!selectedFlow) return Swal.fire('Wait', 'Select a flow first', 'warning');

        const effectiveLimit = getEffectiveLimit();

        if (pages.length >= effectiveLimit) {
            return Swal.fire('Cannot upload', `Cannot upload more pages. This flow has reached the quota of ${effectiveLimit} pages (Limit reached).`, 'error');
        }

        const { value: formValues } = await Swal.fire({
            title: 'Add Single Page',
            html: '<input id="swal-page-name" class="swal2-input" placeholder="Page Name">' +
                '<input id="swal-file" type="file" class="swal2-file" accept="image/*">',
            focusConfirm: false, showCancelButton: true,
            preConfirm: () => {
                const name = document.getElementById('swal-page-name').value;
                const file = document.getElementById('swal-file').files[0];
                if (!name || !file) { Swal.showValidationMessage('Name and Image are mandatory!'); return false; }
                return { name, file };
            }
        });
        if (formValues) {
            const formData = new FormData();
            formData.append('flow_id', selectedFlow.id); formData.append('page_name', formValues.name); formData.append('file', formValues.file);
            setIsUploading(true);
            const controller = new AbortController();
            let isCancelled = false;
            try {
                Swal.fire({ 
                    title: 'Uploading...', 
                    allowOutsideClick: false,
                    showConfirmButton: false,
                    showCancelButton: true,
                    cancelButtonText: 'Cancel',
                    didOpen: () => Swal.showLoading() 
                }).then((result) => {
                    if (result.isDismissed) {
                        isCancelled = true;
                        controller.abort();
                    }
                });
                await client.post('/api/v1/pages', formData, { 
                    headers: { 'Content-Type': 'multipart/form-data' },
                    signal: controller.signal
                });
                if (!isCancelled) Swal.fire('Success', 'Page added successfully', 'success');
                fetchPages(selectedFlow.id);
            } catch (err) { 
                if (err.name === 'CanceledError' || err.message === 'canceled') {
                    Swal.fire('Cancelled', 'Upload cancelled', 'info');
                } else {
                    const errMsg = err.response?.data?.detail || 'Upload failed';
                    Swal.fire('Error', errMsg, 'error'); 
                }
            } finally {
                setIsUploading(false);
            }
        }
    };

    const handleFolderUpload = async (e) => {
        if (!selectedFlow) return Swal.fire('Wait', 'Select a flow first', 'warning');
        
        const effectiveLimit = getEffectiveLimit();
        
        const files = Array.from(e.target.files).filter(f => f.type.startsWith('image/'));
        if (files.length === 0) { e.target.value = ''; return Swal.fire('Warning', 'No image files found', 'warning'); }

        if (files.length > effectiveLimit) {
            e.target.value = '';
            return Swal.fire('Cannot upload', `You are trying to upload ${files.length} files at once, which exceeds the limit of ${effectiveLimit} pages per window.`, 'error');
        }

        if (pages.length + files.length > effectiveLimit) {
            e.target.value = '';
            const available = effectiveLimit - pages.length;
            return Swal.fire('Limit Reached', `You can only upload ${available} more pages (currently have ${pages.length} out of ${effectiveLimit} quota).`, 'error');
        }

        files.sort((a, b) => a.name.localeCompare(b.name));
        let isCancelled = false;
        
        Swal.fire({ 
            title: 'Uploading Folder...', 
            html: `Processing 0 / ${files.length}`, 
            allowOutsideClick: false, 
            showCancelButton: true,
            cancelButtonText: 'Cancel',
            showConfirmButton: false,
            didOpen: () => Swal.showLoading() 
        }).then((result) => {
            if (result.isDismissed) {
                isCancelled = true;
            }
        });

        setIsUploading(true);
        let successCount = 0;
        let errors = [];

        try {
            for (let i = 0; i < files.length; i++) {
                if (isCancelled) break;
                const file = files[i];
                const name = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
                const formData = new FormData();
                formData.append('flow_id', selectedFlow.id); formData.append('page_name', name); formData.append('file', file);
                try {
                    await client.post('/api/v1/pages', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
                    successCount++; 
                    if (!isCancelled) {
                        Swal.update({ html: `Processing ${successCount} / ${files.length}` });
                    }
                } catch (err) {
                    const errMsg = err.response?.data?.detail || 'Upload failed';

                    // Customize error text if it's the limit issue from backend
                    let finalErrMsg = errMsg;
                    if (errMsg.includes('Cannot upload more')) {
                        finalErrMsg = 'System quota exceeded (Limit reached)';
                    }

                    errors.push(`${file.name}: ${finalErrMsg}`);

                    if (errMsg.includes('Cannot upload more')) {
                        break;
                    }
                }
            }
        } finally {
            setIsUploading(false);
        }
        e.target.value = ''; fetchPages(selectedFlow.id); fetchFoldersAndFlows();

        if (isCancelled) {
            Swal.fire('Cancelled', `Upload cancelled. Uploaded ${successCount} pages.`, 'info');
        } else if (errors.length > 0) {
            Swal.fire({
                icon: 'warning',
                title: 'Upload Incomplete',
                html: `Uploaded ${successCount} pages.<br/><br/><div className="text-left text-sm text-red-500 overflow-y-auto max-h-32">Errors:<br/>${errors.join('<br/>')}</div>`
            });
        } else {
            Swal.fire('Success', `Uploaded ${successCount} pages`, 'success');
        }
    };



    const handleDeletePage = async (e, page) => {
        e.stopPropagation();
        const result = await Swal.fire({
            title: `Delete Page?`,
            text: `Are you sure you want to delete page "${page.page_name}"?`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            cancelButtonColor: '#64748b',
            confirmButtonText: 'Yes, delete it!',
            cancelButtonText: 'Cancel'
        });

        if (result.isConfirmed) {
            try {
                await client.delete(`/api/v1/pages/${page.id}`);
                setPages(pages.filter(p => p.id !== page.id));
                if (selectedPage?.id === page.id) setSelectedPage(null);
            } catch (err) { }
        }
    };

    const handleSelectPage = (page) => {
        setSelectedPage(page);
        setMode('PAGE');
    };

    const handleChangeImage = (e, page) => {
        e.stopPropagation();
        setChangeImagePageId(page.id);
        changeImageInputRef.current.value = '';
        changeImageInputRef.current.click();
    };

    const handleChangeImageUpload = async (e) => {
        const file = e.target.files[0];
        if (!file || !changeImagePageId) return;

        const formData = new FormData();
        formData.append('file', file);

        setIsUploading(true);
        const controller = new AbortController();
        let isCancelled = false;

        try {
            Swal.fire({ 
                title: 'Uploading...', 
                allowOutsideClick: false,
                showConfirmButton: false,
                showCancelButton: true,
                cancelButtonText: 'Cancel',
                didOpen: () => Swal.showLoading() 
            }).then((result) => {
                if (result.isDismissed) {
                    isCancelled = true;
                    controller.abort();
                }
            });
            await client.put(`/api/v1/pages/${changeImagePageId}/image`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
                signal: controller.signal
            });
            if (!isCancelled) Swal.fire('Success', 'Image changed successfully', 'success');
            if (selectedFlow) {
                fetchPages(selectedFlow.id);
                fetchMasks(selectedFlow.id);
            }
        } catch (err) {
            if (err.name === 'CanceledError' || err.message === 'canceled') {
                Swal.fire('Cancelled', 'Upload cancelled', 'info');
            } else {
                console.error(err);
                const errMsg = err.response?.data?.detail || 'Failed to change image';
                Swal.fire('Error', errMsg, 'error');
            }
        } finally {
            setIsUploading(false);
            setChangeImagePageId(null);
        }
    };

    const onDragEndPages = async (result) => {
        if (!result.destination) return;
        if (result.type === 'PAGE') {
            const items = Array.from(pages);
            const [reorderedItem] = items.splice(result.source.index, 1);
            items.splice(result.destination.index, 0, reorderedItem);
            setPages(items);
            try { await client.put('/api/v1/pages/reorder', { ids: items.map(p => p.id) }); } catch (err) { }
        }
    };

    const handleMaskAdd = async (newMask) => {
        const payload = { flow_id: selectedFlow.id, page_id: mode === 'PAGE' ? selectedPage.id : null, type: mode, x: Math.round(newMask.x), y: Math.round(newMask.y), width: Math.round(newMask.width), height: Math.round(newMask.height) };
        try { const res = await client.post('/api/v1/masks', payload); setMasks(prev => [...prev, { ...payload, id: res.data.id }]); } catch (err) { }
    };

    const handleMaskUpdate = async (updatedMask) => {
        const payload = { x: Math.round(updatedMask.x), y: Math.round(updatedMask.y), width: Math.round(updatedMask.width), height: Math.round(updatedMask.height) };
        setMasks(prev => prev.map(m => m.id === updatedMask.id ? { ...m, ...payload } : m));
        try { await client.put(`/api/v1/masks/${updatedMask.id}`, payload); } catch (err) { }
    };

    const handleMaskDelete = async (mask) => {
        const oldMasks = [...masks]; setMasks(prev => prev.filter(m => m.id !== mask.id));
        try { await client.delete(`/api/v1/masks/${mask.id}`); } catch (err) { setMasks(oldMasks); }
    };

    const handleClearMasks = async () => {
        if (!selectedPage) return;
        const result = await Swal.fire({ title: 'Clear All Masks on This Page?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', confirmButtonText: 'Yes' });
        if (result.isConfirmed) {
            setIsLoading(true);
            try {
                const masksToDelete = masks.filter(m => m.type === 'GLOBAL' || (m.type === 'PAGE' && m.page_id === selectedPage.id));
                await Promise.all(masksToDelete.map(mask => client.delete(`/api/v1/masks/${mask.id}`)));

                const idsToDelete = masksToDelete.map(m => m.id);
                setMasks(prev => prev.filter(m => !idsToDelete.includes(m.id)));
                Swal.fire('Deleted!', 'Masks cleared.', 'success');
            } catch (err) { } finally { setIsLoading(false); }
        }
    };

    return (
        <>
        <DragDropContext onDragEnd={onDragEndPages}>
            <div className="flex h-full gap-3 sm:gap-4 lg:gap-6 relative">

                {/* Toggle Sidebar Button */}
                <button
                    onClick={() => setShowSettingsSidebar(prev => !prev)}
                    className={clsx(
                        "absolute top-2 sm:top-4 lg:top-6 z-30 p-2 bg-white border border-slate-200 rounded-lg shadow-md hover:bg-slate-50 transition-all duration-200 text-slate-600",
                        showSettingsSidebar ? "left-[16rem] sm:left-[19rem] lg:left-[570px]" : "left-2 sm:left-4 lg:left-6"
                    )}
                    title={showSettingsSidebar ? 'Hide Menu' : 'Show Menu'}
                >
                    {showSettingsSidebar ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
                </button>

                <div id="settings-sidebar" className={clsx(
                    "flex flex-col gap-3 sm:gap-4 lg:gap-6 h-full shrink-0 transition-all duration-300",
                    showSettingsSidebar ? "w-60 sm:w-72 lg:w-[550px] opacity-100" : "w-0 opacity-0 overflow-hidden"
                )}>

                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex-1 flex flex-col min-h-[40%]">
                        <div className="p-4 border-b bg-slate-50 flex justify-between items-center shrink-0">
                            <h2 className="font-bold text-slate-700 flex items-center gap-2"><Layers size={18} /> Flows & Folders</h2>
                            <div className="flex gap-1">
                                <button onClick={() => promptAddFolder(null)} className="p-1.5 hover:bg-slate-200 rounded text-blue-600" title="New Root Folder"><FolderPlus size={18} /></button>
                                <button onClick={() => promptAddFlow(null)} className="p-1.5 hover:bg-slate-200 rounded text-green-600" title="New Root Flow"><FilePlus size={18} /></button>
                            </div>
                        </div>

                        {/* Department / Squad Filter */}
                        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50/50 space-y-1.5">
                            <div className="flex items-center gap-2">
                                <Building2 size={14} className="text-blue-500 shrink-0" />
                                <select
                                    value={selectedDeptId}
                                    onChange={(e) => {
                                        const deptId = e.target.value;
                                        setSelectedDeptId(deptId);
                                        setSelectedSquadId('');
                                        setSelectedFlow(null); setPages([]); setSelectedPage(null);
                                    }}
                                    className={clsx(
                                        "flex-1 text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:ring-1 focus:ring-blue-400 focus:outline-none",
                                        !isAdmin && "bg-slate-100 cursor-not-allowed"
                                    )}
                                    disabled={!isAdmin}
                                >
                                    {isAdmin && <option value="">— Select Department —</option>}
                                    {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                                </select>
                            </div>
                            <div className="flex items-center gap-2">
                                <Users size={14} className="text-indigo-500 shrink-0" />
                                <select
                                    value={selectedSquadId}
                                    disabled={!selectedDeptId}
                                    onChange={(e) => {
                                        setSelectedSquadId(e.target.value);
                                        setSelectedFlow(null); setPages([]); setSelectedPage(null);
                                    }}
                                    className={clsx(
                                        "flex-1 text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:ring-1 focus:ring-indigo-400 focus:outline-none",
                                        selectedDeptId ? "bg-white" : "bg-slate-100 text-slate-400 cursor-not-allowed"
                                    )}
                                >
                                    <option value="">— Select Squad —</option>
                                    {(departments.find(d => d.id === Number(selectedDeptId))?.squads || []).map(s => (
                                        <option key={s.id} value={s.id}>{s.name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* Breadcrumb */}
                        {selectedFlow && (
                            <Breadcrumb
                                items={(() => {
                                    const path = [];
                                    if (selectedFlow?.folder_id) {
                                        let fid = selectedFlow.folder_id;
                                        while (fid) {
                                            const f = folders.find(fo => fo.id === fid);
                                            if (!f) break;
                                            path.unshift({ id: f.id, name: f.name, type: 'folder' });
                                            fid = f.parent_id;
                                        }
                                    }
                                    path.push({ id: selectedFlow.id, name: selectedFlow.name, type: 'flow' });
                                    return path;
                                })()}
                                onNavigate={(item) => {
                                    if (!item) { setSelectedFlow(null); setPages([]); setSelectedPage(null); }
                                }}
                            />
                        )}

                        <section
                            aria-label="Dropzone for folders and flows"
                            className="flex-1 overflow-y-auto overflow-x-auto p-2 pb-20"
                            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverFolderId('root'); }} // NOSONAR
                            onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverFolderId(null); }} // NOSONAR
                            onDrop={(e) => handleDropToFolder(e, null)} // NOSONAR
                            style={{ backgroundColor: dragOverFolderId === 'root' ? '#f8fafc' : 'transparent' }}
                        >
                            <div className="w-full min-w-max">
                                {renderTree(null, 0)}
                                {folders.length === 0 && flows.length === 0 && (
                                    <p className="text-xs text-slate-400 text-center py-4 pointer-events-none">Click + to create folder or flow</p>
                                )}
                            </div>
                        </section>
                    </div>

                    {selectedFlow && (
                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex-1 flex flex-col min-h-0">
                            <div className="p-4 border-b bg-slate-50 flex justify-between items-center shrink-0">
                                <h2 className="font-bold text-slate-700 flex items-center gap-2">
                                    <ImageIcon size={18} /> Pages <span className="text-sm font-normal text-slate-800">({pages.length})</span>
                                </h2>
                                <div className="flex gap-1">
                                    <button onClick={() => setShowGridPreview(true)} className="p-1 hover:bg-slate-200 rounded text-indigo-600" title="Grid Preview & Reorder">
                                        <LayoutGrid size={18} />
                                    </button>
                                    <label htmlFor="upload-folder-input" className="p-1 hover:bg-slate-200 rounded text-blue-600 cursor-pointer" title="Upload Folder">
                                        <FolderPlus size={18} />
                                        <input id="upload-folder-input" type="file" webkitdirectory="true" multiple className="hidden" onChange={handleFolderUpload} />
                                    </label>
                                    <button onClick={handleAddPage} className="p-1 hover:bg-slate-200 rounded text-green-600" title="Add Single Page">
                                        <Plus size={18} />
                                    </button>
                                </div>
                            </div>

                            <Droppable droppableId="pages-list" type="PAGE">
                                {(provided) => (
                                    <div className="flex-1 overflow-y-auto overflow-x-auto p-2" ref={provided.innerRef} {...provided.droppableProps}>
                                        <div className="w-full min-w-max space-y-1">
                                            {pages.length === 0 && <p className="text-xs text-slate-400 text-center py-4">No pages yet.</p>}

                                            {pages.map((page, index) => (
                                                <Draggable key={page.id} draggableId={`page-${page.id}`} index={index}>
                                                    {(provided, snapshot) => (
                                                        <div
                                                            ref={provided.innerRef}
                                                            {...provided.draggableProps}
                                                            className={clsx(
                                                                "relative pl-2 py-2 pr-0 rounded flex items-center justify-between gap-1 border text-sm group transition-all",
                                                                selectedPage?.id === page.id ? "bg-green-50 border-green-200 text-green-700 font-medium" : "bg-white hover:bg-slate-50 border-slate-100 text-slate-600",
                                                                snapshot.isDragging && "shadow-lg bg-white ring-2 ring-green-400 rotate-1 z-50"
                                                            )}
                                                            style={provided.draggableProps.style}
                                                        >
                                                            <button
                                                                type="button"
                                                                onClick={() => handleSelectPage(page)}
                                                                className="absolute inset-0 w-full h-full cursor-pointer bg-transparent border-none outline-none"
                                                                aria-label={`Select page ${page.page_name}`}
                                                            />
                                                            <div className="relative z-10 flex items-center gap-2 flex-1 pr-4 pointer-events-none">
                                                                <div {...provided.dragHandleProps} className="pointer-events-auto text-slate-300 hover:text-slate-600 cursor-grab p-1 shrink-0">
                                                                    <GripVertical size={14} />
                                                                </div>
                                                                <span className="w-5 h-5 flex items-center justify-center bg-slate-200 rounded text-[10px] font-bold text-slate-500 shrink-0">{index + 1}</span>
                                                                <span className="whitespace-nowrap flex-1" title={page.page_name}>{page.page_name}</span>
                                                            </div>
                                                            <div className={clsx(
                                                                "relative z-10 pointer-events-auto sticky right-0 flex gap-1 opacity-0 group-hover:opacity-100 shrink-0 items-center px-2 py-1",
                                                                selectedPage?.id === page.id ? "bg-green-50" : "bg-white group-hover:bg-slate-50",
                                                                snapshot.isDragging && "bg-white"
                                                            )}>
                                                                <button onClick={(e) => handleChangeImage(e, page)} className="p-1 hover:bg-slate-200 rounded text-slate-400 hover:text-blue-500 transition-all" title="Change Image"><RefreshCw size={16} /></button>
                                                                <button onClick={(e) => handleRenamePage(e, page)} className="p-1 hover:bg-slate-200 rounded text-slate-400 hover:text-amber-500 transition-all" title="Rename Page"><Edit2 size={16} /></button>
                                                                <button onClick={(e) => handleDeletePage(e, page)} className="p-1 hover:bg-slate-200 rounded text-slate-400 hover:text-red-500 transition-all" title="Delete Page">
                                                                    <Trash2 size={16} />
                                                                </button>
                                                            </div>
                                                        </div>
                                                    )}
                                                </Draggable>
                                            ))}
                                            {provided.placeholder}
                                        </div>
                                    </div>
                                )}
                            </Droppable>

                            {/* Hidden file input for Change Image */}
                            <input
                                type="file"
                                ref={changeImageInputRef}
                                accept="image/*"
                                className="hidden"
                                onChange={handleChangeImageUpload}
                            />
                        </div>
                    )}
                </div>

                {/* === RIGHT PANEL: CANVAS === */}
                <div className="flex-1 bg-white rounded-xl shadow-sm border border-slate-200 p-3 sm:p-4 lg:p-6 flex flex-col h-full overflow-hidden min-w-0">
                    <div className="flex justify-between items-center mb-4 pb-4 border-b border-slate-100">
                        <div className="flex gap-2 items-center">
                            <button
                                onClick={() => setMode('GLOBAL')}
                                className={clsx("px-4 py-2 rounded-lg text-sm font-medium transition-colors border", mode === 'GLOBAL' ? "bg-red-50 border-red-200 text-red-600" : "bg-white border-slate-200 hover:bg-slate-50")}
                            >Global Mask (Red)</button>
                            <button
                                onClick={() => setMode('PAGE')}
                                disabled={!selectedPage}
                                className={clsx("px-4 py-2 rounded-lg text-sm font-medium transition-colors border", mode === 'PAGE' ? "bg-blue-50 border-blue-200 text-blue-600" : "bg-white border-slate-200 hover:bg-slate-50", !selectedPage && "opacity-50 cursor-not-allowed")}
                            >Page Mask (Blue)</button>
                        </div>
                        {selectedPage && <button onClick={handleClearMasks} className="bg-red-50 text-red-600 hover:bg-red-100 p-2 rounded-lg border border-red-200 transition-colors" title="Clear All Masks on Canvas"><Trash2 size={20} /></button>}
                    </div>

                    <div className="flex-1 overflow-auto bg-slate-50 rounded-lg border border-slate-100 relative flex items-center justify-center p-4">
                        {selectedPage ? (
                            <MaskingCanvas
                                imageUrl={`${API_URL}/output/${selectedPage.image_path}?v=${selectedPage._t || selectedPage.id}`}
                                masks={masks.filter(m => m.type === 'GLOBAL' || (m.type === 'PAGE' && m.page_id === selectedPage.id))}
                                onMaskAdd={handleMaskAdd}
                                onMaskUpdate={handleMaskUpdate}
                                onMaskDelete={handleMaskDelete}
                                mode={mode}
                            />
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full text-slate-400">
                                <Layers size={48} className="mb-4 opacity-20" /><p>Select a page to start masking</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </DragDropContext>

        {/* Grid Preview Modal */}
        {showGridPreview && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                <button
                    type="button"
                    className="fixed inset-0 bg-black/60 backdrop-blur-sm w-full h-full border-none outline-none cursor-default"
                    onClick={() => setShowGridPreview(false)}
                    aria-label="Close preview"
                />
                <div className="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-[95vw] max-h-[92vh] flex flex-col overflow-hidden">
                    {/* Header */}
                    <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center bg-slate-50 shrink-0">
                        <div>
                            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                                <LayoutGrid className="text-indigo-600" size={22} />
                                Page Preview — {selectedFlow?.name}
                            </h2>
                            <p className="text-xs text-slate-500 mt-0.5">Drag & drop to reorder pages in the flow • {pages.length} pages</p>
                        </div>
                        <button onClick={() => setShowGridPreview(false)} className="p-2 hover:bg-slate-200 rounded-lg text-slate-400 hover:text-slate-600 transition-colors">
                            <X size={22} />
                        </button>
                    </div>

                    {/* Grid Body */}
                    <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-50">
                        {pages.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-64 text-slate-400">
                                <Layers size={48} className="mb-4 opacity-20" />
                                <p>No pages in this flow</p>
                            </div>
                        ) : (
                            <DragDropContext onDragEnd={async (result) => {
                                if (!result.destination) return;
                                const items = Array.from(pages);
                                const [moved] = items.splice(result.source.index, 1);
                                items.splice(result.destination.index, 0, moved);
                                setPages(items);
                                try { await client.put('/api/v1/pages/reorder', { ids: items.map(p => p.id) }); } catch (err) { }
                            }}>
                                <Droppable droppableId="grid-preview" direction="horizontal">
                                    {(provided) => (
                                        <div
                                            ref={provided.innerRef}
                                            {...provided.droppableProps}
                                            className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4"
                                        >
                                            {pages.map((page, idx) => (
                                                <Draggable key={page.id} draggableId={`grid-page-${page.id}`} index={idx}>
                                                    {(provided, snapshot) => (
                                                        <div
                                                            ref={provided.innerRef}
                                                            {...provided.draggableProps}
                                                            {...provided.dragHandleProps}
                                                            className={clsx(
                                                                "bg-white rounded-xl border overflow-hidden flex flex-col cursor-grab active:cursor-grabbing transition-all group",
                                                                snapshot.isDragging
                                                                    ? "shadow-2xl ring-4 ring-indigo-400/50 scale-105 rotate-2 z-50 border-indigo-500"
                                                                    : "shadow-sm border-slate-200 hover:shadow-md hover:border-indigo-200"
                                                            )}
                                                            style={provided.draggableProps.style}
                                                        >
                                                            <div className="relative bg-slate-100 flex items-center justify-center p-1 min-h-[120px]">
                                                                <img
                                                                    src={`${API_URL}/output/${page.image_path}?v=${page._t || page.id}`}
                                                                    alt={page.page_name}
                                                                    className="w-full h-auto max-h-[280px] object-contain rounded select-none pointer-events-none"
                                                                    draggable="false"
                                                                    loading="lazy"
                                                                />
                                                                <div className="absolute top-2 left-2 bg-indigo-600 text-white text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full shadow-md">
                                                                    {idx + 1}
                                                                </div>
                                                            </div>
                                                            <div className="bg-slate-800 text-white text-[11px] font-medium p-2 truncate text-center select-none" title={page.page_name}>
                                                                {page.page_name}
                                                            </div>
                                                        </div>
                                                    )}
                                                </Draggable>
                                            ))}
                                            {provided.placeholder}
                                        </div>
                                    )}
                                </Droppable>
                            </DragDropContext>
                        )}
                    </div>
                </div>
            </div>
        )}
        </>
    );
}