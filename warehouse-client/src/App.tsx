import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Companies from './pages/Companies';
import CompanyDetail from './pages/CompanyDetail';
import Warehouses from './pages/Warehouses';
import BoxEvents from './pages/BoxEvents';
import Reports from './pages/Reports';
import Users from './pages/Users';

const LoadingScreen = () => (
    <div className="flex items-center justify-center h-screen">
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
    </div>
);

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { isAuthenticated, isLoading } = useAuth();
    if (isLoading) return <LoadingScreen />;
    if (!isAuthenticated) return <Navigate to="/login" replace />;
    return <>{children}</>;
};

function AppRoutes() {
    return (
        <Router>
            <Routes>
                <Route path="/login" element={<Login />} />
                <Route
                    path="/"
                    element={
                        <ProtectedRoute>
                            <Layout />
                        </ProtectedRoute>
                    }
                >
                    <Route index element={<Dashboard />} />
                    <Route path="companies" element={<Companies />} />
                    <Route path="companies/:id" element={<CompanyDetail />} />
                    <Route path="warehouses" element={<Warehouses />} />
                    <Route path="box-events" element={<BoxEvents />} />
                    <Route path="reports" element={<Reports />} />
                    <Route path="users" element={<Users />} />
                </Route>
            </Routes>
        </Router>
    );
}

function App() {
    return (
        <AuthProvider>
            <AppRoutes />
            <Toaster position="top-right" />
        </AuthProvider>
    );
}

export default App;
