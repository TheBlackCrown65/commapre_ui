/* eslint-disable react/prop-types */
import { createContext, useContext, useState, useEffect } from 'react';
import client from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // 💡 เปลี่ยนจาก localStorage เป็น sessionStorage เพื่อให้ข้อมูลหายไปเมื่อปิด Browser
        const token = sessionStorage.getItem('token');
        const savedUser = sessionStorage.getItem('user');
        if (token && savedUser) {
            try {
                setUser(JSON.parse(savedUser));
                client.defaults.headers.common['Authorization'] = `Bearer ${token}`;
            } catch {
                logout();
            }
        }
        setLoading(false);
        // 💡 เมื่อผู้ใช้ปิด Browser หรือ Tab ให้ส่ง Request ไปตั้งสถานะ PENDING_LOGOUT อัตโนมัติที่ Backend
        const handleBeforeUnload = () => {
            const currentToken = sessionStorage.getItem('token');
            if (currentToken) {
                // ใช้ fetch keepalive เพื่อให้ request ทำงานแม้ปิด tab ไปแล้ว
                fetch(`${client.defaults.baseURL || ''}/api/v1/auth/unload`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${currentToken}` },
                    keepalive: true
                }).catch(() => {});
            }
        };

        // 💡 ระบบ Sync Session ระหว่าง Tab (เปิด Tab ใหม่ไม่ต้อง Login ซ้ำ)
        const handleStorage = (e) => {
            if (e.key === 'REQUEST_SESSION' && sessionStorage.getItem('token')) {
                // มี Tab ใหม่ร้องขอ Session เราจะส่งข้อมูลไปให้ผ่าน localStorage (ชั่วคราว)
                localStorage.setItem('SHARE_SESSION', JSON.stringify({
                    token: sessionStorage.getItem('token'),
                    user: sessionStorage.getItem('user')
                }));
                // ลบทิ้งทันที แต่อีเวนต์จะยังทำงานใน Tab อื่น
                localStorage.removeItem('SHARE_SESSION');
            } else if (e.key === 'SHARE_SESSION' && e.newValue) {
                // ได้รับข้อมูล Session จาก Tab อื่น
                try {
                    const data = JSON.parse(e.newValue);
                    if (data && data.token && data.user) {
                        sessionStorage.setItem('token', data.token);
                        sessionStorage.setItem('user', data.user);
                        
                        setUser(JSON.parse(data.user));
                        client.defaults.headers.common['Authorization'] = `Bearer ${data.token}`;
                    }
                } catch (err) {}
            }
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        window.addEventListener('storage', handleStorage);

        // ถ้าเปิด Tab ใหม่แล้วไม่มี Session ให้ร้องขอจาก Tab อื่น
        if (!sessionStorage.getItem('token')) {
            localStorage.setItem('REQUEST_SESSION', Date.now().toString());
            localStorage.removeItem('REQUEST_SESSION');
        }

        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
            window.removeEventListener('storage', handleStorage);
        };
    }, []);

    // 💡 Heartbeat ทุก 30 วินาที เพื่อให้ Backend รู้ว่าเรายังเปิดหน้าเว็บอยู่
    useEffect(() => {
        let interval;
        const token = sessionStorage.getItem('token');
        if (user && token) {
            interval = setInterval(() => {
                client.get('/api/v1/auth/me').catch(() => {});
            }, 30000);
        }
        return () => {
            if (interval) clearInterval(interval);
        };
    }, [user]);

    const login = async (username, password) => {
        const res = await client.post('/api/v1/auth/login', { username, password });
        const { access_token, user: userData } = res.data;

        // 💡 ใช้ sessionStorage แทน localStorage
        sessionStorage.setItem('token', access_token);
        sessionStorage.setItem('user', JSON.stringify(userData));

        client.defaults.headers.common['Authorization'] = `Bearer ${access_token}`;
        setUser(userData);
        return userData;
    };

    const logout = async () => {
        try {
            await client.post('/api/v1/auth/logout');
        } catch {
            // Ignore errors
        }
        // 💡 ล้างข้อมูลจาก sessionStorage
        sessionStorage.removeItem('token');
        sessionStorage.removeItem('user');

        delete client.defaults.headers.common['Authorization'];
        setUser(null);
    };

    const updateUser = (newUserData) => {
        const merged = { ...user, ...newUserData };
        // 💡 อัปเดตข้อมูลใน sessionStorage
        sessionStorage.setItem('user', JSON.stringify(merged));
        setUser(merged);
    };

    return (
        <AuthContext.Provider value={{ user, login, logout, updateUser, loading }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
    return ctx;
}