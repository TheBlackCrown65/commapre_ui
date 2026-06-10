/* eslint-disable react/prop-types */
import { useState, useEffect } from 'react';
import client from '../api/client';
import { Activity, Cpu, HardDrive, Server, Database, Lock, Loader2, HardDriveUpload, Image as ImageIcon } from 'lucide-react';

const formatBytes = (bytes, decimals = 2) => {
    if (!+bytes) return '0 Bytes';
    const k = 1000; // 💡 เปลี่ยนจาก 1024 เป็น 1000 
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${Number.parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};

const ProgressBar = ({ percent, colorClass }) => (
    <div className="w-full bg-slate-200 rounded-full h-2.5 overflow-hidden flex">
        <div className={`h-2.5 rounded-full transition-all duration-500 ease-out ${colorClass}`} style={{ width: `${percent}%` }}></div>
    </div>
);

export default function SystemMonitor() {
    const [stats, setStats] = useState(null);

    useEffect(() => {
        fetchStats();
        const interval = setInterval(fetchStats, 3000);
        const evtSource = new EventSource(`${client.defaults.baseURL || ''}/api/v1/jobs/stream`);
        const handleRealtimeUpdate = () => fetchStats();

        evtSource.addEventListener("job_completed", handleRealtimeUpdate);
        evtSource.addEventListener("job_deleted", handleRealtimeUpdate);

        return () => {
            clearInterval(interval);
            evtSource.close();
        };
    }, []);

    const fetchStats = async () => {
        try {
            const res = await client.get('/api/v1/monitor/stats');
            setStats(res.data);
        } catch (err) {
            console.error("Failed to fetch system stats", err);
        }
    };

    if (!stats) return <div className="p-8 text-center text-slate-500 flex items-center justify-center"><Activity className="animate-pulse mr-2" /> Connecting to Docker Engine...</div>;

    const getStatusColor = (percent) => {
        if (percent > 85) return 'bg-red-500';
        if (percent > 70) return 'bg-yellow-500';
        return 'bg-green-500';
    };

    const isCalculating = stats.storage_breakdown?.is_calculating;
    const detailedData = stats.storage_breakdown?.detailed || [];
    const hasData = detailedData.length > 0;
    const totalJobsBytes = detailedData.reduce((sum, row) => sum + (row.jobs_bytes || 0), 0);
    const totalRefsBytes = detailedData.reduce((sum, row) => sum + (row.refs_bytes || 0), 0);
    const totalAllBytes = detailedData.reduce((sum, row) => sum + (row.total_bytes || 0), 0);
    const osStorageBytes = stats.project_os_bytes || 0; // Will be provided by backend
    const osStoragePercent = stats.disk.total > 0 ? (osStorageBytes / stats.disk.total) * 100 : 0;
    const appStoragePercent = stats.disk.total > 0 ? (totalAllBytes / stats.disk.total) * 100 : 0;

    return (
        <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
            <div className="flex items-center gap-3 mb-2">
                <div className="w-12 h-12 bg-white rounded-xl shadow-sm border border-slate-200 flex items-center justify-center text-indigo-600">
                    <Activity size={24} />
                </div>
                <div>
                    <h1 className="text-2xl font-bold text-slate-800">System Monitor</h1>
                    <p className="text-slate-500 text-sm">Real-time Docker container performance & storage metrics.</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 lg:gap-6">
                {/* CPU Card */}
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col h-full">
                    <div className="flex justify-between items-start mb-4">
                        <div className="flex items-center gap-2 text-slate-600 font-semibold"><Cpu size={18} /> CPU Usage</div>
                        <span className="text-xl font-bold text-slate-800">{stats.cpu_percent.toFixed(1)}%</span>
                    </div>
                    <div className="mb-4">
                        <ProgressBar percent={stats.cpu_percent} colorClass={getStatusColor(stats.cpu_percent)} />
                    </div>
                    <div className="mt-auto pt-3 border-t border-slate-100 text-xs text-slate-400">
                        Total processing load across all cores
                    </div>
                </div>

                {/* RAM Card */}
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col h-full">
                    <div className="flex justify-between items-start mb-4">
                        <div className="flex items-center gap-2 text-slate-600 font-semibold"><Server size={18} /> Memory (RAM)</div>
                        <span className="text-xl font-bold text-slate-800">{stats.ram.percent}%</span>
                    </div>
                    <div className="mb-4">
                        <ProgressBar percent={stats.ram.percent} colorClass={getStatusColor(stats.ram.percent)} />
                    </div>
                    <div className="mt-auto pt-3 border-t border-slate-100 text-xs text-slate-400 flex justify-between">
                        <span>Used: {formatBytes(stats.ram.used)}</span>
                        <span>Total: {formatBytes(stats.ram.total)}</span>
                    </div>
                </div>

                {/* System & Data Card */}
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col h-full">
                    <div className="flex justify-between items-start mb-4">
                        <div className="flex items-center gap-2 text-slate-600 font-semibold"><HardDrive size={18} /> System & Data</div>
                        <span className="text-xl font-bold text-slate-800">{formatBytes(osStorageBytes + totalAllBytes)}</span>
                    </div>
                    
                    {/* Multi-segment Progress Bar */}
                    <div className="w-full bg-slate-200 rounded-full h-2.5 overflow-hidden flex mb-4">
                        <div 
                            className="h-full bg-emerald-500 transition-all duration-500 ease-out" 
                            style={{ width: `${osStoragePercent > 0 && osStoragePercent < 0.1 ? 0.1 : osStoragePercent}%` }}
                        ></div>
                        <div 
                            className="h-full bg-blue-500 transition-all duration-500 ease-out border-l border-white/20" 
                            style={{ width: `${appStoragePercent > 0 && appStoragePercent < 0.1 ? 0.1 : appStoragePercent}%` }}
                        ></div>
                    </div>

                    <div className="flex justify-between items-center mb-2">
                        <div className="space-y-1">
                            <span className="text-xs font-medium text-slate-500 flex items-center gap-1.5">
                                <div className="w-2 h-2 rounded-full bg-emerald-500"></div> System (OS+DB)
                            </span>
                            <div className="text-sm font-bold text-slate-700 ml-3.5">{formatBytes(osStorageBytes)}</div>
                        </div>
                        <div className="space-y-1 text-right">
                            <span className="text-xs font-medium text-slate-500 flex items-center justify-end gap-1.5">
                                <div className="w-2 h-2 rounded-full bg-blue-500"></div> App Data
                            </span>
                            <div className="text-sm font-bold text-slate-700 mr-3.5">{formatBytes(totalAllBytes)}</div>
                        </div>
                    </div>
                    
                    <div className="mt-auto pt-3 border-t border-slate-100 text-xs text-slate-400 flex justify-between">
                        <span>Total Disk Space</span>
                        <span>{formatBytes(stats.disk.total)}</span>
                    </div>
                </div>
            </div>

            {/* Detailed Storage Breakdown */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                <div className="p-4 sm:p-5 border-b border-slate-100 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
                    <h2 className="font-bold text-slate-700 flex items-center gap-2">
                        <Database size={18} className="text-blue-500" /> Detailed Storage Breakdown (By Squad)
                    </h2>
                    <div className="flex items-center gap-3">
                        {isCalculating && hasData && (
                            <span className="flex items-center gap-1.5 text-[10px] font-bold text-blue-500 bg-blue-50 px-2 py-1 rounded-md border border-blue-100">
                                <Loader2 size={12} className="animate-spin" /> Updating...
                            </span>
                        )}
                        <span className="text-xs font-medium text-slate-500 bg-white px-2 py-1 rounded border border-slate-200 shadow-sm">
                            {detailedData.length} Teams
                        </span>
                    </div>
                </div>

                <div className="p-0 overflow-x-auto">
                    <table className="w-full text-left border-collapse whitespace-nowrap min-w-[700px]">
                        <thead>
                            <tr className="bg-white border-b border-slate-100 text-[12px] uppercase tracking-wider text-slate-400">
                                <th className="p-4 font-bold text-slate-600">Department / Squad</th>

                                <th className="p-4 font-medium text-right">
                                    <span className="flex items-center justify-end gap-1.5">
                                        <HardDriveUpload size={16} className="text-blue-400" /> Jobs Output
                                        {hasData && <span className="text-blue-500 font-bold normal-case">({formatBytes(totalJobsBytes)})</span>}
                                    </span>
                                </th>

                                <th className="p-4 font-medium text-right">
                                    <span className="flex items-center justify-end gap-1.5">
                                        <ImageIcon size={16} className="text-emerald-400" /> Master Refs
                                        {hasData && <span className="text-emerald-500 font-bold normal-case">({formatBytes(totalRefsBytes)})</span>}
                                    </span>
                                </th>

                                <th className="p-4 font-bold text-right text-slate-700">
                                    Total Storage
                                    {hasData && <span className="text-slate-500 font-bold ml-1.5 normal-case">({formatBytes(totalAllBytes)})</span>}
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {isCalculating && !hasData ? (
                                <tr>
                                    <td colSpan="4" className="p-12 text-center text-slate-500">
                                        <Loader2 className="animate-spin mx-auto mb-3 text-blue-500" size={32} />
                                        <div className="font-medium">Deep scanning storage space...</div>
                                        <div className="text-xs text-slate-400 mt-1">Calculating sizes for each team's jobs and references.</div>
                                    </td>
                                </tr>
                            ) : !hasData ? (
                                <tr><td colSpan="4" className="p-8 text-center text-slate-400">No storage data found.</td></tr>
                            ) : (
                                detailedData.map((row, idx) => (
                                    <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                                        <td className="p-4 text-sm font-bold text-slate-700">{row.name}</td>
                                        <td className="p-4 text-sm text-slate-500 text-right">{row.jobs_bytes > 0 ? formatBytes(row.jobs_bytes) : '-'}</td>
                                        <td className="p-4 text-sm text-slate-500 text-right">{row.refs_bytes > 0 ? formatBytes(row.refs_bytes) : '-'}</td>
                                        <td className="p-4 text-sm font-bold text-blue-600 text-right bg-slate-50/30">{formatBytes(row.total_bytes)}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}