import { useState, useCallback, useEffect } from 'react';
import client from '../api/client';
import Swal from 'sweetalert2';

export function useAdminAuth() {
    const [authenticated, setAuthenticated] = useState(false);

    useEffect(() => {
        if (sessionStorage.getItem('admin_token')) {
            setAuthenticated(true);
        }
    }, []);

    const promptLogin = useCallback(async () => {
        const { value: formValues } = await Swal.fire({
            title: '🔐 Authentication Required',
            html: `
                <input id="swal-user" class="swal2-input" placeholder="Username" autocomplete="username">
                <input id="swal-pass" class="swal2-input" placeholder="Password" type="password" autocomplete="current-password">
            `,
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: 'Login',
            cancelButtonText: 'Cancel',
            didOpen: () => {
                const handleEnter = (e) => {
                    if (e.key === 'Enter') {
                        Swal.clickConfirm();
                    }
                };
                document.getElementById('swal-user').addEventListener('keydown', handleEnter);
                document.getElementById('swal-pass').addEventListener('keydown', handleEnter);
            },
            preConfirm: () => {
                const username = document.getElementById('swal-user').value;
                const password = document.getElementById('swal-pass').value;
                if (!username || !password) {
                    Swal.showValidationMessage('Please enter username and password');
                    return false;
                }
                return { username, password };
            }
        });

        if (!formValues) return false;

        try {
            const res = await client.post('/api/v1/auth/login', formValues);
            const { access_token } = res.data;
            sessionStorage.setItem('admin_token', access_token);
            setAuthenticated(true);
            return true;
        } catch (err) {
            Swal.fire('Login Failed', 'Incorrect Username or Password', 'error');
            return false;
        }
    }, []);

    const getToken = () => sessionStorage.getItem('admin_token');

    const handleAuthError = (err) => {
        if (err.response && err.response.status === 401) {
            sessionStorage.removeItem('admin_token');
            setAuthenticated(false);
        }
        throw err;
    };

    const authGet = useCallback(async (url) => {
        return client.get(url, { headers: { Authorization: `Bearer ${getToken()}` } }).catch(handleAuthError);
    }, []);

    const authPost = useCallback(async (url, data) => {
        return client.post(url, data, { headers: { Authorization: `Bearer ${getToken()}` } }).catch(handleAuthError);
    }, []);

    const authPut = useCallback(async (url, data) => {
        return client.put(url, data, { headers: { Authorization: `Bearer ${getToken()}` } }).catch(handleAuthError);
    }, []);

    const authDelete = useCallback(async (url) => {
        return client.delete(url, { headers: { Authorization: `Bearer ${getToken()}` } }).catch(handleAuthError);
    }, []);

    return { authenticated, promptLogin, authGet, authPost, authPut, authDelete };
}
