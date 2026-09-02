import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import type { LoginResponse } from '../types';

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
        <div className="flex items-center justify-center h-screen bg-slate-50">
            <form onSubmit={handleSubmit} className="bg-white p-8 rounded-xl shadow-sm border border-slate-200 w-80">
                <h1 className="text-xl font-bold text-slate-800 mb-6">DOK Warehouse Login</h1>
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
                <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-blue-600 text-white rounded-lg py-2 font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                    {loading ? 'Signing in...' : 'Sign in'}
                </button>
            </form>
        </div>
    );
};

export default Login;
