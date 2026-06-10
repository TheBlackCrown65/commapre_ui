/* eslint-disable react/prop-types */
import { useState, useEffect, useRef } from 'react';
import client, { API_URL } from '../api/client';
import { Download, CheckCircle, AlertCircle, X, ZoomIn, ZoomOut, AlertTriangle, FileText, Calendar, Clock, PanelLeftOpen, PanelLeftClose, Trash2, RefreshCw } from 'lucide-react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import Swal from 'sweetalert2';
import clsx from 'clsx';
import { useAuth } from '../contexts/AuthContext';
import ScannerLoader from '../components/ScannerLoader';

// ---------------------------------------------------------
// Helper: Group jobs by date
// ---------------------------------------------------------
function getDateLabel(dateStr) {
    if (!dateStr) return 'Unknown Date';
    const date = new Date(dateStr);
    const today = new Date();

    const isSameDay = (a, b) =>
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate();

    if (isSameDay(date, today)) return 'Today';

    return date.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric'
    });
}

function getDateKey(dateStr) {
    if (!dateStr) return 'unknown';
    const date = new Date(dateStr);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function groupJobsByDay(jobs) {
    const groups = {};
    const order = [];

    for (const job of jobs) {
        const key = getDateKey(job.created_at);
        if (!groups[key]) {
            groups[key] = {
                label: getDateLabel(job.created_at),
                dateKey: key,
                jobs: []
            };
            order.push(key);
        }
        groups[key].jobs.push(job);
    }

    return order.map(key => groups[key]);
}

function formatTime(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleTimeString('th-TH', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

export default function Dashboard() {
    const { user: currentUser } = useAuth();
    const isAdmin = currentUser?.role === 'ADMIN';
    const [jobs, setJobs] = useState([]);
    const [selectedJob, setSelectedJob] = useState(null);
    const [comparisons, setComparisons] = useState([]);
    const [previewImage, setPreviewImage] = useState(null);
    const [zoomLevel, setZoomLevel] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const dragOrigin = useRef({ x: 0, y: 0 });
    const [stats, setStats] = useState({ total: 0, passed: 0, failed: 0, totalDiffPoints: 0 });
    const [departments, setDepartments] = useState([]);
    const [maxJobs, setMaxJobs] = useState(10);
    const [maxDashJobs, setMaxDashJobs] = useState(10);
    const [jobProgress, setJobProgress] = useState({});
    const [isLoadingDetails, setIsLoadingDetails] = useState(false);
    const selectedJobRef = useRef(null);

    useEffect(() => {
        selectedJobRef.current = selectedJob;
    }, [selectedJob]);

    // 💡 แก้บั๊กที่ 2: บังคับให้ User ธรรมดาถูกผูกติดกับ Department ตัวเองตั้งแต่เริ่มต้น
    const [selectedDeptId, setSelectedDeptId] = useState(() => {
        if (currentUser && currentUser.role !== 'ADMIN' && currentUser.department_id) {
            return String(currentUser.department_id);
        }
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('department_id') || '';
    });

    const [initialJobId, setInitialJobId] = useState(() => {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('job_id');
    });

    useEffect(() => {
        const loadInitialData = async () => {
            try {
                const [deptRes, configRes] = await Promise.all([
                    client.get('/api/v1/org/departments'),
                    client.get('/api/v1/config')
                ]);

                let deptList = deptRes.data;
                // Non-admin users can only see their own department
                if (!isAdmin && currentUser?.department_id) {
                    deptList = deptList.filter(d => d.id === currentUser.department_id);
                }
                setDepartments(deptList);

                // 💡 แก้บั๊กที่ 4: เติมการเซ็ตค่า maxJobs ลงใน State เพื่อให้อัปเดตที่หน้าจอ
                const maxJobsConf = configRes.data.find(c => c.key === 'max_jobs_per_department');
                if (maxJobsConf) setMaxJobs(Number.parseInt(maxJobsConf.value, 10));

                const maxDashConf = configRes.data.find(c => c.key === 'max_dashboard_jobs');
                if (maxDashConf) setMaxDashJobs(Number.parseInt(maxDashConf.value, 10));
            } catch (err) {
                console.error("Failed to load initial data", err);
            }
        };
        loadInitialData();
    }, []);

    // SSE: Listen for real-time job events
    useEffect(() => {
        const eventSource = new EventSource('/api/v1/jobs/stream');

        const handleJobEvent = (e) => {
            try {
                const data = JSON.parse(e.data);
                const eventDeptId = data.department_id;

                if (eventDeptId && !departments.find(d => d.id === Number(eventDeptId))) {
                    client.get('/api/v1/org/departments').then(res => setDepartments(res.data)).catch(() => { });
                }

                if (!selectedDeptId || String(eventDeptId) === String(selectedDeptId)) {
                    fetchJobs(null, true);
                }
            } catch {
                fetchJobs(null, true);
            }
        };

        eventSource.addEventListener('job_created', handleJobEvent);
        eventSource.addEventListener('job_completed', handleJobEvent);
        eventSource.addEventListener('job_failed', handleJobEvent);

        eventSource.addEventListener('job_progress', (e) => {
            try {
                const data = JSON.parse(e.data);
                if (!selectedDeptId || String(data.department_id) === String(selectedDeptId)) {
                    setJobProgress(prev => ({
                        ...prev,
                        [data.job_id]: data.progress
                    }));
                }
            } catch { }
        });

        eventSource.onerror = () => {
            console.log('SSE connection lost, reconnecting...');
        };

        return () => eventSource.close();
    }, [selectedDeptId, departments]);

    useEffect(() => {
        fetchJobs(initialJobId);
        if (initialJobId) setInitialJobId(null);
    }, [selectedDeptId]);

    const fetchJobs = async (autoSelectJobIdUrl, isBackgroundRefresh = false) => {
        try {
            const url = selectedDeptId ? `/api/v1/jobs?department_id=${selectedDeptId}` : `/api/v1/jobs`;
            const res = await client.get(url);
            setJobs(res.data);

            if (autoSelectJobIdUrl) {
                const jobToSelect = res.data.find(j => String(j.id) === String(autoSelectJobIdUrl) || j.job_id_str === String(autoSelectJobIdUrl));
                if (jobToSelect) {
                    handleSelectJob(jobToSelect);
                } else {
                    try {
                        const statusRes = await client.get(`/api/v1/jobs/${autoSelectJobIdUrl}/status`);
                        const syntheticJob = {
                            id: statusRes.data.job_id,
                            job_id_str: statusRes.data.job_id,
                            status: statusRes.data.status,
                            created_at: new Date().toISOString()
                        };
                        setJobs(prev => {
                            if (prev.find(p => String(p.id) === String(syntheticJob.id))) return prev;
                            return [syntheticJob, ...prev];
                        });
                        handleSelectJob(syntheticJob);
                    } catch (err) {
                        if (res.data.length > 0) handleSelectJob(res.data[0]);
                    }
                }
            } else if (res.data.length > 0) {
                const currentSelected = selectedJobRef.current;
                if (isBackgroundRefresh && currentSelected) {
                    return;
                }

                if (!currentSelected || !res.data.find(j => String(j.id) === String(currentSelected.id))) {
                    handleSelectJob(res.data[0]);
                }
            } else if (res.data.length === 0) {
                setSelectedJob(null);
                setComparisons([]);
            }
        } catch (err) {
            console.error("Error fetching jobs:", err);
        }
    };

    const handleDeleteJob = async (e, job) => {
        e.stopPropagation();
        const result = await Swal.fire({
            title: 'Delete Job?',
            text: `Are you sure you want to delete Job #${job.id}?`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            cancelButtonColor: '#64748b',
            confirmButtonText: 'Yes, delete it!',
            cancelButtonText: 'Cancel'
        });
        if (result.isConfirmed) {
            try {
                await client.delete(`/api/v1/jobs/${job.id}`);
                setJobs(prev => prev.filter(j => j.id !== job.id));
                if (selectedJob?.id === job.id) {
                    setSelectedJob(null);
                    setComparisons([]);
                    setStats({ total: 0, passed: 0, failed: 0, totalDiffPoints: 0 });
                }
                Swal.fire({ title: 'Deleted!', text: 'Job has been deleted.', icon: 'success', timer: 1500, showConfirmButton: false });
            } catch (err) {
                Swal.fire('Error', 'Failed to delete job', 'error');
            }
        }
    };

    const handleSelectJob = async (job) => {
        setSelectedJob(job);
        setComparisons([]);
        setIsLoadingDetails(true);

        try {
            const res = await client.get(`/api/v1/jobs/${job.id}`);
            const data = res.data;
            let results = [];

            if (data.results) {
                results = data.results.map((r, idx) => ({
                    id: idx,
                    name: r.filename,
                    status: r.status,
                    diff_count: r.diff_count || 0,
                    message: r.message,
                    a_img: `${API_URL}/output/jobs/${job.id}/device_a/${r.filename}`,
                    b_img: `${API_URL}/output/jobs/${job.id}/device_b/${r.filename}`,
                    diff_img: `${API_URL}/output/jobs/${job.id}/diff/${r.filename}`
                }));
            }
            else if (data.files && Array.isArray(data.files)) {
                results = data.files.map((filename, idx) => ({
                    id: idx,
                    name: filename,
                    status: 'DONE',
                    diff_count: 0,
                    a_img: `${API_URL}/output/jobs/${job.id}/device_a/${filename}`,
                    b_img: `${API_URL}/output/jobs/${job.id}/device_b/${filename}`,
                    diff_img: `${API_URL}/output/jobs/${job.id}/diff/${filename}`
                }));
            }

            setComparisons(results);

            const total = results.length;
            const failed = results.filter(r => r.status === 'FAIL').length;
            const passed = total - failed;
            const totalDiffPoints = results.reduce((sum, r) => sum + (r.diff_count > 0 ? r.diff_count : 0), 0);

            setStats({ total, passed, failed, totalDiffPoints });

        } catch (err) {
            console.error("Failed to load job details:", err);
            setComparisons([]);
        } finally {
            setIsLoadingDetails(false);
        }
    };

    // POLLING effect
    useEffect(() => {
        let pollInterval;
        if (selectedJob && (selectedJob.status === 'QUEUED' || selectedJob.status === 'PROCESSING')) {
            pollInterval = setInterval(async () => {
                try {
                    const res = await client.get(`/api/v1/jobs/${selectedJob.id}/status`);
                    if (res.data.status === 'COMPLETED' || res.data.status === 'FAILED') {
                        clearInterval(pollInterval);
                        fetchJobs(selectedJob.id); // Refresh left menu and details
                    } else if (res.data.status !== selectedJob.status) {
                        setSelectedJob(prev => ({ ...prev, status: res.data.status }));
                        setJobs(prev => prev.map(j => j.id === selectedJob.id ? { ...j, status: res.data.status } : j));
                    }
                } catch (err) {
                    console.error("Polling error", err);
                }
            }, 5000);
        }
        return () => {
            if (pollInterval) clearInterval(pollInterval);
        };
    }, [selectedJob]);

    const getImageDataUrl = (url, maxWidth = 600) => {
        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'Anonymous';
            img.src = url

            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                try {
                    resolve(canvas.toDataURL('image/jpeg', 0.8));
                } catch (e) {
                    console.warn("Canvas Tainted:", url);
                    resolve(null);
                }
            };

            img.onerror = () => {
                console.warn("Failed to load image:", url);
                resolve(null);
            };
        });
    };

    const handleHeal = async (filename) => {
        const isAll = filename === 'all';
        const textMsg = isAll
            ? "This will replace ALL master images in this flow with the new images from this test run."
            : `This will replace the master image with the new image for "${filename}".`;

        const result = await Swal.fire({
            title: isAll ? 'Update All Master Images?' : 'Update Master Image?',
            text: textMsg,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#4f46e5',
            cancelButtonColor: '#64748b',
            confirmButtonText: 'Yes, Update it!'
        });

        if (result.isConfirmed) {
            try {
                await client.post(`/api/v1/jobs/${selectedJob.id}/heal`, { filename });
                Swal.fire({
                    title: 'Master Image Updated!',
                    text: 'The master images have been updated. It will take effect on your next test run.',
                    icon: 'success',
                    timer: 2500,
                    showConfirmButton: false
                });
            } catch (err) {
                Swal.fire('Error', err.response?.data?.detail || 'Failed to update master image', 'error');
            }
        }
    };

    const handleExportPDF = async () => {
        if (comparisons.length === 0) return;

        try {
            Swal.fire({
                title: 'Generating PDF...',
                html: `
                    <div class="flex flex-col items-center justify-center py-4 px-2">
                        <div class="text-slate-500 text-sm mb-8 font-medium">Processing images...</div>
                        
                        <div class="flex items-center w-full max-w-xs mx-auto text-slate-500">
                            <div class="shrink-0 animate-pulse">
                                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>
                            </div>
                            
                            <div class="flex-1 mx-4 relative">
                                <div id="pdf-progress-text" class="absolute -top-5 left-0 right-0 text-center text-xs font-bold text-slate-500">0%</div>
                                <div class="h-1.5 w-full bg-slate-200 rounded-full overflow-hidden shadow-inner">
                                    <div id="pdf-progress-bar" class="h-full bg-slate-500 transition-all duration-300 ease-out rounded-full" style="width: 0%"></div>
                                </div>
                            </div>
                            
                            <div class="shrink-0">
                                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>
                            </div>
                        </div>
                    </div>
                `,
                allowOutsideClick: false,
                showConfirmButton: false
            });

            await new Promise(resolve => setTimeout(resolve, 800));

            const pdf = new jsPDF({ orientation: 'l', unit: 'mm', format: 'a4', compress: true });
            const pageWidth = pdf.internal.pageSize.getWidth();
            const pageHeight = pdf.internal.pageSize.getHeight();
            const margin = 10;
            const contentWidth = pageWidth - (margin * 2);

            const summaryElement = document.getElementById('report-summary');
            if (summaryElement) {
                const summaryCanvas = await html2canvas(summaryElement, { scale: 2, useCORS: true });
                const summaryImgData = summaryCanvas.toDataURL('image/jpeg', 0.9);
                const summaryHeight = (summaryCanvas.height * contentWidth) / summaryCanvas.width;
                pdf.addImage(summaryImgData, 'JPEG', margin, margin, contentWidth, summaryHeight);
            }

            for (let i = 0; i < comparisons.length; i++) {
                pdf.addPage();
                const item = comparisons[i];

                pdf.setFontSize(14);
                pdf.setTextColor(40, 40, 40);
                const filePrefix = `File: ${item.name}  `;
                pdf.text(filePrefix, margin, margin + 8);

                const textWidth = pdf.getTextWidth(filePrefix);

                if (item.status === 'FAIL') {
                    pdf.setTextColor(220, 38, 38);
                    const failText = `[ FAIL - ${item.diff_count} Spots ]`;
                    pdf.text(failText, margin + textWidth, margin + 8);

                    const failWidth = pdf.getTextWidth(failText + "  ");
                    pdf.setTextColor(150, 150, 150);
                    pdf.text(`(${i + 1}/${comparisons.length})`, margin + textWidth + failWidth, margin + 8);

                } else {
                    pdf.setTextColor(22, 163, 74);
                    const passText = `[ PASS ]`;
                    pdf.text(passText, margin + textWidth, margin + 8);

                    const passWidth = pdf.getTextWidth(passText + "  ");
                    pdf.setTextColor(150, 150, 150);
                    pdf.text(`(${i + 1}/${comparisons.length})`, margin + textWidth + passWidth, margin + 8);
                }

                const [imgA, imgB, imgDiff] = await Promise.all([
                    getImageDataUrl(item.a_img),
                    getImageDataUrl(item.b_img),
                    getImageDataUrl(item.diff_img)
                ]);

                const startY = margin + 15;
                const gap = 5;
                const colWidth = (contentWidth - (gap * 2)) / 3;

                const drawColumn = (label, imgData, x) => {
                    pdf.setFontSize(10);
                    pdf.setTextColor(100, 100, 100);
                    pdf.text(label, x, startY);

                    if (imgData) {
                        try {
                            const imgProps = pdf.getImageProperties(imgData);
                            let imgH = (imgProps.height * colWidth) / imgProps.width;
                            const maxHeight = pageHeight - startY - 10;
                            if (imgH > maxHeight) imgH = maxHeight;

                            pdf.addImage(imgData, 'JPEG', x, startY + 3, colWidth, imgH);
                            pdf.setDrawColor(230, 230, 230);
                            pdf.rect(x, startY + 3, colWidth, imgH);
                        } catch (e) { }
                    } else {
                        pdf.setDrawColor(220, 220, 220);
                        pdf.setFillColor(245, 245, 245);
                        pdf.rect(x, startY + 3, colWidth, colWidth * 0.56, 'FD');
                        pdf.setFontSize(8);
                        pdf.setTextColor(150, 150, 150);
                        pdf.text("Image Error", x + colWidth / 2, startY + 3 + (colWidth * 0.56) / 2, { align: "center" });
                    }
                };

                drawColumn("Reference (Master)", imgB, margin);
                drawColumn("New Image", imgA, margin + colWidth + gap);
                drawColumn("Difference", imgDiff, margin + (colWidth + gap) * 2);

                const progress = Math.round(((i + 1) / comparisons.length) * 100);
                const progressText = document.getElementById('pdf-progress-text');
                const progressBar = document.getElementById('pdf-progress-bar');

                if (progressText) progressText.innerText = progress + '%';
                if (progressBar) progressBar.style.width = progress + '%';
            }

            const flowName = selectedJob.flow_name || 'job';
            const safeFlowName = flowName.replaceAll(/[^\w\s-]/g, '').trim().replaceAll(/[-\s]+/g, '_') || 'job';
            pdf.save(`${safeFlowName}_${selectedJob.id}.pdf`);
            Swal.fire('Success', 'PDF Downloaded successfully', 'success');

        } catch (err) {
            console.error(err);
            Swal.fire('Error', 'PDF Generation Failed. Try again.', 'error');
        }
    };

    const groupedJobs = groupJobsByDay(jobs);
    const [showSidebar, setShowSidebar] = useState(true);

    return (
        <div className="flex h-full gap-3 sm:gap-4 lg:gap-6 p-2 sm:p-3 lg:p-4 bg-gray-100 relative">
            {previewImage && (
                <div
                    className="fixed inset-0 z-50 bg-black/90 flex flex-col backdrop-blur-sm"
                >
                    <button
                        type="button"
                        className="absolute inset-0 w-full h-full cursor-default border-none outline-none"
                        onClick={() => { setPreviewImage(null); setZoomLevel(1); setPan({ x: 0, y: 0 }); }}
                        aria-label="Close Preview"
                    />
                    <div className="flex justify-end p-4 gap-2 shrink-0 relative z-10 pointer-events-auto">
                        <button className="text-white bg-black/50 hover:bg-white/20 p-2 rounded transition-colors" onClick={(e) => { e.stopPropagation(); setZoomLevel(z => z + 0.5); setPan({ x: 0, y: 0 }); }}>
                            <ZoomIn size={24} />
                        </button>
                        <button className="text-white bg-black/50 hover:bg-white/20 p-2 rounded transition-colors" onClick={(e) => { e.stopPropagation(); setZoomLevel(z => Math.max(0.5, z - 0.5)); setPan({ x: 0, y: 0 }); }}>
                            <ZoomOut size={24} />
                        </button>
                        <button onClick={() => { setPreviewImage(null); setZoomLevel(1); setPan({ x: 0, y: 0 }); }} className="text-white bg-red-600/80 hover:bg-red-500/80 p-2 ml-4 transition-colors rounded">
                            <X size={24} />
                        </button>
                    </div>
                    <div
                        className="flex-1 overflow-hidden p-4 flex items-center justify-center cursor-grab active:cursor-grabbing relative z-10 pointer-events-auto"
                        onPointerDown={(e) => {
                            if (e.button !== 0) return;
                            dragOrigin.current = { x: e.clientX, y: e.clientY };
                            setIsDragging(true);
                            setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
                            e.currentTarget.setPointerCapture(e.pointerId);
                        }}
                        onPointerMove={(e) => {
                            if (isDragging) setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
                        }}
                        onPointerUp={(e) => {
                            setIsDragging(false);
                            try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (err) { }
                            const dist = Math.hypot(e.clientX - dragOrigin.current.x, e.clientY - dragOrigin.current.y);
                            if (dist < 5 && e.target.tagName !== 'IMG') {
                                setPreviewImage(null);
                                setZoomLevel(1);
                                setPan({ x: 0, y: 0 });
                            }
                        }}
                        onPointerCancel={() => setIsDragging(false)}
                        onWheel={(e) => {
                            e.preventDefault();
                            const newZoom = Math.max(0.5, zoomLevel - e.deltaY * 0.002);
                            if (newZoom > zoomLevel) {
                                const rect = e.currentTarget.getBoundingClientRect();
                                const dx = e.clientX - rect.left - rect.width / 2;
                                const dy = e.clientY - rect.top - rect.height / 2;
                                setPan({
                                    x: dx - (dx - pan.x) * (newZoom / zoomLevel),
                                    y: dy - (dy - pan.y) * (newZoom / zoomLevel)
                                });
                            } else if (newZoom < zoomLevel) {
                                setPan({ x: 0, y: 0 });
                            }
                            setZoomLevel(newZoom);
                        }}
                    >
                        <img
                            src={previewImage}
                            alt="Preview"
                            style={{
                                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoomLevel})`,
                                transition: isDragging ? 'none' : 'transform 0.1s',
                                transformOrigin: 'center center',
                                pointerEvents: 'auto'
                            }}
                            className="max-w-full max-h-full object-contain rounded-lg select-none"
                            draggable="false"
                        />
                    </div>
                </div>
            )}

            <button
                onClick={() => setShowSidebar(prev => !prev)}
                className={clsx(
                    "absolute top-2 sm:top-3 lg:top-4 z-30 p-2 bg-white border border-slate-200 rounded-lg shadow-md hover:bg-slate-50 transition-all duration-200 text-slate-600",
                    showSidebar ? "left-[17rem] sm:left-[18.5rem] lg:left-[21.5rem]" : "left-2 sm:left-3 lg:left-4"
                )}
                title={showSidebar ? 'Hide Job History' : 'Show Job History'}
            >
                {showSidebar ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
            </button>

            <div className={clsx(
                "bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col overflow-hidden h-full transition-all duration-300 shrink-0",
                showSidebar ? "w-64 sm:w-72 lg:w-80 opacity-100" : "w-0 opacity-0 border-0 overflow-hidden"
            )}>
                <div className="p-3 lg:p-4 border-b border-slate-100 bg-slate-50 flex flex-col gap-2 shrink-0">
                    <div className="flex justify-between items-center">
                        <span className="font-bold text-slate-700 text-sm lg:text-base whitespace-nowrap">Job History</span>
                        <span className="text-[10px] font-medium text-slate-400 bg-slate-200/60 px-2 py-0.5 rounded-full whitespace-nowrap">
                            Latest
                        </span>
                    </div>

                    <select
                        className={clsx(
                            "w-full text-xs sm:text-sm border-slate-300 rounded-lg p-1.5 focus:border-blue-500 focus:ring-blue-500",
                            !isAdmin && "bg-slate-100 cursor-not-allowed"
                        )}
                        value={selectedDeptId}
                        onChange={(e) => setSelectedDeptId(e.target.value)}
                        disabled={!isAdmin}
                    >
                        {isAdmin && <option value="">-- Choose Department --</option>}
                        {departments.map(d => (
                            <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                    </select>
                </div>
                <div className="flex-1 overflow-y-auto">
                    {groupedJobs.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-40 text-slate-400 text-sm">
                            <FileText size={24} className="mb-2 opacity-30" />
                            No Jobs
                        </div>
                    ) : null}
                    {groupedJobs.map(group => (
                        <div key={group.dateKey}>
                            <div className="sticky top-0 z-10 px-3 lg:px-4 py-2 lg:py-2.5 bg-gradient-to-r from-slate-100 to-slate-50 border-b border-slate-200 flex items-center justify-between">
                                <div className="flex items-center gap-1.5">
                                    <Calendar size={13} className="text-blue-500 shrink-0" />
                                    <span className="text-xs font-semibold text-slate-600 truncate">{group.label}</span>
                                </div>
                                <span className="text-[10px] text-slate-400 bg-white px-1.5 py-0.5 rounded border border-slate-200 whitespace-nowrap shrink-0">
                                    {group.jobs.length} job{group.jobs.length > 1 ? 's' : ''}
                                </span>
                            </div>
                            {group.jobs.map(job => (
                                <div
                                    key={job.id}
                                    className={clsx(
                                        "relative px-3 lg:px-4 py-2.5 lg:py-3 border-b border-slate-50 hover:bg-blue-50/50 transition-all duration-150 group/job",
                                        selectedJob?.id === job.id
                                            ? "bg-blue-50 border-l-4 border-l-blue-500 shadow-sm"
                                            : "border-l-4 border-l-transparent"
                                    )}
                                >
                                    <button
                                        type="button"
                                        onClick={() => { handleSelectJob(job); if (window.innerWidth < 640) setShowSidebar(false); }}
                                        className="absolute inset-0 w-full h-full cursor-pointer bg-transparent border-none outline-none"
                                        aria-label={`Select job ${job.id}`}
                                    />
                                    {job.username || job.department_name || job.squad_name ? (
                                        <div className="relative z-10 pointer-events-none text-[10px] font-medium text-slate-500 truncate mb-1">
                                            {[job.username, job.department_name, job.squad_name].filter(Boolean).join(' / ')}
                                        </div>
                                    ) : null}
                                    <div className="relative z-10 flex justify-between items-center pointer-events-none">
                                        <span className="font-mono text-xs font-bold text-slate-600 truncate mr-2">
                                            #{job.id}
                                        </span>
                                        <div className="flex items-center gap-1.5 shrink-0 pointer-events-auto">
                                            <button
                                                onClick={(e) => handleDeleteJob(e, job)}
                                                className="p-1 rounded opacity-0 group-hover/job:opacity-100 text-slate-300 hover:text-red-500 hover:bg-red-50 transition-all"
                                                title="Delete Job"
                                            >
                                                <Trash2 size={13} />
                                            </button>
                                            <span className={clsx(
                                                "text-[10px] font-medium px-1.5 py-0.5 rounded",
                                                job.status === 'COMPLETED'
                                                    ? "text-green-600 bg-green-50 border border-green-200"
                                                    : job.status === 'FAILED'
                                                        ? "text-red-600 bg-red-50 border border-red-200"
                                                        : "text-amber-600 bg-amber-50 border border-amber-200"
                                            )}>
                                                {job.status === 'COMPLETED' ? '✓ Completed' : job.status === 'FAILED' ? '❌ Failed' : '⏳ Processing'}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between mt-2">
                                        <div className="flex items-center gap-1 text-[11px] text-slate-400">
                                            <Clock size={11} className="text-slate-300" />
                                            {job.created_at ? formatTime(job.created_at) : 'Latest run'}
                                        </div>

                                        {(job.status === 'QUEUED' || job.status === 'PROCESSING') && jobProgress[job.job_id_str || job.id] && (
                                            <div className="flex items-center gap-2 w-32">
                                                <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                                                    <div
                                                        className="h-full bg-amber-400 bg-stripes animate-stripes transition-all duration-300"
                                                        style={{ width: `${jobProgress[job.job_id_str || job.id].percent}%` }}
                                                    ></div>
                                                </div>
                                                <span className="text-[10px] font-bold text-slate-500 w-6 text-right shrink-0">
                                                    {jobProgress[job.job_id_str || job.id].percent}%
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
                {selectedDeptId && (
                    <div className="p-2 lg:p-2.5 border-t border-slate-100 bg-slate-50/50 text-center shrink-0">
                        <span className="text-[10px] text-slate-400 whitespace-nowrap">
                            {selectedDeptId
                                ? `📦 Max ${maxJobs} Jobs — Oldest will be auto-deleted`
                                : `📦 Showing latest ${maxDashJobs} Jobs globally`
                            }
                        </span>
                    </div>
                )}
            </div>

            <div className="flex-1 bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col overflow-hidden h-full min-w-0">
                {selectedJob ? (
                    <>
                        <div className="p-3 sm:p-4 lg:p-6 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-white z-10 shrink-0">
                            <div className="min-w-0">
                                <h2 className="text-lg sm:text-xl lg:text-2xl font-bold text-slate-800 flex items-center gap-2 flex-wrap">
                                    <span className="flex flex-col">
                                        <span className="whitespace-nowrap">{selectedJob.flow_name || 'Test Report'}</span>
                                        <span className="text-sm font-medium text-slate-400">#{selectedJob.id}</span>
                                    </span>
                                    <span className="text-xs sm:text-sm font-normal text-slate-400 px-2 py-1 bg-slate-100 rounded-lg">
                                        {comparisons.length} Images
                                    </span>
                                    {(selectedJob?.status === 'QUEUED' || selectedJob?.status === 'PROCESSING') && (
                                        <span className="text-xs sm:text-sm font-medium text-amber-600 px-2 py-1 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-1">
                                            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                                            <span>Processing...</span>
                                        </span>
                                    )}
                                </h2>
                            </div>
                            <div className="flex gap-2 shrink-0 w-full sm:w-auto">
                                <button onClick={() => handleHeal('all')} disabled={selectedJob.status !== 'COMPLETED'} className="flex items-center justify-center gap-2 px-3 lg:px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors flex-1 sm:flex-none text-sm" title="Accept all new images as Master">
                                    <RefreshCw size={18} /> <span className="hidden sm:inline">Update Master</span>
                                </button>
                                <button onClick={handleExportPDF} disabled={selectedJob.status !== 'COMPLETED'} className="flex items-center justify-center gap-2 px-3 lg:px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors flex-1 sm:flex-none text-sm">
                                    <Download size={18} /> <span className="hidden sm:inline">Export PDF</span>
                                </button>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto p-0 sm:p-0 lg:p-0 bg-slate-50" id="report-content-container">
                            {selectedJob.status === 'QUEUED' || selectedJob.status === 'PROCESSING' ? (
                                <ScannerLoader />
                            ) : isLoadingDetails ? (
                                <div className="p-3 sm:p-5 lg:p-8 animate-pulse space-y-6">
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 lg:gap-6">
                                        {[1, 2, 3].map(i => (
                                            <div key={i} className="bg-white p-6 rounded-lg shadow-sm border border-slate-200 flex flex-col items-center justify-center space-y-3">
                                                <div className="h-8 w-16 bg-slate-200 rounded"></div>
                                                <div className="h-3 w-24 bg-slate-200 rounded"></div>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                                        {[1, 2, 3].map(i => (
                                            <div key={i} className="border-b border-slate-100 p-4 sm:p-6 flex flex-col gap-4">
                                                <div className="flex justify-between items-center">
                                                    <div className="h-5 w-48 bg-slate-200 rounded"></div>
                                                    <div className="h-6 w-20 bg-slate-200 rounded-full"></div>
                                                </div>
                                                <div className="grid grid-cols-3 gap-4">
                                                    <div className="aspect-video bg-slate-100 rounded border border-slate-200"></div>
                                                    <div className="aspect-video bg-slate-100 rounded border border-slate-200"></div>
                                                    <div className="aspect-video bg-slate-100 rounded border border-slate-200"></div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <div className="p-3 sm:p-5 lg:p-8">
                                    {selectedJob.status === 'FAILED' && (
                                        <div className="mb-6 p-4 bg-red-50 border-l-4 border-red-500 rounded-r text-red-700">
                                            <h3 className="font-bold flex items-center gap-2"><AlertTriangle size={18} /> Job Processing Failed</h3>
                                            <p className="mt-1 text-sm">{selectedJob.error_message || "An unexpected error occurred during processing."}</p>
                                        </div>
                                    )}

                                    <div id="report-summary">
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 lg:gap-6 mb-6 lg:mb-8">
                                    <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200 text-center">
                                        <div className="text-3xl font-bold text-slate-800 mb-1">{stats.total}</div>
                                        <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Total Files</div>
                                    </div>
                                    <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200 text-center">
                                        <div className="text-3xl font-bold text-green-600 mb-1">{stats.passed}</div>
                                        <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Passed</div>
                                    </div>
                                    <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200 text-center">
                                        <div className={clsx("text-3xl font-bold mb-1", stats.totalDiffPoints > 0 ? "text-red-600" : "text-blue-600")}>
                                            {stats.totalDiffPoints}
                                        </div>
                                        <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Total Diff Points</div>
                                        {stats.failed > 0 && (
                                            <div className="text-[10px] text-red-400 mt-1">
                                                (from {stats.failed} failed files)
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-4 sm:space-y-6 lg:space-y-8">
                                {comparisons.map((c, idx) => (
                                    <div key={idx} className={clsx("comparison-row bg-white rounded-lg shadow-sm border overflow-hidden break-inside-avoid", c.status === 'FAIL' ? "border-red-300 ring-1 ring-red-100" : "border-slate-200")}>
                                        <div className={clsx("px-3 lg:px-4 py-2.5 lg:py-3 border-b flex flex-wrap justify-between items-center gap-2", c.status === 'FAIL' ? "bg-red-50 border-red-100" : "bg-slate-50 border-slate-100")}>
                                            <span className="font-mono text-xs sm:text-sm font-bold text-slate-700 truncate min-w-0">{c.name}</span>
                                            <div className="flex items-center gap-2 shrink-0">
                                                {c.status === 'FAIL' && (
                                                    <button onClick={() => handleHeal(c.name)} className="flex items-center gap-1 text-xs font-bold px-2 py-1 rounded text-indigo-600 bg-white hover:bg-indigo-50 border border-indigo-200 shadow-sm transition-all" title="Accept this new image as Master">
                                                        <RefreshCw size={13} /> Change Master
                                                    </button>
                                                )}
                                                {c.status === 'FAIL' ? (
                                                    <span className="flex items-center gap-1 text-xs font-bold px-2 py-1 rounded text-red-600 bg-white border border-red-200 shadow-sm shrink-0">
                                                        <AlertTriangle size={14} /> {c.diff_count} Diff
                                                    </span>
                                                ) : (
                                                    <span className="flex items-center gap-1 text-xs font-bold px-2 py-1 rounded text-green-600 bg-white border border-green-200 shadow-sm shrink-0">
                                                        <CheckCircle size={14} /> Passed
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
                                            {['Reference (Master)', 'New Image', 'Difference'].map((label, i) => {
                                                let imgSrc;
                                                if (i === 0) imgSrc = c.b_img;
                                                else if (i === 1) imgSrc = c.a_img;
                                                else imgSrc = c.diff_img;

                                                return (
                                                    <div key={i} className="p-2 sm:p-3 lg:p-4 relative group">
                                                        <div className="text-[10px] font-bold text-slate-400 uppercase mb-1.5 sm:mb-2 flex justify-between">
                                                            {label}
                                                            <ZoomIn size={14} className="opacity-0 group-hover:opacity-100 text-blue-500" />
                                                        </div>
                                                        <button type="button" className="w-full aspect-[16/9] bg-slate-100 rounded flex items-center justify-center overflow-hidden border border-slate-100 cursor-zoom-in hover:border-blue-300 p-0" onClick={() => { setPreviewImage(imgSrc); setZoomLevel(1); setPan({ x: 0, y: 0 }); }} aria-label={`View ${label} fullscreen`}>
                                                            <img src={imgSrc} className="w-full h-full object-contain pointer-events-none" onError={(e) => { e.target.style.display = 'none'; }} alt={label} />
                                                        </button>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ))}
                            </div>
                                    </div>
                            )}
                        </div>
                    </>
                ) : (
                    <div className="flex flex-col items-center justify-center h-full text-slate-400">
                        <FileText size={48} className="mb-4 opacity-20" />
                        <p>Select a job to view report</p>
                    </div>
                )}
            </div>
        </div>
    );
}