import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import type { LoginResponse } from '../types';
import { Button } from '../components/ui';

const Login: React.FC = () => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const { login } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            const res = await api.post<LoginResponse>('/auth/login', { username, password });
            login(res.data);
            navigate('/');
        } catch (err) {
            toast.error('Invalid username or password');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex h-screen">
            <div className="hidden md:flex md:w-1/2 bg-gradient-to-br from-brand-600 to-brand-400 text-white flex-col justify-center px-16">
                <div className="w-12 h-12 rounded-xl bg-white/20 mb-6" />
                <h1 className="text-3xl font-extrabold mb-3">DOK Warehouse</h1>
                <p className="text-sm text-white/85 max-w-sm">Document archiving &amp; warehouse management, simplified.</p>
            </div>
            <div className="flex-1 flex items-center justify-center bg-slate-50 px-6">
                <form onSubmit={handleSubmit} className="bg-white p-8 rounded-card shadow-soft w-full max-w-sm">
                    <h2 className="text-xl font-bold text-slate-800 mb-1">Welcome back</h2>
                    <p className="text-sm text-slate-400 mb-6">Sign in to your account</p>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Username</label>
                    <input
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-4"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        required
                    />
                    <label className="block text-sm font-medium text-slate-600 mb-1">Password</label>
                    <input
                        type="password"
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-6"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                    />
                    <Button type="submit" variant="primary" disabled={loading} className="w-full">
                        {loading ? 'Signing in...' : 'Sign in'}
                    </Button>
                </form>
            </div>
        </div>
    );
};

export default Login;
