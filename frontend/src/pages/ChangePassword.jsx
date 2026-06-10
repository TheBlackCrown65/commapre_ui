/* eslint-disable react/prop-types */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, Loader2, Check, X } from 'lucide-react';
import client from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import Swal from 'sweetalert2';
import clsx from 'clsx';

export default function ChangePassword() {
    const navigate = useNavigate();
    const { user, updateUser } = useAuth();
    const [oldPassword, setOldPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    // If user somehow gets here without the flag, just redirect to dashboard
    if (user && !user.must_change_password) {
        navigate('/');
        return null;
    }

    // 💡 ฟังก์ชันประเมินความแข็งแกร่งของรหัสผ่าน
    const calculateStrength = (pass) => {
        let score = 0;
        if (pass.length >= 8) score += 1;
        if (/[A-Z]/.test(pass)) score += 1;
        if (/[a-z]/.test(pass)) score += 1;
        if (/[0-9]/.test(pass)) score += 1;
        if (/[^A-Za-z0-9]/.test(pass)) score += 1;
        return score;
    };

    const strengthScore = calculateStrength(newPassword);

    // 💡 รายการกฎเกณฑ์รหัสผ่านสากล
    const passwordRules = [
        { label: 'At least 8 characters', met: newPassword.length >= 8 },
        { label: 'Uppercase letter (A-Z)', met: /[A-Z]/.test(newPassword) },
        { label: 'Lowercase letter (a-z)', met: /[a-z]/.test(newPassword) },
        { label: 'Number (0-9)', met: /[0-9]/.test(newPassword) },
        { label: 'Special character (!@#$%^&*)', met: /[^A-Za-z0-9]/.test(newPassword) },
    ];

    const strengthLabels = ['Very Weak', 'Weak', 'Fair', 'Good', 'Strong', 'Excellent'];
    const strengthColors = [
        'bg-slate-600', // 0
        'bg-red-500 shadow-red-500/50', // 1
        'bg-orange-500 shadow-orange-500/50', // 2
        'bg-yellow-500 shadow-yellow-500/50', // 3
        'bg-blue-500 shadow-blue-500/50', // 4
        'bg-emerald-500 shadow-emerald-500/50' // 5
    ];

    // คำนวณความกว้างของหลอดพลัง (0% ถึง 100%)
    const getBarWidth = () => {
        if (newPassword.length === 0) return '0%';
        return `${(strengthScore / 5) * 100}%`;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        // 💡 บังคับว่าต้องผ่านกฎสากลครบทุกข้อ
        if (strengthScore < 5) {
            setError('Please ensure your new password meets all security requirements.');
            return;
        }

        if (newPassword !== confirmPassword) {
            setError('New passwords do not match');
            return;
        }

        setLoading(true);

        try {
            await client.post('/api/v1/auth/change-password', {
                old_password: oldPassword,
                new_password: newPassword
            });

            // Clear the flag in the context
            updateUser({ must_change_password: false });

            Swal.fire({
                icon: 'success',
                title: 'Password Changed',
                text: 'Your password has been successfully updated.',
                timer: 2000,
                showConfirmButton: false
            }).then(() => {
                navigate('/');
            });
        } catch (err) {
            const msg = err.response?.data?.detail || 'Failed to change password';
            setError(msg);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900">
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-40 -right-40 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl" />
                <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl" />
            </div>

            <div className="relative z-10 w-full max-w-md px-6 py-8">
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg shadow-amber-500/25 mb-4">
                        <KeyRound className="w-8 h-8 text-white" />
                    </div>
                    <h1 className="text-3xl font-bold text-white tracking-tight">Change Password</h1>
                    <p className="text-amber-200/80 mt-2 text-sm max-w-sm mx-auto bg-amber-500/10 p-2 rounded-lg border border-amber-500/20">
                        For security reasons, you must change your automatically generated password before continuing.
                    </p>
                </div>

                <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl">
                    <form onSubmit={handleSubmit} className="space-y-5">
                        <div>
                            <label htmlFor="cp-current" className="block text-sm font-medium text-slate-300 mb-1.5">Current Password</label>
                            <input
                                id="cp-current"
                                type="password"
                                value={oldPassword}
                                onChange={(e) => setOldPassword(e.target.value)}
                                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all"
                                placeholder="Enter current password"
                                required
                            />
                        </div>

                        <div>
                            <label htmlFor="cp-new" className="block text-sm font-medium text-slate-300 mb-1.5">New Password</label>
                            <input id="cp-new"
                                type="password"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all"
                                placeholder="Enter new password"
                                required
                            />

                            {/* 💡 Password Strength Meter Animation */}
                            {newPassword.length > 0 && (
                                <div className="mt-3 animate-in fade-in slide-in-from-top-1 duration-300">
                                    <div className="flex justify-between items-center mb-1.5">
                                        <span className="text-xs font-medium text-slate-400">Password Strength:</span>
                                        <span className={clsx(
                                            "text-xs font-bold transition-colors duration-300",
                                            strengthScore === 5 ? "text-emerald-400" :
                                                strengthScore === 4 ? "text-blue-400" :
                                                    strengthScore === 3 ? "text-yellow-400" :
                                                        strengthScore >= 1 ? "text-orange-400" : "text-slate-400"
                                        )}>
                                            {strengthLabels[strengthScore]}
                                        </span>
                                    </div>
                                    <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden flex">
                                        <div
                                            className={clsx(
                                                "h-full rounded-full transition-all duration-500 ease-out shadow-lg",
                                                strengthColors[strengthScore]
                                            )}
                                            style={{ width: getBarWidth() }}
                                        />
                                    </div>
                                </div>
                            )}

                            {/* 💡 Password Rules Checklist */}
                            <div className="mt-3 bg-slate-900/50 rounded-lg p-3 border border-slate-800">
                                <ul className="space-y-1.5">
                                    {passwordRules.map((rule, idx) => (
                                        <li key={idx} className="flex items-center gap-2 text-xs">
                                            <span className={clsx(
                                                "flex items-center justify-center w-4 h-4 rounded-full transition-colors duration-300",
                                                rule.met ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-800 text-slate-500"
                                            )}>
                                                {rule.met ? <Check size={10} strokeWidth={3} /> : <X size={10} strokeWidth={3} />}
                                            </span>
                                            <span className={clsx(
                                                "transition-colors duration-300",
                                                rule.met ? "text-slate-300" : "text-slate-500"
                                            )}>
                                                {rule.label}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>

                        <div>
                            <label htmlFor="cp-confirm" className="block text-sm font-medium text-slate-300 mb-1.5">Confirm New Password</label>
                            <input id="cp-confirm"
                                type="password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all"
                                placeholder="Confirm new password"
                                required
                            />
                        </div>

                        {error && (
                            <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-400 text-sm animate-in fade-in">
                                {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading || strengthScore < 5}
                            className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 text-white font-semibold hover:from-amber-500 hover:to-orange-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 mt-4"
                        >
                            {loading ? (
                                <>
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                    Updating...
                                </>
                            ) : (
                                'Update Password'
                            )}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}