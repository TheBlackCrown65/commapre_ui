import axios from 'axios';
import Swal from 'sweetalert2';

const API_URL = import.meta.env.VITE_API_URL || "";

// Create axios instance
const client = axios.create({
    baseURL: API_URL,
    timeout: 600000, // 10 minutes — for long-running tasks like run-test
    headers: {
        'Content-Type': 'application/json'
    }
});

// Response interceptor for logging errors & handling 401 Unauthorized
client.interceptors.response.use(
    response => response,
    error => {
        // Catch 401 Unauthorized errors (Session/Token expired)
        if (error.response && error.response.status === 401) {

            // 💡 Exception: If it's a login request and password is wrong, don't refresh! Let the error show up
            const isLoginRequest = error.config && error.config.url && error.config.url.includes('/login');

            if (!isLoginRequest) {
                // 1. Attach flag to tell Component this is an auth expiration error (prevent duplicate popups)
                error.isAuthError = true;

                // 2. Close any pending SweetAlert popups
                Swal.close();

                // 3. Clear tokens from storage
                ['adminToken', 'token', 'access_token'].forEach(key => {
                    localStorage.removeItem(key);
                    sessionStorage.removeItem(key);
                });

                // 4. Redirect immediately to login screen
                window.location.href = '/login';
            }

            return Promise.reject(error);
        }

        console.error('API Error:', error.response || error.message);
        return Promise.reject(error);
    }
);

export default client;
export { API_URL };