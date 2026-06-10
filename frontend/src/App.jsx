/* eslint-disable react/prop-types */
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Settings from './pages/Settings';
import RunTest from './pages/RunTest';
import Dashboard from './pages/Dashboard';
import AdminConfig from './pages/AdminConfig';
import OrgSettings from './pages/OrgSettings';
import ApiKeys from './pages/ApiKeys';
import SystemMonitor from './pages/SystemMonitor';
import Login from './pages/Login';
import Register from './pages/Register';
import ChangePassword from './pages/ChangePassword';
import ManageUsers from './pages/ManageUsers';
import ManageRoles from './pages/ManageRoles';
import ActivityLog from './pages/ActivityLog';
import { AuthProvider, useAuth } from './contexts/AuthContext';

// Protected Route wrapper
function ProtectedRoute({ children, adminOnly = false, menuKey = null }) {
    const { user, loading } = useAuth();
    if (loading) return null; // or a spinner
    
    if (!user) return <Navigate to="/login" replace />;
    
    const isSuperAdmin = user.role === 'ADMIN' && !user.custom_role_id;
    
    if (adminOnly && !isSuperAdmin) {
        return <Navigate to="/dashboard" replace />;
    }
    
    if (!isSuperAdmin && menuKey) {
        const hasAccess = user.menu_permissions?.includes(menuKey);
        if (!hasAccess) {
            return <Navigate to="/dashboard" replace />;
        }
    }
    
    // Force password change if needed and not on that page
    if (user.must_change_password) {
        return <Navigate to="/change-password" replace />;
    }
    
    return children;
}

export default function App() {
    return (
        <AuthProvider>
            <BrowserRouter>
                <Routes>
                    {/* Public Routes */}
                    <Route path="/login" element={<Login />} />
                    <Route path="/register" element={<Register />} />
                    <Route path="/change-password" element={<ChangePassword />} />
                    
                    {/* Protected Routes with Layout */}
                    <Route path="/*" element={
                        <ProtectedRoute>
                            <Layout>
                                <Routes>
                                    <Route path="/" element={<Navigate to="/dashboard" replace />} />
                                    <Route path="/dashboard" element={<Dashboard />} />
                                    <Route path="/setting" element={<Settings />} />
                                    <Route path="/run" element={<RunTest />} />
                                    <Route path="/org" element={
                                        <ProtectedRoute menuKey="org">
                                            <OrgSettings />
                                        </ProtectedRoute>
                                    } />
                                    <Route path="/api-keys" element={
                                        <ProtectedRoute menuKey="api-keys">
                                            <ApiKeys />
                                        </ProtectedRoute>
                                    } />
                                    <Route path="/config" element={
                                        <ProtectedRoute menuKey="config">
                                            <AdminConfig />
                                        </ProtectedRoute>
                                    } />
                                    <Route path="/monitor" element={
                                        <ProtectedRoute menuKey="monitor">
                                            <SystemMonitor />
                                        </ProtectedRoute>
                                    } />
                                    <Route path="/manage-users" element={
                                        <ProtectedRoute menuKey="manage-users">
                                            <ManageUsers />
                                        </ProtectedRoute>
                                    } />
                                    <Route path="/manage-roles" element={
                                        <ProtectedRoute menuKey="manage-roles">
                                            <ManageRoles />
                                        </ProtectedRoute>
                                    } />
                                    <Route path="/activity-log" element={
                                        <ProtectedRoute menuKey="activity-log">
                                            <ActivityLog />
                                        </ProtectedRoute>
                                    } />
                                </Routes>
                            </Layout>
                        </ProtectedRoute>
                    } />
                </Routes>
            </BrowserRouter>
        </AuthProvider>
    );
}