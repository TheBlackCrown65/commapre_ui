/* eslint-disable react/prop-types */
import { useState, useEffect } from 'react';
import client from '../api/client';
import { Save, Settings, Lock, Loader2 } from 'lucide-react';
import Swal from 'sweetalert2';

export default function AdminConfig() {
    const [configs, setConfigs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [savingKey, setSavingKey] = useState(null);

    // 💡 กำหนดค่า Default
    const defaultValues = {
        max_flow_note_length: '200',
        max_folder_depth: '4',
        max_image_size_mb: '5',
        max_images_per_flow: '50',
        max_jobs_per_department: '10',
        max_dashboard_jobs: '10',
        max_queue_size: '50',
        worker_concurrency: '5',
        job_retention_days: '30',
        job_cleanup_time: '02:00',
        offline_suspend_days: '30'
    };

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        setLoading(true);
        try {
            const configsRes = await client.get('/api/v1/config');
            const loadedConfigs = configsRes.data.map(c => ({
                ...c,
                original_value: c.value
            }));
            setConfigs(loadedConfigs);
        } catch (err) {
            console.error(err);
            if (!err?.isAuthError) Swal.fire('Error', 'Failed to load System Config', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleValueChange = (key, newValue) => {
        setConfigs(prev => prev.map(c =>
            c.key === key ? { ...c, value: newValue } : c
        ));
    };

    // 💡 ดักจับ ให้พิมพ์ได้แค่ตัวเลข 1-999 เท่านั้น
    const handleNumberChange = (key, rawValue) => {
        let val = rawValue.replaceAll(/\D/g, '');
        if (val !== '' && Number.parseInt(val, 10) > 999) {
            val = '999';
        }
        handleValueChange(key, val);
    };

    // 💡 ดักตอนผู้ใช้คลิกเมาส์ออก (Blur)
    const handleBlur = (key, value) => {
        if (!value || value.trim() === '' || Number.parseInt(value, 10) < 1) {
            handleValueChange(key, defaultValues[key] || '1');
        }
    };

    const handleSave = async (key, newValue, originalValue) => {
        if (newValue === originalValue) return;

        setSavingKey(key);

        try {
            await client.put(`/api/v1/config/${key}`, { value: newValue });
            Swal.fire({
                toast: true,
                position: 'top-end',
                icon: 'success',
                title: 'Settings saved successfully',
                showConfirmButton: false,
                timer: 1500
            });
            setConfigs(prev => prev.map(c =>
                c.key === key ? { ...c, original_value: newValue } : c
            ));
        } catch (err) {
            console.error(err);
            if (!err?.isAuthError) {
                Swal.fire('Error', 'Failed to save settings', 'error');
                setConfigs(prev => prev.map(c =>
                    c.key === key ? { ...c, value: originalValue } : c
                ));
            }
        } finally {
            setSavingKey(null);
        }
    };

    // 💡 ฟังก์ชันพิเศษสำหรับ Save กลุ่ม Cronjob 2 ค่าพร้อมกัน
    const handleSaveCronjob = async () => {
        const retentionConf = configs.find(c => c.key === 'job_retention_days');
        const timeConf = configs.find(c => c.key === 'job_cleanup_time');

        if (!retentionConf || !timeConf) return;

        setSavingKey('cronjob_save');

        try {
            let updated = false;
            // ตรวจสอบและบันทึกทีละค่า
            if (retentionConf.value !== retentionConf.original_value) {
                await client.put(`/api/v1/config/job_retention_days`, { value: retentionConf.value });
                updated = true;
            }
            if (timeConf.value !== timeConf.original_value) {
                await client.put(`/api/v1/config/job_cleanup_time`, { value: timeConf.value });
                updated = true;
            }

            if (updated) {
                Swal.fire({
                    toast: true,
                    position: 'top-end',
                    icon: 'success',
                    title: 'Cronjob settings updated',
                    showConfirmButton: false,
                    timer: 1500
                });

                // อัปเดต original_value ใน State
                setConfigs(prev => prev.map(c => {
                    if (c.key === 'job_retention_days') return { ...c, original_value: c.value };
                    if (c.key === 'job_cleanup_time') return { ...c, original_value: c.value };
                    return c;
                }));
            }
        } catch (err) {
            console.error(err);
            if (!err?.isAuthError) {
                Swal.fire('Error', 'Failed to save Cronjob settings', 'error');
                // Rollback ค่ากลับไปเป็นของเดิมถ้า Error
                setConfigs(prev => prev.map(c => {
                    if (c.key === 'job_retention_days') return { ...c, value: c.original_value };
                    if (c.key === 'job_cleanup_time') return { ...c, value: c.original_value };
                    return c;
                }));
            }
        } finally {
            setSavingKey(null);
        }
    };

    if (loading) return <div className="p-8 text-center text-slate-500">Loading Configuration...</div>;

    const generalKeys = ['max_image_size_mb', 'max_images_per_flow', 'max_folder_depth', 'max_queue_size', 'max_jobs_per_department', 'max_dashboard_jobs', 'max_flow_note_length', 'worker_concurrency', 'offline_suspend_days'];

    // 💡 ฟังก์ชันวาด UI แบบปกติ
    const renderGroup = (title, keys) => {
        const groupConfigs = keys.map(key => configs.find(c => c.key === key)).filter(Boolean);
        if (groupConfigs.length === 0) return null;

        return (
            <div className="mb-8">
                <h3 className="text-lg font-bold text-slate-700 border-b border-slate-200 pb-2 mb-4">{title}</h3>
                <div className="space-y-4">
                    {groupConfigs.map(config => {
                        const isChanged = config.value !== config.original_value;
                        const isToggle = config.key.startsWith('enable_');
                        const isTextarea = config.key.includes('prompt');
                        const toggleValue = config.value?.toLowerCase() === 'true';
                        const isSaving = savingKey === config.key;

                        return (
                            <div key={config.key} className="bg-slate-50 border border-slate-200 p-4 rounded-xl flex flex-col gap-2">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <label htmlFor={`config-${config.key}`} className="font-semibold text-slate-800 block">{config.key}</label>
                                        <span className="text-sm text-slate-500">{config.description}</span>
                                    </div>
                                    {isToggle ? (
                                        <button
                                            onClick={() => {
                                                const newVal = toggleValue ? 'false' : 'true';
                                                handleValueChange(config.key, newVal);
                                                handleSave(config.key, newVal, config.original_value);
                                            }}
                                            className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-300 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 ${toggleValue ? 'bg-blue-600' : 'bg-slate-300'}`}
                                        >
                                            <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-300 ${toggleValue ? 'translate-x-6' : 'translate-x-1'}`} />
                                        </button>
                                    ) : (
                                        <button
                                            onClick={() => handleSave(config.key, config.value, config.original_value)}
                                            disabled={!isChanged || isSaving}
                                            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${isSaving
                                                ? 'bg-amber-500 text-white cursor-wait shadow-sm'
                                                : isChanged
                                                    ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm'
                                                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                                                }`}
                                        >
                                            {isSaving ? (
                                                <><Loader2 size={16} className="animate-spin" /> Waiting...</>
                                            ) : (
                                                <><Save size={16} /> Save</>
                                            )}
                                        </button>
                                    )}
                                </div>
                                <div className="mt-1 text-slate-500 text-xs">
                                    Last updated: {new Date(config.updated_at).toLocaleString()}
                                </div>

                                {isToggle ? (
                                    <div className="mt-1">
                                        <span className={`text-sm font-medium ${toggleValue ? 'text-blue-600' : 'text-slate-400'}`}>
                                            {toggleValue ? 'Enabled' : 'Disabled'}
                                        </span>
                                    </div>
                                ) : (
                                    <div className="mt-2">
                                        {isTextarea ? (
                                            <textarea
                                                id={`config-${config.key}`}
                                                value={config.value}
                                                onChange={(e) => handleValueChange(config.key, e.target.value)}
                                                className="w-full border border-slate-300 rounded-lg p-3 min-h-[120px] focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white"
                                            />
                                        ) : (
                                            <input
                                                id={`config-${config.key}`}
                                                type="text"
                                                value={config.value}
                                                onChange={(e) => handleNumberChange(config.key, e.target.value)}
                                                onBlur={(e) => handleBlur(config.key, e.target.value)}
                                                className="w-full sm:max-w-md border border-slate-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white"
                                            />
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    };

    // 💡 ฟังก์ชันพิเศษวาด UI รวมร่างสำหรับ Cronjob
    const renderCronjobGroup = () => {
        const retentionConf = configs.find(c => c.key === 'job_retention_days');
        const timeConf = configs.find(c => c.key === 'job_cleanup_time');

        if (!retentionConf || !timeConf) return null;

        const isChanged = retentionConf.value !== retentionConf.original_value || timeConf.value !== timeConf.original_value;
        const isSaving = savingKey === 'cronjob_save';
        const lastUpdated = new Date(Math.max(new Date(retentionConf.updated_at), new Date(timeConf.updated_at))).toLocaleString();

        return (
            <div className="mb-8">
                <h3 className="text-lg font-bold text-slate-700 border-b border-slate-200 pb-2 mb-4">Data Retention & Cleanup (Cronjob)</h3>

                <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl flex flex-col gap-3">
                    <div className="flex justify-between items-start">
                        <div>
                            <label htmlFor="config-job-retention" className="font-semibold text-slate-800 block">job_retention_days</label>
                            <span className="text-sm text-slate-500">Number of days to keep job history before auto-deletion</span>
                        </div>
                        <button
                            onClick={handleSaveCronjob}
                            disabled={!isChanged || isSaving}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${isSaving
                                ? 'bg-amber-500 text-white cursor-wait shadow-sm'
                                : isChanged
                                    ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm'
                                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                                }`}
                        >
                            {isSaving ? (
                                <><Loader2 size={16} className="animate-spin" /> Waiting...</>
                            ) : (
                                <><Save size={16} /> Save</>
                            )}
                        </button>
                    </div>

                    <div className="text-slate-500 text-xs mt-[-5px]">
                        Last updated: {lastUpdated}
                    </div>

                    <div className="flex flex-wrap items-center gap-4 mt-1">
                        {/* 💡 กล่องใส่จำนวนวัน */}
                        <div className="flex items-center gap-3">
                            <input
                                id="config-job-retention"
                                type="text"
                                value={retentionConf.value}
                                onChange={(e) => handleNumberChange(retentionConf.key, e.target.value)}
                                onBlur={(e) => handleBlur(retentionConf.key, e.target.value)}
                                className="w-24 border border-slate-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white text-center font-bold text-slate-700"
                            />
                            <span className="text-slate-500 font-medium mr-2">Days</span>
                        </div>

                        {/* 💡 กล่องใส่นาฬิกา */}
                        <div className="flex items-center gap-3">
                            <input
                                type="time"
                                value={timeConf.value || '02:00'}
                                onChange={(e) => handleValueChange(timeConf.key, e.target.value)}
                                className="border border-slate-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white font-mono"
                            />
                            <span className="text-sm text-slate-500">24-hour format (e.g., 02:00)</span>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="p-8 max-w-5xl mx-auto">
            <div className="flex items-center gap-3 mb-8">
                <div className="w-12 h-12 bg-white rounded-xl shadow-sm border border-slate-200 flex items-center justify-center text-slate-600">
                    <Settings size={24} />
                </div>
                <div>
                    <h1 className="text-2xl font-bold text-slate-800">System Configuration</h1>
                    <p className="text-slate-500">Manage global settings and integration parameters.</p>
                </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 md:p-8">
                {renderGroup('General Settings', generalKeys)}

                {/* 💡 เรียกใช้ฟังก์ชันแสดงผล Cronjob ที่เขียนขึ้นมาใหม่ */}
                {renderCronjobGroup()}
            </div>
        </div>
    );
}