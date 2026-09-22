import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { LayoutDashboard, Building2, Warehouse, PackageSearch, BarChart3, Users, Receipt, Wallet, Contact, ClipboardCheck, Banknote, LogOut, KeyRound, Menu, X } from 'lucide-react';
import { Button } from './ui';

const NAV_ITEMS = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/companies', label: 'Companies', icon: Building2 },
    { to: '/warehouses', label: 'Warehouses', icon: Warehouse },
    { to: '/box-events', label: 'Box Events', icon: PackageSearch },
    { to: '/reports', label: 'Reports', icon: BarChart3 },
];

const Layout: React.FC = () => {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const permissions = user?.EFFECTIVE_PERMISSIONS || [];
    const navItems = [
        ...NAV_ITEMS,
        ...(permissions.includes('manage_expenses') ? [{ to: '/expenses', label: 'Expenses', icon: Wallet }] : []),
        ...(permissions.includes('manage_staff') ? [{ to: '/staff', label: 'Staff', icon: Contact }] : []),
        ...(permissions.includes('manage_staff') ? [{ to: '/attendance', label: 'Attendance', icon: ClipboardCheck }] : []),
        ...(permissions.includes('manage_payroll') ? [{ to: '/payroll', label: 'Payroll', icon: Banknote }] : []),
        ...(permissions.includes('manage_users') ? [{ to: '/users', label: 'Users', icon: Users }] : []),
        ...(permissions.includes('view_invoices') ? [{ to: '/invoices', label: 'Invoices', icon: Receipt }] : []),
    ];

    const [showChangePassword, setShowChangePassword] = useState(false);
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(false);

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

    const sidebarContent = (
        <>
            <div className="flex items-center gap-2 px-4 py-4 border-b border-slate-100">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-brand-600 to-brand-400" />
                <h1 className="font-extrabold text-sm text-slate-800">DOK Warehouse</h1>
            </div>
            <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
                {navItems.map(({ to, label, icon: Icon }) => (
                    <NavLink
                        key={to}
                        to={to}
                        end={to === '/'}
                        onClick={() => setSidebarOpen(false)}
                        className={({ isActive }) =>
                            `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium ${
                                isActive ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                            }`
                        }
                    >
                        <Icon size={18} />
                        {label}
                    </NavLink>
                ))}
            </nav>
            <div className="p-3 border-t border-slate-100 space-y-1">
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide px-2 mb-2">{user?.NAME}</div>
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
        </>
    );

    return (
        <div className="flex h-screen bg-slate-50">
            <aside className="hidden lg:flex w-56 bg-white border-r border-slate-200 flex-col">
                {sidebarContent}
            </aside>

            <div
                className={`fixed inset-0 z-40 bg-black/30 transition-opacity lg:hidden ${sidebarOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
                onClick={() => setSidebarOpen(false)}
            />
            <aside
                className={`fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-slate-200 flex flex-col transition-transform lg:hidden ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
            >
                <div className="flex justify-end p-2">
                    <button onClick={() => setSidebarOpen(false)} className="p-2 text-slate-400 hover:text-slate-600">
                        <X size={20} />
                    </button>
                </div>
                {sidebarContent}
            </aside>

            <div className="flex-1 flex flex-col overflow-hidden">
                <div className="lg:hidden flex items-center gap-3 bg-white border-b border-slate-200 px-4 py-3">
                    <button onClick={() => setSidebarOpen(true)} className="text-slate-500 hover:text-slate-700">
                        <Menu size={22} />
                    </button>
                    <span className="font-bold text-sm text-slate-800">DOK Warehouse</span>
                </div>
                <main className="flex-1 overflow-auto p-4 lg:p-6">
                    <Outlet />
                </main>
            </div>

            {showChangePassword && (
                <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
                    <form onSubmit={handleChangePassword} className="bg-white rounded-card shadow-soft p-6 w-full max-w-xs space-y-3">
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
                            <Button type="button" variant="ghost" onClick={() => setShowChangePassword(false)}>Cancel</Button>
                            <Button type="submit" variant="primary" disabled={submitting}>
                                {submitting ? 'Saving...' : 'Save'}
                            </Button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
};

export default Layout;
