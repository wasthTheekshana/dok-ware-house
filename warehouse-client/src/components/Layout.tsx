import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { LayoutDashboard, Building2, Warehouse, PackageSearch, BarChart3, Users, Receipt, LogOut, KeyRound } from 'lucide-react';

const NAV_ITEMS = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/companies', label: 'Companies', icon: Building2 },
    { to: '/warehouses', label: 'Warehouses', icon: Warehouse },
    { to: '/box-events', label: 'Box Events', icon: PackageSearch },
    { to: '/reports', label: 'Reports', icon: BarChart3 },
];

const ADMIN_NAV_ITEMS = [
    { to: '/users', label: 'Users', icon: Users },
    { to: '/invoices', label: 'Invoices', icon: Receipt },
];

const Layout: React.FC = () => {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const isAdmin = user?.ROLE === 'admin';
    const navItems = isAdmin ? [...NAV_ITEMS, ...ADMIN_NAV_ITEMS] : NAV_ITEMS;

    const [showChangePassword, setShowChangePassword] = useState(false);
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    const handleChangePassword = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            await api.post('/users/me/change-password', { current_password: currentPassword, new_password: newPassword });
            toast.success('Password changed');
            setCurrentPassword('');
            setNewPassword('');
            setShowChangePassword(false);
        } catch (err: any) {
            toast.error(err?.response?.data?.message || 'Failed to change password');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="flex h-screen bg-slate-50">
            <aside className="w-64 bg-white border-r border-slate-200 flex flex-col">
                <div className="p-4 border-b border-slate-200">
                    <h1 className="font-bold text-lg text-slate-800">DOK Warehouse</h1>
                </div>
                <nav className="flex-1 p-3 space-y-1">
                    {navItems.map(({ to, label, icon: Icon }) => (
                        <NavLink
                            key={to}
                            to={to}
                            end={to === '/'}
                            className={({ isActive }) =>
                                `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium ${
                                    isActive ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                                }`
                            }
                        >
                            <Icon size={18} />
                            {label}
                        </NavLink>
                    ))}
                </nav>
                <div className="p-3 border-t border-slate-200 space-y-1">
                    <div className="text-sm text-slate-500 mb-2">{user?.NAME}</div>
                    <button
                        onClick={() => setShowChangePassword(true)}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 w-full"
                    >
                        <KeyRound size={18} />
                        Change Password
                    </button>
                    <button
                        onClick={handleLogout}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 w-full"
                    >
                        <LogOut size={18} />
                        Logout
                    </button>
                </div>
            </aside>
            <main className="flex-1 overflow-auto p-6">
                <Outlet />
            </main>

            {showChangePassword && (
                <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
                    <form onSubmit={handleChangePassword} className="bg-white rounded-xl border border-slate-200 p-6 w-80 space-y-3">
                        <h2 className="text-lg font-semibold text-slate-800">Change Password</h2>
                        <div>
                            <label className="block text-sm font-medium text-slate-600 mb-1">Current Password</label>
                            <input type="password" className="border border-slate-300 rounded-lg px-3 py-2 w-full" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-600 mb-1">New Password</label>
                            <input type="password" className="border border-slate-300 rounded-lg px-3 py-2 w-full" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={6} />
                        </div>
                        <div className="flex gap-2 justify-end">
                            <button type="button" onClick={() => setShowChangePassword(false)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
                            <button type="submit" disabled={submitting} className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                                {submitting ? 'Saving...' : 'Save'}
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
};

export default Layout;
