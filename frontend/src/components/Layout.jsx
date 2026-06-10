/* eslint-disable react/prop-types */
import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Settings, Play, BarChart2, CheckCircle, Menu, X, PanelLeftClose, PanelLeftOpen, Building2, Sliders, Key, Users, Activity, ShieldCheck, ClipboardList } from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../contexts/AuthContext';
import client from '../api/client';
// 💡 นำเข้า SweetAlert2 สำหรับแจ้งเตือนตอนโดนเตะออก
import Swal from 'sweetalert2';

export default function Layout({ children }) {
    const location = useLocation();
    const { user, logout } = useAuth();
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [pendingCount, setPendingCount] = useState(0);
    const [loginChallenge, setLoginChallenge] = useState(null);
    const [challengeLoading, setChallengeLoading] = useState(false);

    useEffect(() => {
        if (!user) return;

        if (user.role === 'ADMIN') {
            client.get('/api/v1/users/pending-count')
                .then(res => setPendingCount(res.data.count))
                .catch(() => { });
        }

        const apiUrl = import.meta.env.VITE_API_URL || '';
        const eventSource = new EventSource(`${apiUrl}/api/v1/jobs/stream`);

        if (user.role === 'ADMIN') {
            eventSource.addEventListener('user_registered', () => {
                setPendingCount(prev => prev + 1);
            });

            eventSource.addEventListener('user_approved', () => {
                setPendingCount(prev => Math.max(0, prev - 1));
            });
        }

        eventSource.addEventListener('login_challenge_requested', (evt) => {
            try {
                const data = JSON.parse(evt.data);
                if (data?.user_id === user.id) {
                    setLoginChallenge(data);
                }
            } catch {
            }
        });

        eventSource.addEventListener('session_revoked', (evt) => {
            try {
                const data = JSON.parse(evt.data);
                if (data?.user_id === user.id) {
                    let timerInterval;
                    Swal.fire({
                        icon: 'warning',
                        title: 'Logged Out',
                        html: 'Your account has been logged in from another device. You have been logged out of this session.<br><br><div class="mt-5 flex items-center justify-center gap-2 text-orange-500 text-lg font-medium"><span class="animate-spin-slow inline-block text-2xl">⏳</span><span>Redirecting in</span> <b class="text-3xl text-orange-600 animate-pulse font-bold mx-1">5</b> <span>seconds...</span></div>',
                        timer: 5000,
                        timerProgressBar: true,
                        confirmButtonText: 'OK',
                        confirmButtonColor: '#3b82f6',
                        allowOutsideClick: false,
                        allowEscapeKey: false,
                        customClass: {
                            container: 'swal2-blur-backdrop',
                            timerProgressBar: 'swal2-gray-progress'
                        },
                        didOpen: () => {
                            const b = Swal.getHtmlContainer().querySelector('b');
                            timerInterval = setInterval(() => {
                                if (b) b.textContent = Math.ceil(Swal.getTimerLeft() / 1000);
                            }, 100);
                        },
                        willClose: () => {
                            clearInterval(timerInterval);
                        }
                    }).then(() => {
                        logout();
                    });
                }
            } catch {
            }
        });

        // 💡 เพิ่ม Global Listener ดักสัญญาณเตะออกแบบฉับพลัน (Reset Password / Suspend)
        eventSource.addEventListener('force_logout', (evt) => {
            try {
                const data = JSON.parse(evt.data);
                // ถ้าสัญญาณเตะออก ระบุตัวเป็นเรา ให้แจ้งเตือนก่อนแล้วค่อยเด้งออก
                if (data?.user_id === user.id) {
                    let timerInterval;
                    Swal.fire({
                        icon: 'warning',
                        title: 'Logged Out',
                        html: 'Your account status was updated or your password was reset by an Admin. Please login again.<br><br><div class="mt-5 flex items-center justify-center gap-2 text-orange-500 text-lg font-medium"><span class="animate-spin-slow inline-block text-2xl">⏳</span><span>Redirecting in</span> <b class="text-3xl text-orange-600 animate-pulse font-bold mx-1">5</b> <span>seconds...</span></div>',
                        timer: 5000,
                        timerProgressBar: true,
                        confirmButtonText: 'OK',
                        confirmButtonColor: '#3b82f6',
                        allowOutsideClick: false,
                        allowEscapeKey: false,
                        customClass: {
                            container: 'swal2-blur-backdrop',
                            timerProgressBar: 'swal2-gray-progress'
                        },
                        didOpen: () => {
                            const b = Swal.getHtmlContainer().querySelector('b');
                            timerInterval = setInterval(() => {
                                if (b) b.textContent = Math.ceil(Swal.getTimerLeft() / 1000);
                            }, 100);
                        },
                        willClose: () => {
                            clearInterval(timerInterval);
                        }
                    }).then(() => {
                        logout();
                    });
                }
            } catch {
            }
        });

        return () => eventSource.close();
    }, [user?.id, user?.role, logout]);

    const handleChallengeDecision = async (decision) => {
        if (!loginChallenge?.challenge_id) return;
        setChallengeLoading(true);
        try {
            await client.post(`/api/v1/auth/login-challenges/${loginChallenge.challenge_id}/decision`, { decision });
        } catch {
        } finally {
            setChallengeLoading(false);
            setLoginChallenge(null);
            if (decision === 'ACCEPT') {
                await logout();
            }
        }
    };

    const baseMenuItems = [
        { key: 'dashboard', path: '/dashboard', label: 'Dashboard', icon: BarChart2 },
        { key: 'run', path: '/run', label: 'Run Test', icon: Play },
        { key: 'setting', path: '/setting', label: 'Settings', icon: Settings },
    ];

    const adminMenuItems = [
        { key: 'org', path: '/org', label: 'Organization', icon: Building2 },
        { key: 'manage-users', path: '/manage-users', label: 'Manage Users', icon: Users, badge: pendingCount },
        { key: 'manage-roles', path: '/manage-roles', label: 'Manage Roles', icon: ShieldCheck },
        { key: 'api-keys', path: '/api-keys', label: 'API Keys', icon: Key },
        { key: 'config', path: '/config', label: 'System Config', icon: Sliders },
        { key: 'monitor', path: '/monitor', label: 'System Monitor', icon: Activity },
        { key: 'activity-log', path: '/activity-log', label: 'Activity Log', icon: ClipboardList },
    ];

    let menuItems = [];
    if (user) {
        const allItems = [...baseMenuItems, ...adminMenuItems];
        if (user.role === 'ADMIN' && (!user.custom_role_id || user.menu_permissions?.length === 0)) {
            // Super admin fallback
            menuItems = allItems;
        } else if (user.custom_role_id && user.menu_permissions?.length > 0) {
            // RBAC
            menuItems = allItems.filter(item => user.menu_permissions.includes(item.key));
        } else {
            // Normal user fallback
            menuItems = baseMenuItems;
        }
    }

    return (
        <div className="flex h-screen bg-slate-50 font-sans relative">
            {loginChallenge && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-200 p-6">
                        <div className="text-slate-900 font-semibold text-lg">มีการขอ Login จากอุปกรณ์อื่น</div>
                        <div className="mt-2 text-sm text-slate-600 break-words">
                            IP: {loginChallenge.ip || '-'}
                        </div>
                        <div className="mt-1 text-sm text-slate-600 break-words">
                            Device: {loginChallenge.user_agent || '-'}
                        </div>
                        <div className="mt-6 flex gap-3">
                            <button
                                onClick={() => handleChallengeDecision('ACCEPT')}
                                disabled={challengeLoading}
                                className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                Accept
                            </button>
                            <button
                                onClick={() => handleChallengeDecision('DENY')}
                                disabled={challengeLoading}
                                className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-800 font-semibold hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                Deny
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* Mobile Overlay */}
            {sidebarOpen && (
                <button
                    type="button"
                    className="fixed inset-0 bg-black/50 z-40 lg:hidden backdrop-blur-sm border-none outline-none w-full h-full cursor-default"
                    onClick={() => setSidebarOpen(false)}
                    aria-label="Close sidebar"
                />
            )}

            {/* Sidebar */}
            <div className={clsx(
                "bg-slate-900 text-white flex flex-col z-50 transition-all duration-300 ease-in-out shrink-0",
                "fixed inset-y-0 left-0 lg:relative",
                sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
                sidebarCollapsed ? "lg:w-[68px]" : "lg:w-64",
                "w-64"
            )}>
                {/* Header */}
                <div className={clsx(
                    "p-4 border-b border-slate-700 flex items-center",
                    sidebarCollapsed ? "lg:justify-center lg:px-2" : "gap-3"
                )}>
                    <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shrink-0">
                        <CheckCircle size={20} className="text-white" />
                    </div>
                    <div className={clsx(
                        "transition-all duration-300 overflow-hidden",
                        sidebarCollapsed ? "lg:w-0 lg:opacity-0" : "w-auto opacity-100"
                    )}>
                        <h1 className="font-bold text-lg leading-tight whitespace-nowrap">Robot Verify</h1>
                        <p className="text-xs text-slate-400 whitespace-nowrap">By Automate Team</p>
                    </div>
                    <button
                        onClick={() => setSidebarOpen(false)}
                        className="ml-auto p-1 hover:bg-slate-700 rounded lg:hidden"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Nav */}
                <nav className="flex-1 p-3 space-y-1.5">
                    {menuItems.map((item) => {
                        const Icon = item.icon;
                        const isActive = location.pathname === item.path;
                        return (
                            <Link
                                key={item.path}
                                to={item.path}
                                onClick={() => setSidebarOpen(false)}
                                title={item.label}
                                className={clsx(
                                    "flex items-center gap-3 px-3 py-3 rounded-lg transition-colors duration-200 relative",
                                    sidebarCollapsed && "lg:justify-center lg:px-0",
                                    isActive
                                        ? "bg-blue-600 text-white shadow-lg shadow-blue-900/20"
                                        : "text-slate-400 hover:bg-slate-800 hover:text-white"
                                )}
                            >
                                <Icon size={20} className="shrink-0" />
                                <span className={clsx(
                                    "font-medium whitespace-nowrap transition-all duration-300 overflow-hidden",
                                    sidebarCollapsed ? "lg:w-0 lg:opacity-0" : "w-auto opacity-100"
                                )}>
                                    {item.label}
                                </span>
                                {item.badge > 0 && (
                                    <span className={clsx(
                                        "min-w-[20px] h-5 flex items-center justify-center rounded-full text-[11px] font-bold px-1.5",
                                        isActive
                                            ? "bg-white text-blue-600"
                                            : "bg-red-500 text-white",
                                        sidebarCollapsed && "lg:absolute lg:-top-1 lg:-right-1 lg:min-w-[18px] lg:h-[18px] lg:text-[10px]"
                                    )}>
                                        {item.badge}
                                    </span>
                                )}
                            </Link>
                        );
                    })}
                </nav>

                {/* Collapse Toggle (Desktop only) */}
                <button
                    onClick={() => setSidebarCollapsed(prev => !prev)}
                    className="hidden lg:flex items-center justify-center p-3 border-t border-slate-800 text-slate-500 hover:text-white hover:bg-slate-800 transition-colors"
                    title={sidebarCollapsed ? "Expand Menu" : "Collapse Menu"}
                >
                    {sidebarCollapsed
                        ? <PanelLeftOpen size={20} />
                        : <PanelLeftClose size={20} />
                    }
                </button>

                {/* Footer / User Profile */}
                <div className={clsx(
                    "p-3 border-t border-slate-800 flex flex-col gap-2",
                    sidebarCollapsed && "lg:p-2 lg:items-center"
                )}>
                    {user && (
                        <div className={clsx("flex items-center gap-3", sidebarCollapsed && "lg:justify-center")}>
                            <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center shrink-0">
                                <span className="text-sm font-medium text-white">
                                    {user.username.charAt(0).toUpperCase()}
                                </span>
                            </div>
                            <div className={clsx(
                                "flex-1 overflow-hidden transition-all duration-300",
                                sidebarCollapsed ? "lg:w-0 lg:opacity-0" : "w-auto opacity-100"
                            )}>
                                <p className="text-sm font-medium text-white truncate">{user.username}</p>
                                <p className="text-xs text-slate-400 truncate">{user.role}</p>
                            </div>
                        </div>
                    )}

                    <button
                        onClick={() => {
                            logout();
                        }}
                        className={clsx(
                            "flex items-center gap-2 w-full p-2 text-sm text-red-400 hover:bg-red-500/10 rounded-lg transition-colors",
                            sidebarCollapsed ? "lg:justify-center" : "justify-center"
                        )}
                        title="Logout"
                    >
                        <span className={clsx(sidebarCollapsed ? "lg:hidden" : "")}>Logout</span>
                        {sidebarCollapsed && <span className="hidden lg:inline text-lg">🚪</span>}
                    </button>

                    <div className={clsx("text-[10px] text-slate-600 text-center mt-2", sidebarCollapsed && "lg:hidden")}>
                        &copy; 2026 Robot Verify
                    </div>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* Mobile Top Bar */}
                <div className="lg:hidden flex items-center justify-between p-3 bg-white border-b border-slate-200 shadow-sm shrink-0">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setSidebarOpen(true)}
                            className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors"
                        >
                            <Menu size={22} />
                        </button>
                        <div className="flex items-center gap-2">
                            <div className="w-6 h-6 bg-blue-600 rounded flex items-center justify-center">
                                <CheckCircle size={14} className="text-white" />
                            </div>
                            <span className="font-bold text-slate-800 text-sm">Robot Verify</span>
                        </div>
                    </div>
                    {user && (
                        <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center shrink-0">
                            <span className="text-sm font-medium text-slate-700">
                                {user.username.charAt(0).toUpperCase()}
                            </span>
                        </div>
                    )}
                </div>

                {/* Page Content */}
                <main className={clsx("flex-1 overflow-auto", location.pathname === '/setting' ? "p-3 sm:p-4 lg:p-6" : "p-4 sm:p-6 lg:p-8")}>
                    {children}
                </main>
            </div>
        </div>
    );
}