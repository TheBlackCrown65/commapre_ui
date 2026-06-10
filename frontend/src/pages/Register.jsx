/* eslint-disable react/prop-types */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, Loader2 } from 'lucide-react';
import client from '../api/client';
import Swal from 'sweetalert2';

export default function Register() {
    const navigate = useNavigate();
    const [username, setUsername] = useState('');
    const [departments, setDepartments] = useState([]);
    const [selectedDeptId, setSelectedDeptId] = useState('');
    const [selectedSquadId, setSelectedSquadId] = useState('');
    const [customRoleId, setCustomRoleId] = useState('');
    const [roles, setRoles] = useState([]);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        client.get('/api/v1/org/public/departments')
            .then(res => setDepartments(res.data))
            .catch(() => {});
        client.get('/api/v1/roles/public')
            .then(res => setRoles(res.data))
            .catch(() => {});
    }, []);

    const selectedDept = departments.find(d => d.id === Number(selectedDeptId));
    const squads = selectedDept?.squads || [];

    const handleDeptChange = (e) => {
        setSelectedDeptId(e.target.value);
        setSelectedSquadId('');
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            await client.post('/api/v1/auth/register', {
                username,
                department_id: selectedDeptId ? Number(selectedDeptId) : null,
                squad_id: selectedSquadId ? Number(selectedSquadId) : null,
                custom_role_id: customRoleId ? Number(customRoleId) : null,
            });
            Swal.fire({
                icon: 'success',
                title: 'Registration Submitted',
                text: 'Your account is currently PENDING. Please wait for an administrator to approve your account and provide login credentials.',
                confirmButtonColor: '#3b82f6'
            }).then(() => {
                navigate('/login');
            });
        } catch (err) {
            const msg = err.response?.data?.detail || 'Registration failed';
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
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-500/25 mb-4">
                        <ShieldCheck className="w-8 h-8 text-white" />
                    </div>
                    <h1 className="text-3xl font-bold text-white tracking-tight">Request Access</h1>
                    <p className="text-slate-400 mt-1 text-sm">Register for an account</p>
                </div>

                <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl">
                    <form onSubmit={handleSubmit} className="space-y-5">
                        <div>
                            <label htmlFor="reg-username" className="block text-sm font-medium text-slate-300 mb-1.5">Username</label>
                            <input id="reg-username"
                                type="text"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all"
                                placeholder="Choose a username"
                                required
                            />
                        </div>

                        <div>
                            <label htmlFor="reg-dept" className="block text-sm font-medium text-slate-300 mb-1.5">Department</label>
                            <select id="reg-dept"
                                value={selectedDeptId}
                                onChange={handleDeptChange}
                                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all appearance-none"
                                required
                            >
                                <option value="" className="bg-slate-800 text-slate-400">Select department</option>
                                {departments.map(d => (
                                    <option key={d.id} value={d.id} className="bg-slate-800">{d.name}</option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label htmlFor="reg-squad" className="block text-sm font-medium text-slate-300 mb-1.5">Squad</label>
                            <select id="reg-squad"
                                value={selectedSquadId}
                                onChange={(e) => setSelectedSquadId(e.target.value)}
                                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all appearance-none disabled:opacity-50"
                                required
                                disabled={!selectedDeptId}
                            >
                                <option value="" className="bg-slate-800 text-slate-400">Select squad</option>
                                {squads.map(s => (
                                    <option key={s.id} value={s.id} className="bg-slate-800">{s.name}</option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label htmlFor="reg-role" className="block text-sm font-medium text-slate-300 mb-1.5">Job Role</label>
                            <select id="reg-role"
                                value={customRoleId}
                                onChange={(e) => setCustomRoleId(e.target.value)}
                                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all appearance-none"
                                required
                            >
                                <option value="" className="bg-slate-800 text-slate-400">Select Job Role</option>
                                {roles.map(r => (
                                    <option key={r.id} value={r.id} className="bg-slate-800">{r.name}</option>
                                ))}
                            </select>
                        </div>

                        <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl px-4 py-3 text-blue-300 text-sm">
                            After registration, an Admin will review your request and provide login credentials.
                        </div>

                        {error && (
                            <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-400 text-sm">
                                {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold hover:from-blue-500 hover:to-indigo-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
                        >
                            {loading ? (
                                <>
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                    Submitting...
                                </>
                            ) : (
                                'Register'
                            )}
                        </button>
                    </form>
                    
                    <div className="mt-6 text-center">
                        <span className="text-slate-400 text-sm">Already have an account? </span>
                        <button 
                            onClick={() => navigate('/login')}
                            className="text-blue-400 hover:text-blue-300 text-sm font-medium transition-colors"
                        >
                            Login instead
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
