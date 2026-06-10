/* eslint-disable react/prop-types */
import { useState, useEffect, useMemo } from 'react';
import client, { API_URL } from '../api/client';
import { Play, Folder, Image as ImageIcon, CheckCircle, AlertCircle, Building2, Users, X, GripHorizontal } from 'lucide-react';
import Swal from 'sweetalert2';
import clsx from 'clsx';
// 💡 1. Import ไลบรารี DND ระดับเทพแบบเดียวกับหน้า Settings
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { useAuth } from '../contexts/AuthContext';

const ImagePreview = ({ file, alt, className }) => {
    const [preview, setPreview] = useState('');

    useEffect(() => {
        if (!file) return;
        const objectUrl = URL.createObjectURL(file);
        setPreview(objectUrl);
        return () => URL.revokeObjectURL(objectUrl);
    }, [file]);

    return preview ? <img src={preview} alt={alt} className={className} draggable="false" /> : null;
};

// Toast Mixin
const Toast = Swal.mixin({
    toast: true,
    position: 'top-end',
    showConfirmButton: false,
    timer: 3000,
    timerProgressBar: true,
    didOpen: (toast) => {
        toast.addEventListener('mouseenter', Swal.stopTimer)
        toast.addEventListener('mouseleave', Swal.resumeTimer)
    }
});

