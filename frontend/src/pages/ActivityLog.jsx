/* eslint-disable react/prop-types */
import { useState, useEffect } from 'react';
import { ShieldCheck, Calendar, Filter, User, AlertCircle, CheckCircle2, XCircle, Copy, BarChart2, RefreshCw } from 'lucide-react';
import client from '../api/client';
import clsx from 'clsx';
import Swal from 'sweetalert2';

export default function ActivityLog() {
    const [logs, setLogs] = useState([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [uniqueActions, setUniqueActions] = useState([]);
    
    const [stats, setStats] = useState({ total_scans: 0, fail_scans: 0, chart_data: [] });

    const [page, setPage] = useState(0);
    const [limit] = useState(50);
    const [username, setUsername] = useState('');
    const [action, setAction] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [ipAddress, setIpAddress] = useState('');
    const [hideSystemEvents, setHideSystemEvents] = useState(true);
    
    const autoRefresh = true; 
    
    const [selectedLog, setSelectedLog] = useState(null);

    useEffect(() => {
        fetchUniqueActions();
        fetchStats();
    }, []);

    useEffect(() => {
        fetchLogs();
    }, [page, limit, username, action, startDate, endDate, ipAddress, hideSystemEvents]);

    useEffect(() => {
        let interval;
        if (autoRefresh) {
            interval = setInterval(() => {
                fetchLogs(true);
            }, 10000); 
        }
        return () => clearInterval(interval);
    }, [autoRefresh, page, limit, username, action, startDate, endDate, ipAddress, hideSystemEvents]);

    const fetchUniqueActions = async () => {
        try {
            const res = await client.get('/api/v1/audit/actions');
            setUniqueActions(res.data);
        } catch (error) {
            console.error('Failed to fetch actions:', error);
        }
    };
    
    const fetchStats = async () => {
        try {
            const res = await client.get('/api/v1/audit/stats');
            setStats(res.data);
        } catch (error) {
            console.error('Failed to fetch stats:', error);
        }
    };

    const fetchLogs = async (silent = false) => {
        if (!silent) setLoading(true);
        try {
            const params = {
                skip: page * limit,
                limit: limit,
                hide_system_events: hideSystemEvents,
            };
            if (username) params.username = username;
            if (action) params.action = action;
            if (startDate) params.start_date = startDate;
            if (endDate) params.end_date = endDate;
            if (ipAddress) params.ip_address = ipAddress;

            const res = await client.get('/api/v1/audit/', { params });
            setLogs(res.data.items);
            setTotal(res.data.total);
        } catch (error) {
            if (!silent) {
                Swal.fire({
                    icon: 'error',
                    title: 'Error Fetching Logs',
                    text: error.response?.data?.detail || error.message
                });
            }
        } finally {
            if (!silent) setLoading(false);
        }
    };

    const formatDate = (dateStr) => {
        const d = new Date(dateStr);
        return d.toLocaleString('en-GB', { 
            year: 'numeric', month: '2-digit', day: '2-digit', 
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
    };

    const handleClearFilters = () => {
        setUsername('');
        setAction('');
        setStartDate('');
        setEndDate('');
        setIpAddress('');
        setPage(0);
        setHideSystemEvents(true);
    };

    const handleExportCSV = async () => {
        try {
            const params = {
                skip: 0,
                limit: 10000,
                hide_system_events: hideSystemEvents,
            };
            if (username) params.username = username;
            if (action) params.action = action;
            if (startDate) params.start_date = startDate;
            if (endDate) params.end_date = endDate;
            if (ipAddress) params.ip_address = ipAddress;

            const res = await client.get('/api/v1/audit/', { params });
            const data = res.data.items;

            if (data.length === 0) {
                Swal.fire('No Data', 'There are no logs matching your filters to export.', 'info');
                return;
            }

            Swal.fire({
                title: 'Generating CSV...',
                html: `
                    <div class="flex flex-col items-center justify-center py-4 px-2">
                        <div class="text-slate-500 text-sm mb-8 font-medium">Processing logs...</div>
                        
                        <div class="flex items-center w-full max-w-xs mx-auto text-slate-500">
                            <div class="shrink-0 animate-pulse">
                                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>
                            </div>
                            
                            <div class="flex-1 mx-4 relative">
                                <div id="csv-progress-text" class="absolute -top-5 left-0 right-0 text-center text-xs font-bold text-slate-500">0%</div>
                                <div class="h-1.5 w-full bg-slate-200 rounded-full overflow-hidden shadow-inner">
                                    <div id="csv-progress-bar" class="h-full bg-indigo-500 transition-all duration-300 ease-out rounded-full" style="width: 0%"></div>
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

            let progress = 0;
            const progressInterval = setInterval(() => {
                progress += Math.floor(Math.random() * 20) + 10; // NOSONAR
                if (progress > 90) progress = 90;
                const bar = document.getElementById('csv-progress-bar');
                const text = document.getElementById('csv-progress-text');
                if (bar && text) {
                    bar.style.width = `${progress}%`;
                    text.innerText = `${progress}%`;
                }
            }, 100);
            clearInterval(progressInterval);
            
            const bar = document.getElementById('csv-progress-bar');
            const text = document.getElementById('csv-progress-text');
            if (bar && text) {
                bar.style.width = '100%';
                text.innerText = '100%';
            }
            
            await new Promise(resolve => setTimeout(resolve, 400));

            const headers = ['No.', 'Event ID', 'Timestamp', 'User', 'Action', 'Level', 'Endpoint', 'Details', 'IP Address', 'Valid'];
            const rows = data.map((log, index) => {
                const { level, text } = parseLevelAndDetails(log.details);
                return [
                    index + 1,
                    `#EVT-${log.id}`,
                    formatDate(log.timestamp),
                    log.username || 'SYSTEM',
                    log.action,
                    level,
                    log.endpoint || '-',
                    text.replaceAll('"', '""'),
                    log.ip_address,
                    log.is_valid ? 'Yes' : 'No'
                ];
            });

            const csvContent = [
                headers.join(','),
                ...rows.map(row => `"${row.join('","')}"`)
            ].join('\n');

            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', `audit_logs_${new Date().toISOString().split('T')[0]}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            Swal.close();
        } catch (error) {
            Swal.fire('Export Error', 'Failed to export logs.', 'error');
        }
    };

    const parseLevelAndDetails = (detailsStr) => {
        if (!detailsStr) return { level: 'INFO', text: '-' };
        const match = detailsStr.match(/^\[(INFO|WARNING|ERROR|CRITICAL)\]\s*(.*)/i);
        if (match) {
            return { level: match[1].toUpperCase(), text: match[2] };
        }
        return { level: 'INFO', text: detailsStr };
    };
    
    const handleCopy = (e, text, type) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text);
        
        const Toast = Swal.mixin({
            toast: true,
            position: "top-end",
            showConfirmButton: false,
            timer: 1500,
            timerProgressBar: true
        });
        Toast.fire({ icon: "success", title: `${type} Copied!` });
    };

    const totalPages = Math.ceil(total / limit) || 1;
    
    const maxChartValue = stats.length > 0 ? Math.max(...stats.map(s => s.info + s.warning + s.error)) : 1;

    return (
        <div className="w-full space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                        <ShieldCheck className="text-blue-600" />
                        Audit Trail & Activity Log
                    </h1>
                    <p className="text-slate-500 text-sm mt-1">
                        Tamper-Evident log records for compliance and security monitoring
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={handleExportCSV}
                        className="py-2 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg transition-colors text-sm border border-indigo-700 shadow-sm"
                    >
                        Export CSV
                    </button>
                </div>
            </div>
            
            {stats.length > 0 && (
                <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col">
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4 flex items-center gap-1">
                        <BarChart2 size={14} /> 7-Day Activity Volume (Filtered System Noise)
                    </h3>
                    <div className="flex items-end justify-center gap-6 h-24 w-full">
                        {stats.map((stat, idx) => {
                            const totalH = stat.info + stat.warning + stat.error;
                            const heightPct = Math.max((totalH / maxChartValue) * 100, 2); 
                            
                            const errPct = totalH > 0 ? (stat.error / totalH) * 100 : 0;
                            const warnPct = totalH > 0 ? (stat.warning / totalH) * 100 : 0;
                            const infoPct = totalH > 0 ? (stat.info / totalH) * 100 : 0;
                            
                            return (
                                <div key={stat.date} className="flex flex-col items-center group relative cursor-crosshair h-full justify-end w-16">
                                    <div 
                                        className="w-full max-w-[40px] rounded-t-sm flex flex-col justify-end overflow-hidden hover:brightness-110 transition-all"
                                        style={{ height: `${heightPct}%` }}
                                    >
                                        <div className="w-full bg-emerald-400" style={{ height: `${infoPct}%` }}></div>
                                        <div className="w-full bg-amber-400" style={{ height: `${warnPct}%` }}></div>
                                        <div className="w-full bg-rose-500" style={{ height: `${errPct}%` }}></div>
                                    </div>
                                    <div className="text-[10px] text-slate-400 mt-1">{new Date(stat.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</div>
                                    
                                    {/* Tooltip */}
                                    <div className="opacity-0 group-hover:opacity-100 absolute -top-12 bg-slate-800 text-white text-[11px] p-2 rounded shadow-lg pointer-events-none z-10 whitespace-nowrap transition-opacity">
                                        <div className="font-semibold">{stat.date}</div>
                                        <div><span className="text-emerald-400">INFO:</span> {stat.info}</div>
                                        {(stat.warning > 0 || stat.error > 0) && (
                                            <div>
                                                {stat.warning > 0 && <span className="text-amber-400">WARN: {stat.warning} </span>}
                                                {stat.error > 0 && <span className="text-rose-400">ERR: {stat.error}</span>}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}

            {/* Filter Section */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                <div className="flex flex-wrap items-center gap-4">
                    <div className="relative flex-1 min-w-[200px] max-w-xs">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                        <input
                            type="text"
                            placeholder="Filter by Username..."
                            value={username}
                            onChange={(e) => { setUsername(e.target.value); setPage(0); }}
                            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                        />
                    </div>
                    <div className="relative flex-1 min-w-[150px] max-w-[200px]">
                        <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                        <select
                            value={action}
                            onChange={(e) => { setAction(e.target.value); setPage(0); }}
                            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm appearance-none bg-white"
                        >
                            <option value="">All Actions</option>
                            {uniqueActions.map(a => (
                                <option key={a} value={a}>{a}</option>
                            ))}
                        </select>
                    </div>
                    <div className="relative w-40">
                        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                        <input
                            type="date"
                            value={startDate}
                            onChange={(e) => { setStartDate(e.target.value); setPage(0); }}
                            className="w-full pl-10 pr-2 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm text-slate-600"
                        />
                    </div>
                    <div className="relative w-40">
                        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                        <input
                            type="date"
                            value={endDate}
                            onChange={(e) => { setEndDate(e.target.value); setPage(0); }}
                            className="w-full pl-10 pr-2 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm text-slate-600"
                        />
                    </div>
                    <div>
                        <button
                            onClick={handleClearFilters}
                            className="py-2 px-4 bg-slate-100 hover:bg-slate-200 text-slate-600 font-medium rounded-lg transition-colors text-sm"
                        >
                            Clear Filters
                        </button>
                    </div>
                    <div className="w-full flex items-center justify-start pt-2 border-t border-slate-100 mt-2">
                        <label htmlFor="hide-sys-events-toggle" className="flex items-center gap-3 text-sm font-medium text-slate-700 cursor-pointer">
                            <div className="relative">
                                <input 
                                    id="hide-sys-events-toggle"
                                    type="checkbox" 
                                    checked={hideSystemEvents} 
                                    onChange={(e) => { setHideSystemEvents(e.target.checked); setPage(0); }}
                                    className="sr-only peer"
                                />
                                <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                            </div>
                            Hide System Events (Noise Reduction)
                        </label>
                    </div>
                </div>
            </div>

            {/* Data Table */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm text-slate-600 table-fixed min-w-[1000px]">
                        <thead className="bg-slate-50 text-slate-700 uppercase font-semibold text-xs border-b border-slate-200">
                            <tr>
                                <th className="px-4 py-4 whitespace-nowrap w-[4%]">No.</th>
                                <th className="px-4 py-4 whitespace-nowrap w-[8%]">Event ID</th>
                                <th className="px-4 py-4 whitespace-nowrap w-[12%]">Timestamp</th>
                                <th className="px-4 py-4 whitespace-nowrap w-[7%]">User</th>
                                <th className="px-4 py-4 whitespace-nowrap w-[13%]">Action</th>
                                <th className="px-4 py-4 whitespace-nowrap w-[6%]">Level</th>
                                <th className="px-4 py-4 whitespace-nowrap w-[15%]">Endpoint</th>
                                <th className="px-4 py-4 whitespace-nowrap w-[20%]">Details</th>
                                <th className="px-4 py-4 whitespace-nowrap w-[9%]">IP Address</th>
                                <th className="px-4 py-4 whitespace-nowrap text-center w-[6%]">Integrity</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                            {loading && logs.length === 0 ? (
                                <tr>
                                    <td colSpan="10" className="px-6 py-12 text-center text-slate-500">
                                        <div className="flex justify-center mb-2">
                                            <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                                        </div>
                                        Loading logs...
                                    </td>
                                </tr>
                            ) : logs.length === 0 ? (
                                <tr>
                                    <td colSpan="10" className="px-6 py-12 text-center text-slate-500">
                                        <AlertCircle className="mx-auto mb-2 text-slate-400" size={32} />
                                        No logs found matching your filters.
                                    </td>
                                </tr>
                            ) : (
                                logs.map((log, index) => {
                                    const { level, text } = parseLevelAndDetails(log.details);
                                    return (
                                        <tr 
                                            key={log.id} 
                                            onClick={() => setSelectedLog(log)}
                                            className="hover:bg-slate-50 transition-colors cursor-pointer group"
                                        >
                                            <td className="px-4 py-3 whitespace-nowrap text-slate-500 font-medium text-xs">
                                                {page * limit + index + 1}
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <button 
                                                    onClick={(e) => handleCopy(e, JSON.stringify(log, null, 2), 'Row Data')}
                                                    className="flex items-center gap-1 text-slate-400 font-mono text-[11px] hover:text-blue-600 hover:bg-blue-50 px-1 py-0.5 rounded transition-colors"
                                                    title="Click to copy row data"
                                                >
                                                    #EVT-{log.id} <Copy size={10} className="opacity-0 group-hover:opacity-100" />
                                                </button>
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap text-slate-900 group-hover:text-blue-600">{formatDate(log.timestamp)}</td>
                                            <td className="px-4 py-3 font-medium whitespace-nowrap">
                                                {log.username || <span className="text-slate-400 italic">SYSTEM</span>}
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <span className={clsx(
                                                    "px-2.5 py-1 rounded-md font-medium text-[11px] border whitespace-nowrap inline-block truncate max-w-full text-center",
                                                    log.action.includes('LOGIN') || log.action.includes('CREATED') ? "bg-blue-50 text-blue-700 border-blue-200" :
                                                    log.action.includes('DELETED') || log.action.includes('LOGOUT') ? "bg-rose-50 text-rose-700 border-rose-200" :
                                                    log.action.includes('SYSTEM') || log.action.includes('UPDATED') ? "bg-orange-50 text-orange-700 border-orange-200" :
                                                    log.action.includes('JOB') ? "bg-indigo-50 text-indigo-700 border-indigo-200" :
                                                    log.action.includes('NOTIFY') ? "bg-cyan-50 text-cyan-700 border-cyan-200" :
                                                    "bg-slate-100 text-slate-700 border-slate-200"
                                                )}>
                                                    {log.action}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <span className={clsx(
                                                    "px-2 py-1 rounded text-[10px] font-bold tracking-wider",
                                                    level === 'INFO' ? "bg-emerald-100 text-emerald-800" :
                                                    level === 'WARNING' ? "bg-amber-100 text-amber-800" :
                                                    level === 'ERROR' || level === 'CRITICAL' ? "bg-rose-100 text-rose-800" :
                                                    "bg-slate-100 text-slate-800"
                                                )}>
                                                    {level}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-xs font-mono text-slate-500 break-all min-w-[120px]">
                                                {log.endpoint !== "-" ? log.endpoint : "-"}
                                            </td>
                                            <td className="px-4 py-3 text-xs text-slate-600 truncate max-w-full" title="Click to view full JSON">
                                                {text}
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <button 
                                                    onClick={(e) => handleCopy(e, log.ip_address, 'IP Address')}
                                                    className="flex items-center gap-1 text-slate-500 text-xs font-mono hover:text-blue-600 hover:bg-blue-50 px-1 py-0.5 rounded transition-colors"
                                                    title="Click to copy IP Address"
                                                >
                                                    {log.ip_address} <Copy size={12} className="opacity-0 group-hover:opacity-100" />
                                                </button>
                                            </td>
                                            <td className="px-4 py-3 text-center whitespace-nowrap">
                                                {log.is_valid ? (
                                                    <span className="inline-flex items-center gap-1 text-emerald-600 bg-emerald-50 px-2 py-1 rounded text-xs font-medium border border-emerald-100" title="Hash matched">
                                                        <CheckCircle2 size={14} /> Valid
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 text-red-600 bg-red-50 px-2 py-1 rounded text-xs font-medium border border-red-100" title="Data tampered!">
                                                        <XCircle size={14} /> Invalid
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
                
                {/* Pagination */}
                {!loading && logs.length > 0 && (
                    <div className="bg-slate-50 px-6 py-3 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4">
                        <div className="text-sm text-slate-500">
                            Showing <span className="font-medium text-slate-900">{page * limit + 1}</span> to <span className="font-medium text-slate-900">{Math.min((page + 1) * limit, total)}</span> of <span className="font-medium text-slate-900">{total}</span> results
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setPage(0)}
                                disabled={page === 0}
                                className="px-2 py-1 text-slate-500 hover:text-blue-600 disabled:opacity-50 disabled:hover:text-slate-500 text-sm font-medium"
                                title="First Page"
                            >
                                &laquo; First
                            </button>
                            <button
                                onClick={() => setPage(p => Math.max(0, p - 1))}
                                disabled={page === 0}
                                className="px-3 py-1 bg-white border border-slate-200 text-slate-600 rounded hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
                            >
                                Previous
                            </button>
                            
                            <div className="flex items-center gap-2 mx-1">
                                <span className="text-sm text-slate-600">Page</span>
                                <select 
                                    value={page}
                                    onChange={(e) => setPage(Number(e.target.value))}
                                    className="py-1 px-2 border border-slate-300 rounded text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                    {Array.from({ length: totalPages }, (_, i) => (
                                        <option key={i} value={i}>{i + 1}</option>
                                    ))}
                                </select>
                                <span className="text-sm text-slate-600">of {totalPages}</span>
                            </div>

                            <button
                                onClick={() => setPage(p => p + 1)}
                                disabled={(page + 1) * limit >= total}
                                className="px-3 py-1 bg-white border border-slate-200 text-slate-600 rounded hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
                            >
                                Next
                            </button>
                            <button
                                onClick={() => setPage(Math.max(0, totalPages - 1))}
                                disabled={(page + 1) * limit >= total}
                                className="px-2 py-1 text-slate-500 hover:text-blue-600 disabled:opacity-50 disabled:hover:text-slate-500 text-sm font-medium"
                                title="Last Page"
                            >
                                Last &raquo;
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Raw JSON Modal */}
            {selectedLog && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <button
                        type="button"
                        className="fixed inset-0 bg-black/50 backdrop-blur-sm w-full h-full border-none outline-none cursor-default"
                        onClick={() => setSelectedLog(null)}
                        aria-label="Close modal"
                    />
                    <div 
                        className="relative z-10 bg-white rounded-xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200"
                    >
                        <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                            <div>
                                <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                                    <ShieldCheck className="text-blue-600" />
                                    Log Details (Raw View)
                                </h3>
                                <p className="text-xs text-slate-500 mt-1">ID: #EVT-{selectedLog.id} | Timestamp: {formatDate(selectedLog.timestamp)}</p>
                            </div>
                            <button 
                                onClick={() => setSelectedLog(null)} 
                                className="text-slate-400 hover:text-slate-600 transition-colors p-1"
                            >
                                <XCircle size={28} />
                            </button>
                        </div>
                        <div className="p-6 overflow-y-auto bg-slate-900">
                            <pre className="text-emerald-400 p-2 rounded text-sm font-mono whitespace-pre-wrap word-break">
                                {JSON.stringify(selectedLog, null, 2)}
                            </pre>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
