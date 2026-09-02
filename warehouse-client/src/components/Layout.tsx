import React from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LayoutDashboard, Building2, PackageSearch, BarChart3, LogOut } from 'lucide-react';

const NAV_ITEMS = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/companies', label: 'Companies', icon: Building2 },
    { to: '/box-events', label: 'Box Events', icon: PackageSearch },
    { to: '/reports', label: 'Reports', icon: BarChart3 },
];

const Layout: React.FC = () => {
    const { user, logout } = useAuth();
    const navigate = useNavigate();

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    return (
        <div className="flex h-screen bg-slate-50">
            <aside className="w-64 bg-white border-r border-slate-200 flex flex-col">
                <div className="p-4 border-b border-slate-200">
                    <h1 className="font-bold text-lg text-slate-800">DOK Warehouse</h1>
                </div>
                <nav className="flex-1 p-3 space-y-1">
                    {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
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
                <div className="p-3 border-t border-slate-200">
                    <div className="text-sm text-slate-500 mb-2">{user?.NAME}</div>
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
        </div>
    );
};

export default Layout;
