/* eslint-disable react/prop-types */
import { useState, useEffect } from 'react';
import { KeyRound, Plus, Trash2, Lock } from 'lucide-react';
import client from '../api/client';
import Swal from 'sweetalert2';

export default function ApiKeys() {
    const [keys, setKeys] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchKeys();
    }, []);

    const fetchKeys = async () => {
        setLoading(true);
        try {
            const res = await client.get('/api/v1/auth/api-keys');
            const sortedKeys = res.data.sort((a, b) => a.name.localeCompare(b.name));
            setKeys(sortedKeys);
        } catch (err) {
            Swal.fire('Error', 'Failed to load API keys', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleCreate = async () => {
        const { value: name } = await Swal.fire({
            title: 'Create New API Key',
            input: 'text',
            inputLabel: 'Key Name (e.g. Jenkins Pipeline)',
            inputPlaceholder: 'Enter name...',
            showCancelButton: true,
            inputValidator: (value) => {
                if (!value) return 'Please enter a name!';
            }
        });

        if (name) {
            try {
                const res = await client.post('/api/v1/auth/api-keys', { name });
                Swal.fire({
                    title: 'API Key Created!',
                    html: `
                        <p class="text-sm text-slate-500 mb-4">Please copy this key now. You won't be able to see it again!</p>
                        <div class="bg-slate-100 p-3 rounded border font-mono text-sm break-all select-all">
                            ${res.data.api_key}
                        </div>
                    `,
                    icon: 'success',
                    confirmButtonText: 'I have copied it'
                });
                fetchKeys();
            } catch (err) {
                Swal.fire('Error', 'Failed to create API key', 'error');
            }
        }
    };

    const handleDelete = async (id) => {
        const result = await Swal.fire({
            title: 'Are you sure?',
            text: "This will permanently revoke access for applications using this key.",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#ef4444',
            confirmButtonText: 'Yes, revoke it!'
        });

        if (result.isConfirmed) {
            try {
                await client.delete(`/api/v1/auth/api-keys/${id}`);
                Swal.fire('Revoked!', 'The API Key has been deleted.', 'success');
                fetchKeys();
            } catch (err) {
                Swal.fire('Error', 'Failed to delete key', 'error');
            }
        }
    };

    return (
        <div className="flex-1 overflow-auto bg-slate-50">
            <div className="max-w-4xl mx-auto p-4 sm:p-6 lg:p-8">

                <div className="mb-8">
                    <h1 className="text-2xl font-bold text-slate-900 mb-2">API Keys</h1>
                    <p className="text-slate-500">Manage API keys for machine-to-machine integration (e.g., Jenkins, CI/CD).</p>
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="p-4 sm:p-6 border-b border-slate-200 flex justify-between items-center">
                        <div className="flex items-center gap-2">
                            <KeyRound className="text-slate-400" size={20} />
                            <h2 className="font-semibold text-slate-800">Active Keys</h2>
                        </div>
                        <button
                            onClick={handleCreate}
                            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2"
                        >
                            <Plus size={18} />
                            <span className="hidden sm:inline">Create New Key</span>
                        </button>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-slate-50 border-b border-slate-200">
                                    <th className="py-3 px-4 sm:px-6 w-16 text-center font-semibold text-slate-600 text-sm">No.</th>
                                    <th className="py-3 px-4 sm:px-6 font-semibold text-slate-600 text-sm">Name</th>
                                    <th className="py-3 px-4 sm:px-6 font-semibold text-slate-600 text-sm">Created At</th>
                                    <th className="py-3 px-4 sm:px-6 font-semibold text-slate-600 text-sm text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {loading ? (
                                    <tr>
                                        <td colSpan="4" className="py-8 text-center text-slate-400">Loading...</td>
                                    </tr>
                                ) : keys.length === 0 ? (
                                    <tr>
                                        <td colSpan="4" className="py-8 text-center text-slate-400">
                                            No API keys found. Create one to get started.
                                        </td>
                                    </tr>
                                ) : (
                                    keys.map((key, index) => (
                                        <tr key={key.id} className="hover:bg-slate-50 transition-colors">
                                            <td className="py-3 px-4 sm:px-6 text-center text-slate-500">{index + 1}</td>
                                            <td className="py-3 px-4 sm:px-6 text-slate-800 font-medium">{key.name}</td>
                                            <td className="py-3 px-4 sm:px-6 text-slate-500">
                                                {new Date(key.created_at).toLocaleDateString()}
                                            </td>
                                            <td className="py-3 px-4 sm:px-6 text-right">
                                                <button
                                                    onClick={() => handleDelete(key.id)}
                                                    className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                                    title="Revoke Key"
                                                >
                                                    <Trash2 size={18} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

            </div>
        </div>
    );
}