export default function RunTest() {
    const { user: currentUser } = useAuth();
    const [flows, setFlows] = useState([]);
    const [selectedFlow, setSelectedFlow] = useState('');
    const [filesA, setFilesA] = useState([]);
    const [isUploading, setIsUploading] = useState(false);

    const [departments, setDepartments] = useState([]);
    const [selectedDeptId, setSelectedDeptId] = useState('');
    const [selectedSquadId, setSelectedSquadId] = useState('');

    const [flowPages, setFlowPages] = useState([]);

    const [compareByOrder, setCompareByOrder] = useState(false);

    useEffect(() => {
        client.get('/api/v1/org/departments').then(res => {
            setDepartments(res.data);
        }).catch(console.error);
    }, []);

    const filteredDepartments = currentUser?.role === 'ADMIN' 
        ? departments 
        : departments.filter(d => d.id === currentUser?.department_id);

    useEffect(() => {
        if (currentUser && currentUser.role !== 'ADMIN' && currentUser.department_id && filteredDepartments.length > 0) {
            if (!selectedDeptId) {
                setSelectedDeptId(currentUser.department_id.toString());
            }
        }
    }, [currentUser, filteredDepartments, selectedDeptId]);

    useEffect(() => {
        if (selectedSquadId) {
            const squadParam = `?squad_id=${selectedSquadId}`;
            client.get(`/api/v1/flows${squadParam}`).then(res => setFlows(res.data)).catch(console.error);
        } else {
            setFlows([]);
        }
        setSelectedFlow(''); setFlowPages([]);
    }, [selectedSquadId]);

    useEffect(() => {
        if (selectedFlow) {
            client.get(`/api/v1/pages?flow_id=${selectedFlow}`)
                .then(res => {
                    const sorted = res.data.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
                    setFlowPages(sorted);
                })
                .catch(err => console.error("Error fetching pages:", err));
        } else {
            setFlowPages([]);
        }
    }, [selectedFlow]);

    const handleFolderSelect = (e) => {
        const selected = Array.from(e.target.files).filter(f => f.type.startsWith('image/'));

        if (selected.length === 0) {
            Toast.fire({
                icon: 'warning',
                title: 'No images found in selected folder'
            });
            return;
        }

        const initialSorted = selected.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
        setFilesA(initialSorted);
    };

    const handleRemoveImage = (fileToRemove) => {
        setFilesA(prev => prev.filter(file => file !== fileToRemove));
    };

    // 💡 2. ฟังก์ชันจัดการเมื่อปล่อยเมาส์ (คำนวณตำแหน่งใหม่แบบสุดสมูท)
    const onDragEnd = (result) => {
        if (!result.destination || !compareByOrder) return;

        const sourceIndex = result.source.index;
        const destinationIndex = result.destination.index;

        if (sourceIndex === destinationIndex) return;

        setFilesA((prevFiles) => {
            const newFiles = Array.from(prevFiles);
            const [movedFile] = newFiles.splice(sourceIndex, 1);
            newFiles.splice(destinationIndex, 0, movedFile);
            return newFiles;
        });
    };

    const sortedFilesA = useMemo(() => {
        if (flowPages.length === 0 || filesA.length === 0) return filesA;

        if (compareByOrder) {
            return filesA;
        }

        const orderMap = new Map();
        flowPages.forEach((p, idx) => {
            orderMap.set(p.page_name.toLowerCase().trim(), idx);
        });

        return [...filesA].sort((a, b) => {
            const nameA = a.name.substring(0, a.name.lastIndexOf('.')).toLowerCase().trim() || a.name.toLowerCase().trim();
            const nameB = b.name.substring(0, b.name.lastIndexOf('.')).toLowerCase().trim() || b.name.toLowerCase().trim();

            const indexA = orderMap.has(nameA) ? orderMap.get(nameA) : 9999;
            const indexB = orderMap.has(nameB) ? orderMap.get(nameB) : 9999;

            if (indexA === indexB) {
                return nameA.localeCompare(nameB);
            }
            return indexA - indexB;
        });
    }, [filesA, flowPages, compareByOrder]);

    const handleRunTest = async () => {
        if (!selectedFlow || filesA.length === 0) {
            return Swal.fire('Error', 'Please select a flow and folder A', 'error');
        }

        setIsUploading(true);

        const formData = new FormData();
        formData.append('flow_id', selectedFlow);
        formData.append('compare_by_order', compareByOrder ? 'true' : 'false');
        sortedFilesA.forEach(file => { formData.append('files_a', file); });

        Swal.fire({
            title: 'Uploading Images...',
            html: '<div style="margin:15px 0"><div style="background:#e2e8f0;border-radius:8px;height:12px;overflow:hidden"><div id="swal-progress-bar" style="background:linear-gradient(90deg,#3b82f6,#6366f1);height:100%;width:0%;transition:width 0.3s;border-radius:8px"></div></div><p id="swal-progress-text" style="color:#64748b;font-size:13px;margin-top:8px">Uploading 0%</p></div>',
            allowOutsideClick: false,
            allowEscapeKey: false,
            showConfirmButton: false,
        });

        try {
            const res = await client.post('/api/v1/run-test', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
                onUploadProgress: (progressEvent) => {
                    const pct = Math.round((progressEvent.loaded / progressEvent.total) * 100);
                    const bar = document.getElementById('swal-progress-bar');
                    const txt = document.getElementById('swal-progress-text');
                    if (bar) bar.style.width = pct + '%';
                    if (pct >= 100) {
                        if (txt) txt.textContent = 'Comparing images... please wait';
                        Swal.update({ title: 'Comparing Images...' });
                    } else {
                        if (txt) txt.textContent = 'Uploading ' + pct + '%';
                    }
                }
            });

            Swal.fire({
                title: 'Test Queued!',
                text: 'Job ID: ' + res.data.job_id + '. Redirecting to Dashboard...',
                icon: 'success',
                timer: 2000,
                showConfirmButton: false
            }).then(() => {
                window.location.href = `/dashboard?job_id=${res.data.job_id}&department_id=${selectedDeptId}`;
            });

        } catch (err) {
            console.error("Run Test Error:", err);
            const msg = err.response?.data?.detail || err.message || "Unknown Error";
            Swal.fire('Error', 'Failed to start test: ' + msg, 'error');
        } finally {
            setIsUploading(false);
        }
    };

    const renderPreview = (files) => (
        <div className="border rounded-xl p-4 bg-slate-50 flex-1 flex flex-col min-h-0">
            <div className="flex justify-between items-center mb-3">
                <h3 className="font-semibold text-slate-700 flex items-center gap-2">
                    <Folder size={18} className="text-slate-400" /> New Images
                </h3>
                <label htmlFor="upload-files-input" className="bg-white border border-slate-300 hover:bg-slate-50 px-3 py-1 rounded text-sm cursor-pointer shadow-sm transition-colors text-slate-600 font-medium select-none">
                    <span>Browse Folder...</span>
                    <input
                        id="upload-files-input"
                        type="file"
                        webkitdirectory="true"
                        multiple
                        className="hidden"
                        onChange={handleFolderSelect}
                    />
                </label>
            </div>

            <div className="px-3 py-2 bg-slate-200 rounded text-xs text-slate-600 font-medium mb-3 shrink-0 flex justify-between items-center">
                <span>{files.length} images selected</span>
                {compareByOrder ? (
                    <span className="text-indigo-600 font-bold flex items-center gap-1.5 bg-indigo-50 px-2 py-1 rounded shadow-sm border border-indigo-100">
                        <GripHorizontal size={14} /> Drag images to reorder
                    </span>
                ) : (
                    flowPages.length > 0 && <span className="text-blue-600 font-bold bg-blue-50 px-2 py-1 rounded border border-blue-100">Auto-sorted by Flow</span>
                )}
            </div>

            <div className="flex-1 overflow-y-auto pr-2 pb-4">
                {files.length === 0 ? (
                    <div className="w-full py-20 text-center text-slate-400 text-sm border-2 border-dashed border-slate-300 rounded-lg">
                        Drag & Drop folder here or Click Browse
                    </div>
                ) : (
                    // 💡 3. ครอบพื้นที่ด้วย DragDropContext และ Droppable
                    <DragDropContext onDragEnd={onDragEnd}>
                        <Droppable droppableId="images-grid" direction="horizontal" isDropDisabled={!compareByOrder}>
                            {(provided) => (
                                <div
                                    ref={provided.innerRef}
                                    {...provided.droppableProps}
                                    className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 lg:gap-6 items-start"
                                >
                                    {files.map((file, idx) => (
                                        <Draggable
                                            key={file.webkitRelativePath || file.name}
                                            draggableId={file.webkitRelativePath || file.name}
                                            index={idx}
                                            isDragDisabled={!compareByOrder}
                                        >
                                            {(provided, snapshot) => (
                                                <div
                                                    ref={provided.innerRef}
                                                    {...provided.draggableProps}
                                                    {...provided.dragHandleProps}
                                                    className={clsx(
                                                        "bg-white rounded-lg shadow-sm border overflow-hidden flex flex-col hover:shadow-md transition-all group relative",
                                                        compareByOrder ? "cursor-grab active:cursor-grabbing border-slate-200" : "border-slate-200",
                                                        // เอฟเฟกต์ตอนที่กำลังถูกลาก (ลอยขึ้นมาและเอียงนิดๆ เหมือนหน้า Settings)
                                                        snapshot.isDragging && "shadow-2xl ring-4 ring-indigo-400/50 scale-105 rotate-2 z-50 border-indigo-500"
                                                    )}
                                                    style={provided.draggableProps.style}
                                                >
                                                    <div className="relative flex items-center justify-center bg-slate-100 p-2 min-h-[150px]">
                                                        <ImagePreview
                                                            file={file}
                                                            alt={file.name}
                                                            className="w-full h-auto max-h-[400px] object-contain rounded select-none pointer-events-none"
                                                        />
                                                        {/* ตัวเลขลำดับ จะอัปเดตตาม index ใหม่เสมอ */}
                                                        <div className="absolute top-2 left-2 z-10 bg-blue-600 text-white text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full shadow-md pointer-events-none">
                                                            {idx + 1}
                                                        </div>

                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleRemoveImage(file);
                                                            }}
                                                            // ซ่อนปุ่ม X ตอนกำลังลาก เพื่อป้องกันเผลอกด
                                                            className={clsx(
                                                                "absolute top-2 right-2 z-10 bg-red-500 hover:bg-red-600 text-white p-1 rounded-full shadow-md transition-opacity duration-200",
                                                                snapshot.isDragging ? "opacity-0" : "opacity-0 group-hover:opacity-100"
                                                            )}
                                                            title="Remove this image"
                                                        >
                                                            <X size={14} strokeWidth={3} />
                                                        </button>
                                                    </div>
                                                    <div className="bg-slate-800 text-white text-[11px] font-medium p-2 truncate text-center select-none" title={file.name}>
                                                        {file.name}
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
    );

    return (
        <div className="flex flex-col h-full gap-3 sm:gap-4 lg:gap-6">
            <div className="bg-white p-3 sm:p-4 lg:p-6 rounded-xl shadow-sm border border-slate-200 flex flex-col gap-3 shrink-0">
                <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-4 flex-1">
                        <div className="flex items-center gap-2 p-1.5 rounded-lg transition-all">
                            <Building2 size={18} className={!selectedDeptId ? "text-blue-600 animate-pulse" : "text-blue-600"} />
                            <select
                                className={clsx(
                                    "border-2 rounded-lg p-2 text-sm min-w-[160px] transition-all outline-none cursor-pointer",
                                    !selectedDeptId
                                        ? "border-blue-500 bg-white text-blue-700 font-bold shadow-sm"
                                        : "border-blue-500 bg-white text-blue-700 font-medium shadow-sm hover:border-blue-600 focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                                )}
                                value={selectedDeptId}
                                onChange={(e) => {
                                    const did = e.target.value;
                                    setSelectedDeptId(did);
                                    setSelectedSquadId('');
                                }}
                            >
                                <option value="">— Select Department —</option>
                                {filteredDepartments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                            </select>
                        </div>

                        <div className="flex items-center gap-2 p-1.5 rounded-lg transition-all">
                            <Users size={18} className={!selectedDeptId ? "text-slate-300" : (selectedDeptId && !selectedSquadId) ? "text-violet-600 animate-pulse" : "text-violet-600"} />
                            <select
                                className={clsx(
                                    "border-2 rounded-lg p-2 text-sm min-w-[160px] transition-all outline-none",
                                    !selectedDeptId && "border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed",
                                    (selectedDeptId && !selectedSquadId) && "border-violet-500 bg-white text-violet-700 font-bold shadow-sm cursor-pointer",
                                    selectedSquadId && "border-violet-500 bg-white text-violet-700 font-medium shadow-sm hover:border-violet-600 focus:border-violet-600 focus:ring-2 focus:ring-violet-100 cursor-pointer"
                                )}
                                value={selectedSquadId}
                                disabled={!selectedDeptId}
                                onChange={(e) => setSelectedSquadId(e.target.value)}
                            >
                                <option value="">— Select Squad —</option>
                                {(filteredDepartments.find(d => d.id === Number(selectedDeptId))?.squads || []).map(s => (
                                    <option key={s.id} value={s.id}>{s.name}</option>
                                ))}
                            </select>
                        </div>

                        <div className="flex items-center gap-2 p-1.5 rounded-lg transition-all">
                            <label htmlFor="flow-select" className={clsx("font-semibold text-sm whitespace-nowrap", !selectedSquadId ? "text-slate-300" : "text-teal-600")}>Flow:</label>
                            <select
                                id="flow-select"
                                className={clsx(
                                    "border-2 rounded-lg p-2 w-full sm:min-w-[200px] transition-all outline-none",
                                    !selectedSquadId && "border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed",
                                    (selectedSquadId && !selectedFlow) && "border-teal-500 bg-white text-teal-600 font-bold shadow-sm cursor-pointer",
                                    selectedFlow && "border-teal-500 bg-white text-teal-700 font-medium shadow-sm hover:border-teal-600 focus:border-teal-600 focus:ring-2 focus:ring-teal-100 cursor-pointer"
                                )}
                                value={selectedFlow}
                                disabled={!selectedSquadId}
                                onChange={(e) => setSelectedFlow(e.target.value)}
                            >
                                <option value="">-- Choose Flow --</option>
                                {flows.map(f => (
                                    <option key={f.id} value={f.id}>{f.name}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <button
                        onClick={handleRunTest}
                        disabled={isUploading || !selectedFlow || filesA.length === 0}
                        className={clsx(
                            "flex items-center justify-center gap-2 px-4 sm:px-6 py-3 rounded-lg font-bold text-white transition-all shadow-lg text-sm sm:text-base",
                            isUploading || !selectedFlow || filesA.length === 0
                                ? "bg-slate-300 cursor-not-allowed shadow-none"
                                : "bg-blue-600 hover:bg-blue-700 hover:shadow-blue-500/30"
                        )}
                    >
                        {isUploading ? 'Processing...' : 'Run Verification'}
                        <Play size={20} fill="currentColor" />
                    </button>
                </div>

                <hr className="border-slate-100 m-0" />
                <div className="flex items-center gap-6">

                    <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-slate-500">Compare Method</span>
                        <label htmlFor="generate-diff-toggle" aria-label="Toggle compare method" className="relative inline-flex items-center cursor-pointer">
                            <input
                                id="generate-diff-toggle"
                                type="checkbox"
                                className="sr-only peer"
                                checked={compareByOrder}
                                onChange={(e) => setCompareByOrder(e.target.checked)}
                            />
                            <div className="w-9 h-5 bg-blue-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                        </label>
                        <span className={clsx("text-xs font-semibold", compareByOrder ? "text-indigo-600" : "text-blue-600")}>
                            {compareByOrder ? 'Match by Order (1-to-1)' : 'Match by Name'}
                        </span>
                    </div>
                </div>
            </div>

            <div className="flex-1 flex min-h-0">
                {renderPreview(sortedFilesA)}
            </div>
        </div>
    );
}