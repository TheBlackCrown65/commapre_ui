/* eslint-disable react/prop-types */
import { useState, useEffect, useRef } from 'react';
import client, { API_URL } from '../api/client';
import { Download, CheckCircle, AlertCircle, X, ZoomIn, ZoomOut, AlertTriangle, FileText, Calendar, Clock, PanelLeftOpen, PanelLeftClose, Trash2, RefreshCw, MessageSquare, Eye, ChevronLeft, ChevronRight } from 'lucide-react';
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
                key,
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
    const [previewComparison, setPreviewComparison] = useState(null);
    const [zoomLevel, setZoomLevel] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const dragOrigin = useRef({ x: 0, y: 0 });

    const [compZoom, setCompZoom] = useState(1);
    const [compPan, setCompPan] = useState({ x: 0, y: 0 });
    const [compDragging, setCompDragging] = useState(false);
    const [compDragStart, setCompDragStart] = useState({ x: 0, y: 0 });
    const compDragOrigin = useRef({ x: 0, y: 0 });
    const [stats, setStats] = useState({ total: 0, passed: 0, failed: 0, mismatched: 0, totalDiffPoints: 0 });

    const diffItems = comparisons.filter(c => c.status === 'FAIL' || c.status === 'MISMATCH');
    const currentDiffIndex = previewComparison ? diffItems.findIndex(c => c.name === previewComparison.name) : -1;

    useEffect(() => {
        setCompZoom(1);
        setCompPan({ x: 0, y: 0 });
    }, [previewComparison?.name]);

    useEffect(() => {
        if (!previewComparison) return;
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                setPreviewComparison(null);
            } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowUp') && currentDiffIndex > 0) {
                setPreviewComparison(diffItems[currentDiffIndex - 1]);
            } else if ((e.key === 'ArrowRight' || e.key === 'ArrowDown') && currentDiffIndex < diffItems.length - 1) {
                setPreviewComparison(diffItems[currentDiffIndex + 1]);
            } else if (e.key === '+' || e.key === '=') {
                setCompZoom(z => Math.min(3.0, Number((z + 0.25).toFixed(2))));
            } else if (e.key === '-' || e.key === '_') {
                setCompZoom(z => Math.max(0.5, Number((z - 0.25).toFixed(2))));
            } else if (e.key === '0') {
                setCompZoom(1);
                setCompPan({ x: 0, y: 0 });
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [previewComparison, currentDiffIndex, diffItems]);
    const [departments, setDepartments] = useState([]);
    const [maxJobs, setMaxJobs] = useState(10);
    const [maxDashJobs, setMaxDashJobs] = useState(10);
    const [maxNoteLength, setMaxNoteLength] = useState(500);
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

                const maxNoteConf = configRes.data.find(c => c.key === 'max_flow_note_length');
                if (maxNoteConf) setMaxNoteLength(Number.parseInt(maxNoteConf.value, 10) || 500);
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
                if (data.job_id && data.progress) {
                    setJobProgress(prev => ({
                        ...prev,
                        [String(data.job_id)]: data.progress
                    }));
                }
            } catch { }
        });

        eventSource.addEventListener('flow_updated', () => {
            if (selectedJobRef.current?.flow_id) {
                client.get(`/api/v1/flows/${selectedJobRef.current.flow_id}`)
                    .then(res => {
                        if (res.data) {
                            setSelectedJob(prev => prev ? { ...prev, flow_note: res.data.note } : prev);
                        }
                    })
                    .catch(() => { });
            }
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
                    setStats({ total: 0, passed: 0, failed: 0, mismatched: 0, totalDiffPoints: 0 });
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
            if (data.flow_id || data.flow_name || data.flow_note !== undefined) {
                setSelectedJob(prev => prev ? ({
                    ...prev,
                    flow_id: data.flow_id || prev.flow_id,
                    flow_name: data.flow_name || prev.flow_name,
                    flow_note: data.flow_note !== undefined ? data.flow_note : prev.flow_note
                }) : prev);
            }
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
            const mismatched = results.filter(r => r.status === 'MISMATCH').length;
            const passed = total - failed - mismatched;
            const totalDiffPoints = results.reduce((sum, r) => sum + (r.diff_count > 0 ? r.diff_count : 0), 0);

            setStats({ total, passed, failed, mismatched, totalDiffPoints });

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

    const getImageDataUrl = async (url) => {
        if (!url) return null;
        try {
            const res = await fetch(url);
            if (res.ok) {
                const blob = await res.blob();
                return await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.onerror = () => resolve(null);
                    reader.readAsDataURL(blob);
                });
            }
        } catch (e) {
            console.warn("Direct image fetch failed, using fallback:", e);
        }

        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'Anonymous';
            img.src = url;

            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);

                try {
                    resolve(canvas.toDataURL('image/png'));
                } catch (e) {
                    try {
                        resolve(canvas.toDataURL('image/jpeg', 0.95));
                    } catch (err) {
                        resolve(null);
                    }
                }
            };

            img.onerror = () => resolve(null);
        });
    };

    const openFlowNoteModal = async (flowId, flowName, initialNote = '', isAfterRemaster = false) => {
        let currentNote = initialNote;
        if (flowId) {
            try {
                const flowRes = await client.get(`/api/v1/flows/${flowId}`);
                if (flowRes.data && flowRes.data.note !== undefined) {
                    currentNote = flowRes.data.note || '';
                }
            } catch (e) {
                // fallback to initialNote
            }
        }

        const htmlBanner = isAfterRemaster
            ? `<div style="font-size: 13px; color: #16a34a; font-weight: 500; margin-bottom: 10px;">✓ Master image updated successfully! Add or update a note for this flow:</div>`
            : undefined;

        const { value: note, isConfirmed } = await Swal.fire({
            title: `📝 Note — ${flowName}`,
            html: htmlBanner,
            input: 'textarea',
            inputValue: currentNote || '',
            inputPlaceholder: 'Add details or comment for this flow (e.g. why master was updated, ticket number, etc.)...',
            inputAttributes: {
                maxlength: maxNoteLength,
                style: 'height: 150px; font-size: 14px;'
            },
            showCancelButton: true,
            confirmButtonText: 'Save Note',
            cancelButtonText: isAfterRemaster ? 'Skip' : 'Cancel',
            confirmButtonColor: '#4f46e5',
            cancelButtonColor: '#64748b',
            footer: `<span id="swal-note-counter" style="color:#94a3b8;font-size:12px">${(currentNote || '').length}/${maxNoteLength} characters</span>`,
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
            }
        });

        if (isConfirmed && note !== undefined) {
            try {
                await client.put(`/api/v1/flows/${flowId}`, { note: note });
                setSelectedJob(prev => prev ? { ...prev, flow_note: note } : prev);
                Swal.fire({
                    title: isAfterRemaster ? 'Updated!' : 'Saved',
                    text: isAfterRemaster ? 'Master image and flow note updated successfully.' : 'Flow note updated.',
                    icon: 'success',
                    timer: 2000,
                    showConfirmButton: false
                });
            } catch (err) {
                const msg = err.response?.data?.detail || 'Failed to save note';
                Swal.fire('Error', msg, 'error');
            }
        } else if (isAfterRemaster) {
            Swal.fire({
                title: 'Master Image Updated!',
                text: 'The master images have been updated. It will take effect on your next test run.',
                icon: 'success',
                timer: 2000,
                showConfirmButton: false
            });
        }
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
                const healRes = await client.post(`/api/v1/jobs/${selectedJob.id}/heal`, { filename });
                const flowId = healRes.data?.flow_id || selectedJob?.flow_id;
                const flowName = healRes.data?.flow_name || selectedJob?.flow_name || 'Flow';
                const flowNote = healRes.data?.flow_note !== undefined ? healRes.data.flow_note : (selectedJob?.flow_note || '');

                if (flowId) {
                    await openFlowNoteModal(flowId, flowName, flowNote, true);
                } else {
                    Swal.fire({
                        title: 'Master Image Updated!',
                        text: 'The master images have been updated. It will take effect on your next test run.',
                        icon: 'success',
                        timer: 2500,
                        showConfirmButton: false
                    });
                }
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

            // Image cache to avoid duplicate network/canvas processing
            const imageCache = new Map();
            const fetchCachedImageDataUrl = async (url) => {
                if (!url) return null;
                if (imageCache.has(url)) return imageCache.get(url);
                const data = await getImageDataUrl(url);
                imageCache.set(url, data);
                return data;
            };

            // Pre-check first comparison item's dimensions to determine default PDF orientation
            let isFirstJobMobile = false;
            if (comparisons.length > 0) {
                const sampleItem = comparisons[0];
                const sampleUrl = sampleItem.b_img || sampleItem.a_img || sampleItem.diff_img;
                if (sampleUrl) {
                    const sampleData = await fetchCachedImageDataUrl(sampleUrl);
                    if (sampleData) {
                        try {
                            const tempPdf = new jsPDF();
                            const props = tempPdf.getImageProperties(sampleData);
                            if (props && props.width && props.height) {
                                // สูงมากกว่ากว้าง = mobile
                                isFirstJobMobile = props.height > props.width;
                            }
                        } catch (e) {
                            console.warn("Could not detect initial orientation:", e);
                        }
                    }
                }
            }

            const initialOrientation = isFirstJobMobile ? 'l' : 'p';
            const pdf = new jsPDF({ orientation: initialOrientation, unit: 'mm', format: 'a4', compress: true });
            const pageWidth = pdf.internal.pageSize.getWidth();
            const pageHeight = pdf.internal.pageSize.getHeight();
            const margin = 10;
            const contentWidth = pageWidth - (margin * 2);

            // Draw Summary Cards natively in jsPDF (consistent vector layout across all screen aspect ratios 16:9 / 16:10)
            const cardGap = 5;
            const cardWidth = (contentWidth - (cardGap * 2)) / 3;
            const cardHeight = 26;
            const cardY = margin + 2;

            const drawSummaryCard = (x, value, label, subtext, valueColor, subtextColor) => {
                pdf.setFillColor(255, 255, 255);
                pdf.setDrawColor(226, 232, 240); // slate-200
                pdf.roundedRect(x, cardY, cardWidth, cardHeight, 2, 2, 'FD');

                const centerX = x + cardWidth / 2;

                if (subtext) {
                    // 3 lines: perfectly distributed vertically
                    pdf.setFontSize(20);
                    pdf.setFont(undefined, 'bold');
                    pdf.setTextColor(...valueColor);
                    pdf.text(String(value), centerX, cardY + 9.5, { align: 'center' });

                    pdf.setFontSize(8.5);
                    pdf.setFont(undefined, 'bold');
                    pdf.setTextColor(148, 163, 184); // slate-400
                    pdf.text(label.toUpperCase(), centerX, cardY + 16, { align: 'center' });

                    pdf.setFontSize(7);
                    pdf.setFont(undefined, 'bold');
                    pdf.setTextColor(...subtextColor);
                    pdf.text(subtext, centerX, cardY + 21.5, { align: 'center' });
                } else {
                    // 2 lines: perfectly centered vertically in the 26mm card
                    pdf.setFontSize(22);
                    pdf.setFont(undefined, 'bold');
                    pdf.setTextColor(...valueColor);
                    pdf.text(String(value), centerX, cardY + 12.5, { align: 'center' });

                    pdf.setFontSize(8.5);
                    pdf.setFont(undefined, 'bold');
                    pdf.setTextColor(148, 163, 184); // slate-400
                    pdf.text(label.toUpperCase(), centerX, cardY + 19, { align: 'center' });
                }
            };

            drawSummaryCard(margin, stats.total, "Total Files", null, [30, 41, 59]); // slate-800
            drawSummaryCard(margin + cardWidth + cardGap, stats.passed, "Passed", null, [22, 163, 74]); // green-600

            const diffColor = stats.totalDiffPoints > 0 ? [220, 38, 38] : [37, 99, 235];
            const subtext = (stats.failed > 0 || stats.mismatched > 0) ? `(from ${stats.failed} failed, ${stats.mismatched} mismatched)` : null;
            drawSummaryCard(margin + (cardWidth + cardGap) * 2, stats.totalDiffPoints, "Total Diff Points", subtext, diffColor, [239, 68, 68]);

            let firstPageY = cardY + cardHeight + 8;

            // Draw Flow Name in the empty space
            const reportTitle = selectedJob.flow_name || 'Test Report';
            pdf.setTextColor(40, 40, 40);

            // Dynamic font size to fit single line
            let titleFontSize = 36;
            pdf.setFontSize(titleFontSize);
            const maxTitleWidth = pageWidth - (margin * 4); // Add extra padding

            while (pdf.getTextWidth(reportTitle) > maxTitleWidth && titleFontSize > 12) {
                titleFontSize -= 2;
                pdf.setFontSize(titleFontSize);
            }

            // Calculate middle of the remaining space
            const centerY = firstPageY + (pageHeight - firstPageY) / 2;

            pdf.text(reportTitle, pageWidth / 2, centerY - 10, { align: 'center' });

            // Add Job ID below it
            pdf.setFontSize(16);
            pdf.setTextColor(150, 150, 150);
            pdf.text(`Job ID: #${selectedJob.id}`, pageWidth / 2, centerY + 5, { align: 'center' });

            for (let i = 0; i < comparisons.length; i++) {
                const item = comparisons[i];

                const [imgA, imgB, imgDiff] = await Promise.all([
                    fetchCachedImageDataUrl(item.a_img),
                    fetchCachedImageDataUrl(item.b_img),
                    fetchCachedImageDataUrl(item.diff_img)
                ]);

                // Determine whether this item is mobile or web based on image dimensions
                // สูงมากกว่ากว้าง = mobile (landscape page, horizontal 3 columns)
                // สูงน้อยกว่ากว้าง = web (portrait page, vertical 3 rows)
                const sampleImg = imgB || imgA || imgDiff;
                let isMobile = false; // default web
                let sampleProps = null;
                if (sampleImg) {
                    try {
                        sampleProps = pdf.getImageProperties(sampleImg);
                        if (sampleProps && sampleProps.width && sampleProps.height) {
                            isMobile = sampleProps.height > sampleProps.width;
                        }
                    } catch (e) {
                        console.warn("Could not determine image properties:", e);
                    }
                }

                // Add page: mobile -> landscape ('l'), web -> portrait ('p')
                pdf.addPage('a4', isMobile ? 'l' : 'p');
                const curPageWidth = pdf.internal.pageSize.getWidth();
                const curPageHeight = pdf.internal.pageSize.getHeight();
                const curContentWidth = curPageWidth - (margin * 2);

                // --- Header (File name, Status Badge, Counter) ---
                let headerFontSize = 14;
                pdf.setFontSize(headerFontSize);
                pdf.setTextColor(40, 40, 40);

                let badgeText = "";
                let badgeColor = [0, 0, 0];
                if (item.status === 'FAIL') {
                    badgeText = ` FAIL - ${item.diff_count} Spots `;
                    badgeColor = [239, 68, 68]; // Tailwind red-500
                } else if (item.status === 'MISMATCH') {
                    badgeText = ` PAGE MISMATCH `;
                    badgeColor = [249, 115, 22]; // Tailwind orange-500
                } else {
                    badgeText = ` PASS `;
                    badgeColor = [34, 197, 94]; // Tailwind green-500
                }

                pdf.setFontSize(12);
                pdf.setFont(undefined, 'bold');
                const badgeTextWidth = pdf.getTextWidth(badgeText);
                const badgeHeight = 7.5;

                // Adjust font size if file name is long to prevent header overflow
                pdf.setFontSize(headerFontSize);
                pdf.setFont(undefined, 'normal');
                while (margin + pdf.getTextWidth(`File: ${item.name}  `) + badgeTextWidth + 35 > curPageWidth && headerFontSize > 9) {
                    headerFontSize -= 1;
                    pdf.setFontSize(headerFontSize);
                }

                const filePrefix = `File: ${item.name}  `;
                pdf.text(filePrefix, margin, margin + 8);
                const textWidth = pdf.getTextWidth(filePrefix);

                const badgeX = margin + textWidth;
                const badgeY = margin + 1.8;

                pdf.setFillColor(...badgeColor);
                pdf.roundedRect(badgeX, badgeY, badgeTextWidth, badgeHeight, 1, 1, 'F');

                pdf.setTextColor(255, 255, 255);
                pdf.setFontSize(12);
                pdf.setFont(undefined, 'bold');
                pdf.text(badgeText, badgeX, margin + 7);

                pdf.setFont(undefined, 'normal');
                pdf.setFontSize(headerFontSize);
                pdf.setTextColor(150, 150, 150);
                pdf.text(` (${i + 1}/${comparisons.length})`, badgeX + badgeTextWidth + 2, margin + 7.5);

                if (isMobile) {
                    // ==========================================
                    // Mobile: รูปเรียงแนวนอน (3 Columns Side-by-Side)
                    // ==========================================
                    const startY = margin + 15;
                    const gap = 5;
                    const colWidth = (curContentWidth - (gap * 2)) / 3;

                    const drawColumn = (label, imgData, x) => {
                        pdf.setFontSize(10);
                        pdf.setFont(undefined, 'bold');
                        pdf.setTextColor(100, 100, 100);
                        pdf.text(label, x, startY);

                        if (imgData) {
                            try {
                                const imgProps = pdf.getImageProperties(imgData);
                                let imgW = colWidth;
                                let imgH = (imgProps.height * colWidth) / imgProps.width;
                                const maxHeight = curPageHeight - startY - 10;
                                if (imgH > maxHeight) {
                                    imgH = maxHeight;
                                    imgW = (imgProps.width * imgH) / imgProps.height;
                                }

                                const drawX = x + (colWidth - imgW) / 2;
                                const imgFmt = (typeof imgData === 'string' && imgData.startsWith('data:image/png')) ? 'PNG' : 'JPEG';
                                pdf.addImage(imgData, imgFmt, drawX, startY + 3, imgW, imgH);
                                pdf.setDrawColor(140, 140, 140);
                                pdf.rect(drawX, startY + 3, imgW, imgH);
                            } catch (e) { }
                        } else {
                            pdf.setDrawColor(150, 150, 150);
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
                } else {
                    // ==========================================
                    // Web: รูปเรียงแนวตั้ง (3 Rows Stacked Vertically)
                    // ==========================================
                    const startY = margin + 14;
                    const bottomMargin = 10;
                    const availableHeight = curPageHeight - startY - bottomMargin;
                    const labelH = 4;
                    const labelGap = 1.5;

                    const minRowGap = 3;
                    const maxRowH = Math.floor((availableHeight - (3 * (labelH + labelGap) + 2 * minRowGap)) / 3);
                    const maxRowW = curContentWidth;

                    let targetW = maxRowW;
                    let targetH = maxRowH;

                    if (sampleProps && sampleProps.width && sampleProps.height) {
                        const calculatedH = (sampleProps.height * maxRowW) / sampleProps.width;
                        if (calculatedH > maxRowH) {
                            targetH = maxRowH;
                            targetW = (sampleProps.width * maxRowH) / sampleProps.height;
                        } else {
                            targetH = calculatedH;
                            targetW = maxRowW;
                        }
                    }

                    const imgX = margin + (curContentWidth - targetW) / 2;
                    const totalUsedHeight = 3 * targetH + 3 * (labelH + labelGap);
                    const rowGap = Math.min(8, Math.max(3, (availableHeight - totalUsedHeight) / 2));

                    const drawRow = (label, imgData, rowIndex) => {
                        const rowY = startY + rowIndex * (targetH + labelH + labelGap + rowGap);

                        pdf.setFontSize(9.5);
                        pdf.setFont(undefined, 'bold');
                        pdf.setTextColor(100, 100, 100);
                        pdf.text(label, imgX, rowY + labelH);

                        const imgY = rowY + labelH + labelGap;

                        if (imgData) {
                            try {
                                const imgFmt = (typeof imgData === 'string' && imgData.startsWith('data:image/png')) ? 'PNG' : 'JPEG';
                                pdf.addImage(imgData, imgFmt, imgX, imgY, targetW, targetH);
                                pdf.setDrawColor(140, 140, 140);
                                pdf.rect(imgX, imgY, targetW, targetH);
                            } catch (e) { }
                        } else {
                            pdf.setDrawColor(150, 150, 150);
                            pdf.setFillColor(245, 245, 245);
                            pdf.rect(imgX, imgY, targetW, targetH, 'FD');
                            pdf.setFontSize(8);
                            pdf.setTextColor(150, 150, 150);
                            pdf.text("Image Error", imgX + targetW / 2, imgY + targetH / 2, { align: "center" });
                        }
                    };

                    drawRow("Reference (Master)", imgB, 0);
                    drawRow("New Image", imgA, 1);
                    drawRow("Difference", imgDiff, 2);
                }

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
            {/* 3-Image Side-by-Side Comparison Modal (PDF-Style with Pan & Zoom) */}
            {previewComparison && (
                <div
                    className="fixed inset-0 z-50 flex flex-col items-center justify-center p-2 sm:p-4"
                >
                    <button
                        type="button"
                        className="fixed inset-0 bg-black/85 backdrop-blur-sm w-full h-full border-none outline-none cursor-default"
                        onClick={() => setPreviewComparison(null)}
                        aria-label="Close comparison preview"
                    />
                    <div
                        className="bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col max-w-[98vw] xl:max-w-[1800px] w-full h-[95vh] overflow-hidden z-10"
                    >
                        {/* Modal Header */}
                        <div className="px-4 sm:px-6 py-2.5 border-b border-slate-200 flex items-center justify-between gap-3 bg-slate-50/95 shrink-0 z-20">
                            <div className="flex items-center gap-2 sm:gap-3 flex-wrap min-w-0">
                                <span className="font-mono text-sm sm:text-base font-bold text-slate-800 truncate">
                                    File: {previewComparison.name}
                                </span>
                                {previewComparison.status === 'FAIL' ? (
                                    <span className="px-2.5 py-0.5 text-xs font-bold text-white bg-red-500 rounded-full shadow-sm flex items-center gap-1">
                                        <AlertTriangle size={13} /> FAIL — {previewComparison.diff_count} Spots
                                    </span>
                                ) : previewComparison.status === 'MISMATCH' ? (
                                    <span className="px-2.5 py-0.5 text-xs font-bold text-white bg-orange-500 rounded-full shadow-sm flex items-center gap-1">
                                        <AlertTriangle size={13} /> PAGE MISMATCH
                                    </span>
                                ) : (
                                    <span className="px-2.5 py-0.5 text-xs font-bold text-white bg-green-500 rounded-full shadow-sm flex items-center gap-1">
                                        <CheckCircle size={13} /> PASSED
                                    </span>
                                )}
                                {diffItems.length > 1 && currentDiffIndex !== -1 && (
                                    <span className="text-xs font-semibold text-slate-500 bg-slate-200/70 px-2 py-0.5 rounded-full">
                                        ({currentDiffIndex + 1}/{diffItems.length})
                                    </span>
                                )}
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                                {/* Zoom Controls */}
                                <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200">
                                    <button
                                        type="button"
                                        disabled={compZoom <= 0.5}
                                        onClick={() => {
                                            setCompZoom(z => Math.max(0.5, Number((z - 0.25).toFixed(2))));
                                        }}
                                        className="p-1 rounded text-slate-600 hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                                        title="Zoom Out (-)"
                                    >
                                        <ZoomOut size={16} />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setCompZoom(1);
                                            setCompPan({ x: 0, y: 0 });
                                        }}
                                        className="text-xs font-mono font-bold px-2 py-0.5 rounded text-slate-700 hover:bg-slate-200 transition-all"
                                        title="Reset Zoom (0)"
                                    >
                                        {Math.round(compZoom * 100)}%
                                    </button>
                                    <button
                                        type="button"
                                        disabled={compZoom >= 3.0}
                                        onClick={() => {
                                            setCompZoom(z => Math.min(3.0, Number((z + 0.25).toFixed(2))));
                                        }}
                                        className="p-1 rounded text-slate-600 hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                                        title="Zoom In (+)"
                                    >
                                        <ZoomIn size={16} />
                                    </button>
                                </div>

                                {diffItems.length > 1 && (
                                    <div className="flex items-center gap-1 border-l border-slate-200 pl-2">
                                        <button
                                            type="button"
                                            disabled={currentDiffIndex <= 0}
                                            onClick={() => setPreviewComparison(diffItems[currentDiffIndex - 1])}
                                            className="p-1.5 rounded-lg text-slate-600 hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                                            title="Previous Diff (Arrow Left)"
                                        >
                                            <ChevronLeft size={18} />
                                        </button>
                                        <button
                                            type="button"
                                            disabled={currentDiffIndex >= diffItems.length - 1}
                                            onClick={() => setPreviewComparison(diffItems[currentDiffIndex + 1])}
                                            className="p-1.5 rounded-lg text-slate-600 hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                                            title="Next Diff (Arrow Right)"
                                        >
                                            <ChevronRight size={18} />
                                        </button>
                                    </div>
                                )}
                                {(previewComparison.status === 'FAIL' || previewComparison.status === 'MISMATCH') && (
                                    <button
                                        type="button"
                                        onClick={async () => {
                                            await handleHeal(previewComparison.name);
                                        }}
                                        className="flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-lg text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 transition-all shadow-sm"
                                        title="Accept this new image as Master"
                                    >
                                        <RefreshCw size={13} /> Change Master
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={() => setPreviewComparison(null)}
                                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-all"
                                    aria-label="Close Preview"
                                >
                                    <X size={20} />
                                </button>
                            </div>
                        </div>

                        {/* Modal Body: Zoomable & Draggable Canvas */}
                        <div
                            className="flex-1 relative overflow-hidden bg-slate-100/90 flex items-center justify-center cursor-grab active:cursor-grabbing select-none"
                            onPointerDown={(e) => {
                                if (e.button !== 0) return;
                                compDragOrigin.current = { x: e.clientX, y: e.clientY };
                                setCompDragging(true);
                                setCompDragStart({ x: e.clientX - compPan.x, y: e.clientY - compPan.y });
                                e.currentTarget.setPointerCapture(e.pointerId);
                            }}
                            onPointerMove={(e) => {
                                if (compDragging) {
                                    setCompPan({
                                        x: e.clientX - compDragStart.x,
                                        y: e.clientY - compDragStart.y
                                    });
                                }
                            }}
                            onPointerUp={(e) => {
                                setCompDragging(false);
                                try {
                                    e.currentTarget.releasePointerCapture(e.pointerId);
                                } catch (err) { }
                                const dist = Math.hypot(e.clientX - compDragOrigin.current.x, e.clientY - compDragOrigin.current.y);
                                if (dist < 6) {
                                    setPreviewComparison(null);
                                }
                            }}
                            onPointerCancel={() => setCompDragging(false)}
                            onWheel={(e) => {
                                e.preventDefault();
                                const target = e.currentTarget;
                                if (!target) return;
                                const rect = target.getBoundingClientRect();
                                const clientX = e.clientX;
                                const clientY = e.clientY;
                                const delta = e.deltaY;
                                if (!delta) return;

                                const zoomStep = delta < 0 ? 0.25 : -0.25;
                                const newZoom = Math.max(0.5, Math.min(3.0, Number((compZoom + zoomStep).toFixed(2))));
                                if (newZoom === compZoom) return;

                                if (newZoom <= 1) {
                                    setCompPan({ x: 0, y: 0 });
                                } else {
                                    const dx = clientX - rect.left - rect.width / 2;
                                    const dy = clientY - rect.top - rect.height / 2;
                                    setCompPan({
                                        x: dx - (dx - compPan.x) * (newZoom / compZoom),
                                        y: dy - (dy - compPan.y) * (newZoom / compZoom)
                                    });
                                }
                                setCompZoom(newZoom);
                            }}
                        >
                            {/* Scaled & Panned 3-Image Container */}
                            <div
                                style={{
                                    transform: `translate(${compPan.x}px, ${compPan.y}px) scale(${compZoom})`,
                                    transition: compDragging ? 'none' : 'transform 0.1s ease-out',
                                    transformOrigin: 'center center',
                                }}
                                className="pointer-events-none select-none flex justify-center items-center w-full px-1"
                            >
                                {/* Unified Single Board Background */}
                                <div className="bg-slate-100/95 rounded-2xl p-2 sm:p-2.5 border border-slate-200/80 shadow-md inline-flex flex-col items-center mx-auto">
                                    <div className="inline-flex items-start justify-center gap-1.5 sm:gap-2">
                                        {/* Column 1: Reference (Master) */}
                                        <div className="flex flex-col items-center gap-1.5 shrink-0">
                                            <div className="text-xs font-bold text-white uppercase tracking-wider text-center bg-blue-600 py-1 px-3 rounded-lg shadow-sm border border-blue-700 w-full">
                                                Reference (Master)
                                            </div>
                                            <img
                                                src={previewComparison.b_img}
                                                alt="Reference (Master)"
                                                className="max-h-[82vh] w-auto max-w-[32vw] object-contain rounded-lg border border-slate-900 shadow-sm bg-white"
                                                draggable="false"
                                            />
                                        </div>

                                        {/* Column 2: New Image */}
                                        <div className="flex flex-col items-center gap-1.5 shrink-0">
                                            <div className="text-xs font-bold text-white uppercase tracking-wider text-center bg-purple-600 py-1 px-3 rounded-lg shadow-sm border border-purple-700 w-full">
                                                New Image
                                            </div>
                                            <img
                                                src={previewComparison.a_img}
                                                alt="New Version"
                                                className="max-h-[82vh] w-auto max-w-[32vw] object-contain rounded-lg border border-slate-900 shadow-sm bg-white"
                                                draggable="false"
                                            />
                                        </div>

                                        {/* Column 3: Difference */}
                                        <div className="flex flex-col items-center gap-1.5 shrink-0">
                                            <div className="text-xs font-bold text-white uppercase tracking-wider text-center bg-red-600 py-1 px-3 rounded-lg shadow-sm border border-red-700 w-full">
                                                Difference
                                            </div>
                                            <img
                                                src={previewComparison.diff_img}
                                                alt="Difference"
                                                className="max-h-[82vh] w-auto max-w-[32vw] object-contain rounded-lg border border-slate-900 shadow-sm bg-white"
                                                draggable="false"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {previewImage && (
                <div
                    className="fixed inset-0 z-[70] bg-black/90 flex flex-col backdrop-blur-sm"
                >
                    <button
                        type="button"
                        className="absolute inset-0 w-full h-full cursor-default border-none outline-none"
                        onClick={() => { setPreviewImage(null); setZoomLevel(1); setPan({ x: 0, y: 0 }); }}
                        aria-label="Close Preview"
                    />
                    <div className="flex justify-end p-4 gap-2 shrink-0 relative z-10 pointer-events-auto">
                        <button className="text-white bg-black/50 hover:bg-white/20 p-2 rounded transition-colors" onClick={(e) => { e.stopPropagation(); setZoomLevel(z => Math.min(3.0, Number((z + 0.25).toFixed(2)))); setPan({ x: 0, y: 0 }); }}>
                            <ZoomIn size={24} />
                        </button>
                        <button className="text-white bg-black/50 hover:bg-white/20 p-2 rounded transition-colors" onClick={(e) => { e.stopPropagation(); setZoomLevel(z => Math.max(0.5, Number((z - 0.25).toFixed(2)))); setPan({ x: 0, y: 0 }); }}>
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
                            if (!e.deltaY) return;
                            const zoomStep = e.deltaY < 0 ? 0.25 : -0.25;
                            const newZoom = Math.max(0.5, Math.min(3.0, Number((zoomLevel + zoomStep).toFixed(2))));
                            if (newZoom === zoomLevel) return;

                            if (newZoom <= 1) {
                                setPan({ x: 0, y: 0 });
                            } else {
                                const rect = e.currentTarget.getBoundingClientRect();
                                const dx = e.clientX - rect.left - rect.width / 2;
                                const dy = e.clientY - rect.top - rect.height / 2;
                                setPan({
                                    x: dx - (dx - pan.x) * (newZoom / zoomLevel),
                                    y: dy - (dy - pan.y) * (newZoom / zoomLevel)
                                });
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
                            className="max-w-full max-h-full object-contain rounded-lg border border-white/20 shadow-2xl select-none"
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

                                        {(job.status === 'QUEUED' || job.status === 'PROCESSING') && (() => {
                                            const pData = jobProgress[String(job.job_id_str || job.id)] || jobProgress[String(job.id)];
                                            const pct = pData?.percent ?? 0;
                                            return (
                                                <div className="flex items-center gap-2 w-36 sm:w-40">
                                                    <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                                                        <div
                                                            className={clsx(
                                                                "h-full bg-amber-400 transition-all duration-300",
                                                                pct === 0 ? "w-1/3 animate-pulse" : "bg-stripes animate-stripes"
                                                            )}
                                                            style={{ width: pct > 0 ? `${pct}%` : undefined }}
                                                        ></div>
                                                    </div>
                                                    <span className="text-[10px] font-bold text-amber-600 w-7 text-right shrink-0">
                                                        {pct}%
                                                    </span>
                                                </div>
                                            );
                                        })()}
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
                            <div className="min-w-0 flex-1">
                                <h2 className="text-lg sm:text-xl lg:text-2xl font-bold text-slate-800 flex items-center gap-2 flex-wrap">
                                    <span className="flex flex-col min-w-0 max-w-full">
                                        <span className="flex items-center gap-2 flex-wrap min-w-0">
                                            <span className="break-all">{selectedJob.flow_name || 'Test Report'}</span>
                                            {selectedJob.flow_id && (
                                                <button
                                                    type="button"
                                                    onClick={() => openFlowNoteModal(selectedJob.flow_id, selectedJob.flow_name, selectedJob.flow_note)}
                                                    className={clsx(
                                                        "px-2 py-0.5 rounded-md transition-all text-xs inline-flex items-center gap-1.5 font-medium shrink-0",
                                                        selectedJob.flow_note
                                                            ? "text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 shadow-sm"
                                                            : "text-slate-500 hover:text-blue-600 hover:bg-blue-50 border border-slate-200"
                                                    )}
                                                    title={selectedJob.flow_note ? `Flow Note: ${selectedJob.flow_note}` : "Add Note to Flow"}
                                                >
                                                    <MessageSquare size={14} className={selectedJob.flow_note ? "text-blue-600" : "text-slate-400"} />
                                                    <span>Note</span>
                                                </button>
                                            )}
                                        </span>
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
                                            <div className="bg-white p-4 sm:p-5 lg:p-6 rounded-xl shadow-sm border border-slate-200 text-center flex flex-col justify-center min-h-[96px] sm:min-h-[115px]">
                                                <div className="text-2xl sm:text-3xl font-bold text-slate-800 mb-1">{stats.total}</div>
                                                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider leading-normal">Total Files</div>
                                            </div>
                                            <div className="bg-white p-4 sm:p-5 lg:p-6 rounded-xl shadow-sm border border-slate-200 text-center flex flex-col justify-center min-h-[96px] sm:min-h-[115px]">
                                                <div className="text-2xl sm:text-3xl font-bold text-green-600 mb-1">{stats.passed}</div>
                                                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider leading-normal">Passed</div>
                                            </div>
                                            <div className="bg-white p-4 sm:p-5 lg:p-6 rounded-xl shadow-sm border border-slate-200 text-center flex flex-col justify-center min-h-[96px] sm:min-h-[115px]">
                                                <div className={clsx("text-2xl sm:text-3xl font-bold mb-1", stats.totalDiffPoints > 0 ? "text-red-600" : "text-blue-600")}>
                                                    {stats.totalDiffPoints}
                                                </div>
                                                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider leading-normal">Total Diff Points</div>
                                                {(stats.failed > 0 || stats.mismatched > 0) && (
                                                    <div className="text-[11px] sm:text-xs font-bold text-red-500 mt-1 leading-normal">
                                                        (from {stats.failed} failed, {stats.mismatched} mismatched)
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-4 sm:space-y-6 lg:space-y-8">
                                        {comparisons.map((c, idx) => (
                                            <div key={idx} className={clsx("comparison-row bg-white rounded-lg shadow-sm border overflow-hidden break-inside-avoid", c.status === 'FAIL' ? "border-red-300 ring-1 ring-red-100" : c.status === 'MISMATCH' ? "border-orange-300 ring-1 ring-orange-100" : "border-slate-200")}>
                                                <div className={clsx("px-3 lg:px-4 py-2.5 lg:py-3 border-b flex flex-wrap justify-between items-center gap-2", c.status === 'FAIL' ? "bg-red-50 border-red-100" : c.status === 'MISMATCH' ? "bg-orange-50 border-orange-100" : "bg-slate-50 border-slate-100")}>
                                                    <span className="font-mono text-xs sm:text-sm font-bold text-slate-700 truncate min-w-0">{c.name}</span>
                                                    <div className="flex items-center gap-2 shrink-0">
                                                        {c.status === 'FAIL' ? (
                                                            <span className="flex items-center gap-1 text-xs font-bold px-2 py-1 rounded text-red-600 bg-white border border-red-200 shadow-sm shrink-0">
                                                                <AlertTriangle size={14} /> {c.diff_count} Diff
                                                            </span>
                                                        ) : c.status === 'MISMATCH' ? (
                                                            <span className="flex items-center gap-1 text-xs font-bold px-2 py-1 rounded text-orange-600 bg-white border border-orange-200 shadow-sm shrink-0">
                                                                <AlertTriangle size={14} /> Mismatch
                                                            </span>
                                                        ) : (
                                                            <span className="flex items-center gap-1 text-xs font-bold px-2 py-1 rounded text-green-600 bg-white border border-green-200 shadow-sm shrink-0">
                                                                <CheckCircle size={14} /> Passed
                                                            </span>
                                                        )}
                                                        {(c.status === 'FAIL' || c.status === 'MISMATCH') && (
                                                            <>
                                                                <button onClick={() => handleHeal(c.name)} className="flex items-center gap-1 text-xs font-bold px-2 py-1 rounded text-indigo-600 bg-white hover:bg-indigo-50 border border-indigo-200 shadow-sm transition-all" title="Accept this new image as Master">
                                                                    <RefreshCw size={13} /> Change Master
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setPreviewComparison(c)}
                                                                    className="flex items-center gap-1 text-xs font-bold px-2 py-1 rounded text-blue-600 bg-white hover:bg-blue-50 border border-blue-200 shadow-sm transition-all"
                                                                    title="Preview 3 images side-by-side"
                                                                >
                                                                    <Eye size={13} /> Preview
                                                                </button>
                                                            </>
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