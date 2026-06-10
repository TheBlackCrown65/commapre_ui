/* eslint-disable react/prop-types */
import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, Loader2 } from 'lucide-react';

export default function Login() {
    const { login, user } = useAuth();
    const navigate = useNavigate();
    const apiUrl = import.meta.env.VITE_API_URL || '';
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [countdown, setCountdown] = useState(0);
    const [retryUntil, setRetryUntil] = useState(null);
    const [loading, setLoading] = useState(false);

    // Auto-redirect if already logged in
    useEffect(() => {
        if (user) {
            navigate('/');
        }
    }, [user, navigate]);



    // Real-time countdown timer for rate limiting
    useEffect(() => {
        let timer;
        if (retryUntil && Date.now() < retryUntil) {
            timer = setInterval(() => {
                const remaining = Math.max(0, Math.ceil((retryUntil - Date.now()) / 1000));
                setCountdown(remaining);
            }, 1000);
        } else if (retryUntil && Date.now() >= retryUntil) {
            setRetryUntil(null);
            setCountdown(0);
            setError('');
            setError('');
        }
        return () => clearInterval(timer);
    }, [retryUntil]);



    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        if (retryUntil && Date.now() < retryUntil) {
            const remaining = Math.max(0, Math.ceil((retryUntil - Date.now()) / 1000));
            setCountdown(remaining);
            setError('Too many login attempts. Try again in');
            return;
        }
        setCountdown(0);
        setRetryUntil(null);
        setLoading(true);

        try {
            const userData = await login(username, password);
            if (userData.must_change_password) {
                navigate('/change-password');
            } else {
                navigate('/');
            }
        } catch (err) {
            const statusCode = err.response?.status;
            const msg = err.response?.data?.detail || 'Login failed';
            const remainingAttempts = err.response?.data?.remaining_attempts;
            if (statusCode === 401 && Number.isFinite(remainingAttempts)) {
                if (remainingAttempts > 0) {
                    setError(`${msg}\nYou can try logging in ${remainingAttempts} more time(s).`);
                } else {
                    setError(`${msg}\nThe next attempt will start the cooldown timer.`);
                }
            } else {
                setError(msg);
            }

            if (statusCode === 429) {
                const retryAfterHeader = err.response?.headers?.['retry-after'];
                const retryAfter = Number(retryAfterHeader);
                if (Number.isFinite(retryAfter) && retryAfter > 0) {
                    setRetryUntil(Date.now() + retryAfter * 1000);
                    setCountdown(retryAfter);
                    return;
                }

                const match = msg.match(/Try again in (\d+) seconds/);
                if (match) {
                    const seconds = Number.parseInt(match[1], 10);
                    if (Number.isFinite(seconds) && seconds > 0) {
                        setRetryUntil(Date.now() + seconds * 1000);
                        setCountdown(seconds);
                    }
                }
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900">
            <div className="absolute inset-0 overflow-hidden">
                <div className="absolute -top-40 -right-40 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl" />
                <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl" />
            </div>

            <div className="relative z-10 w-full max-w-md px-6">
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-500/25 mb-4">
                        <ShieldCheck className="w-8 h-8 text-white" />
                    </div>
                    <h1 className="text-3xl font-bold text-white tracking-tight">Robot Verify</h1>
                    <p className="text-slate-400 mt-1 text-sm">Enterprise Image Comparison Platform</p>
                </div>

                <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl">
                    <h2 className="text-xl font-semibold text-white mb-6">Login</h2>

                    <form onSubmit={handleSubmit} className="space-y-5">
                        <div>
                            <label htmlFor="login-username" className="block text-sm font-medium text-slate-300 mb-1.5">Username</label>
                            <input
                                id="login-username"
                                type="text"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all"
                                placeholder="Enter username"
                                autoComplete="username"
                                required
                            />
                        </div>

                        <div>
                            <label htmlFor="login-password" className="block text-sm font-medium text-slate-300 mb-1.5">Password</label>
                            <input
                                id="login-password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all"
                                placeholder="Enter password"
                                autoComplete="current-password"
                                required
                            />
                        </div>

                        {error && (
                            <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-400 text-sm">
                                {countdown > 0 ? (
                                    <>Too many login attempts. Try again in {countdown} seconds.</>
                                ) : (
                                    <span className="whitespace-pre-line">{error}</span>
                                )}
                            </div>
                        )}

                        <button
                            id="login-submit"
                            type="submit"
                            disabled={loading || (retryUntil && Date.now() < retryUntil)}
                            className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold hover:from-blue-500 hover:to-indigo-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
                        >
                            {loading ? (
                                <>
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                    Logging in...
                                </>
                            ) : (
                                'Login'
                            )}
                        </button>
                    </form>

                    <div className="mt-6 text-center">
                        <span className="text-slate-400 text-sm">Don't have an account? </span>
                        <button
                            onClick={() => navigate('/register')}
                            className="text-blue-400 hover:text-blue-300 text-sm font-medium transition-colors"
                        >
                            Request Access
                        </button>
                    </div>
                </div>

                <p className="text-center text-slate-500 text-xs mt-6">
                    © 2026 Robot Verify · Enterprise Edition
                </p>
            </div>
        </div>
    );
}
