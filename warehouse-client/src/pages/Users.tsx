import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import type { AppUser, PermissionKey, UserRole, Warehouse } from '../types';

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
    { value: 'system_admin', label: 'System Admin' },
    { value: 'warehouse_admin', label: 'Warehouse Admin' },
    { value: 'finance_officer', label: 'Finance Officer' },
];

const PERMISSION_LABELS: { key: PermissionKey; label: string }[] = [
    { key: 'manage_companies', label: 'Manage Companies' },
    { key: 'manage_warehouses', label: 'Manage Warehouses' },
    { key: 'manage_box_events', label: 'Manage Box Events' },
    { key: 'view_invoices', label: 'View Invoices' },
    { key: 'manage_invoices', label: 'Manage Invoices' },
    { key: 'manage_users', label: 'Manage Users' },
];

type OverrideState = 'default' | 'allow' | 'deny';

const Users: React.FC = () => {
    const { user } = useAuth();
    const isAdmin = user?.EFFECTIVE_PERMISSIONS?.includes('manage_users') ?? false;

    const [users, setUsers] = useState<AppUser[]>([]);
    const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
    const [loading, setLoading] = useState(isAdmin);
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [username, setUsername] = useState('');
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const [role, setRole] = useState<UserRole>('warehouse_admin');
    const [warehouseIds, setWarehouseIds] = useState<number[]>([]);

    const [editingId, setEditingId] = useState<number | null>(null);
    const [editName, setEditName] = useState('');
    const [editRole, setEditRole] = useState<UserRole>('warehouse_admin');
    const [editStatus, setEditStatus] = useState<'active' | 'inactive'>('active');
    const [editPassword, setEditPassword] = useState('');
    const [editWarehouseIds, setEditWarehouseIds] = useState<number[]>([]);
    const [editOverrides, setEditOverrides] = useState<Record<PermissionKey, OverrideState>>(
        {} as Record<PermissionKey, OverrideState>
    );

    const load = () => {
        setLoading(true);
        Promise.all([
            api.get<AppUser[]>('/users'),
            api.get<Warehouse[]>('/warehouses'),
        ]).then(([usersRes, warehousesRes]) => {
            setUsers(usersRes.data);
            setWarehouses(warehousesRes.data);
        }).finally(() => setLoading(false));
    };

    useEffect(() => {
        if (isAdmin) load();
    }, [isAdmin]);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await api.post('/users', {
                username, name, password, role,
                warehouse_ids: role === 'warehouse_admin' ? warehouseIds : undefined,
            });
            toast.success('User created');
            setUsername('');
            setName('');
            setPassword('');
            setRole('warehouse_admin');
            setWarehouseIds([]);
            setShowCreateForm(false);
            load();
        } catch (err: any) {
            toast.error(err?.response?.data?.message || 'Failed to create user');
        }
    };

    const startEdit = async (u: AppUser) => {
        setEditingId(u.ID);
        setEditName(u.NAME);
        setEditRole(u.ROLE);
        setEditStatus(u.STATUS);
        setEditPassword('');
        setEditWarehouseIds(u.WAREHOUSE_IDS || []);

        const detail = await api.get<AppUser>(`/users/${u.ID}`);
        const overrideMap = {} as Record<PermissionKey, OverrideState>;
        for (const { key } of PERMISSION_LABELS) overrideMap[key] = 'default';
        for (const o of detail.data.PERMISSION_OVERRIDES || []) {
            overrideMap[o.PERMISSION_KEY] = o.GRANTED ? 'allow' : 'deny';
        }
        setEditOverrides(overrideMap);
    };

    const cancelEdit = () => setEditingId(null);

    const toggleEditWarehouse = (id: number) => {
        setEditWarehouseIds((prev) => (prev.includes(id) ? prev.filter((w) => w !== id) : [...prev, id]));
    };

    const saveEdit = async (id: number) => {
        try {
            const permission_overrides = (Object.keys(editOverrides) as PermissionKey[])
                .filter((key) => editOverrides[key] !== 'default')
                .map((key) => ({ permission_key: key, granted: editOverrides[key] === 'allow' }));

            await api.put(`/users/${id}`, {
                name: editName,
                role: editRole,
                status: editStatus,
                password: editPassword || undefined,
                warehouse_ids: editRole === 'warehouse_admin' ? editWarehouseIds : [],
                permission_overrides,
            });
            toast.success('User updated');
            setEditingId(null);
            load();
        } catch (err: any) {
            toast.error(err?.response?.data?.message || 'Failed to update user');
        }
    };

    if (!isAdmin) return <div className="text-slate-500">You don't have access to this page.</div>;
    if (loading) return <div>Loading...</div>;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-slate-800">Users</h1>
                <button
                    onClick={() => setShowCreateForm(!showCreateForm)}
                    className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700"
                >
                    {showCreateForm ? 'Cancel' : 'New User'}
                </button>
            </div>

            {showCreateForm && (
                <form onSubmit={handleCreate} className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap gap-3 items-end">
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">Username</label>
                        <input className="border border-slate-300 rounded-lg px-3 py-2" value={username} onChange={(e) => setUsername(e.target.value)} required />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">Name</label>
                        <input className="border border-slate-300 rounded-lg px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} required />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">Password</label>
                        <input type="password" className="border border-slate-300 rounded-lg px-3 py-2" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">Role</label>
                        <select className="border border-slate-300 rounded-lg px-3 py-2" value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
                            {ROLE_OPTIONS.map((r) => (
                                <option key={r.value} value={r.value}>{r.label}</option>
                            ))}
                        </select>
                    </div>
                    {role === 'warehouse_admin' && (
                        <div>
                            <label className="block text-sm font-medium text-slate-600 mb-1">Warehouses</label>
                            <select
                                multiple
                                className="border border-slate-300 rounded-lg px-3 py-2 h-20"
                                value={warehouseIds.map(String)}
                                onChange={(e) => setWarehouseIds(Array.from(e.target.selectedOptions).map((o) => Number(o.value)))}
                            >
                                {warehouses.map((w) => (
                                    <option key={w.ID} value={w.ID}>{w.NAME}</option>
                                ))}
                            </select>
                        </div>
                    )}
                    <button type="submit" className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700">
                        Save
                    </button>
                </form>
            )}

            <div className="bg-white rounded-xl border border-slate-200">
                <table className="w-full text-sm">
                    <thead className="text-left text-slate-500">
                        <tr>
                            <th className="p-3">Username</th>
                            <th className="p-3">Name</th>
                            <th className="p-3">Role</th>
                            <th className="p-3">Warehouses</th>
                            <th className="p-3">Status</th>
                            <th className="p-3">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {users.map((u) =>
                            editingId === u.ID ? (
                                <tr key={u.ID} className="border-t border-slate-100 bg-slate-50 align-top">
                                    <td className="p-3">{u.USERNAME}</td>
                                    <td className="p-2">
                                        <input className="border border-slate-300 rounded px-2 py-1 w-full" value={editName} onChange={(e) => setEditName(e.target.value)} />
                                    </td>
                                    <td className="p-2">
                                        <select className="border border-slate-300 rounded px-2 py-1" value={editRole} onChange={(e) => setEditRole(e.target.value as UserRole)}>
                                            {ROLE_OPTIONS.map((r) => (
                                                <option key={r.value} value={r.value}>{r.label}</option>
                                            ))}
                                        </select>
                                    </td>
                                    <td className="p-2">
                                        {editRole === 'warehouse_admin' ? (
                                            <div className="flex flex-col gap-1">
                                                {warehouses.map((w) => (
                                                    <label key={w.ID} className="flex items-center gap-1 text-xs">
                                                        <input
                                                            type="checkbox"
                                                            checked={editWarehouseIds.includes(w.ID)}
                                                            onChange={() => toggleEditWarehouse(w.ID)}
                                                        />
                                                        {w.NAME}
                                                    </label>
                                                ))}
                                            </div>
                                        ) : (
                                            <span className="text-xs text-slate-400">All</span>
                                        )}
                                    </td>
                                    <td className="p-2">
                                        <select className="border border-slate-300 rounded px-2 py-1" value={editStatus} onChange={(e) => setEditStatus(e.target.value as 'active' | 'inactive')}>
                                            <option value="active">Active</option>
                                            <option value="inactive">Inactive</option>
                                        </select>
                                    </td>
                                    <td className="p-2">
                                        <div className="flex flex-col gap-2">
                                            <input type="password" placeholder="New password (optional)" className="border border-slate-300 rounded px-2 py-1 text-xs" value={editPassword} onChange={(e) => setEditPassword(e.target.value)} minLength={6} />
                                            <div className="flex gap-2">
                                                <button onClick={() => saveEdit(u.ID)} className="text-green-600 hover:text-green-700 text-xs font-medium">Save</button>
                                                <button onClick={cancelEdit} className="text-slate-400 hover:text-slate-600 text-xs font-medium">Cancel</button>
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                <tr key={u.ID} className="border-t border-slate-100">
                                    <td className="p-3">{u.USERNAME}</td>
                                    <td className="p-3">{u.NAME}</td>
                                    <td className="p-3">{ROLE_OPTIONS.find((r) => r.value === u.ROLE)?.label ?? u.ROLE}</td>
                                    <td className="p-3">{(u.WAREHOUSE_IDS || []).map((id) => warehouses.find((w) => w.ID === id)?.NAME || id).join(', ')}</td>
                                    <td className="p-3 capitalize">{u.STATUS}</td>
                                    <td className="p-3">
                                        <button onClick={() => startEdit(u)} className="text-blue-600 hover:text-blue-700 text-xs font-medium">Edit</button>
                                    </td>
                                </tr>
                            )
                        )}
                    </tbody>
                </table>
            </div>

            {editingId !== null && (
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                    <h2 className="text-sm font-semibold text-slate-700 mb-3">Permission Overrides</h2>
                    <table className="w-full text-sm">
                        <thead className="text-left text-slate-500">
                            <tr>
                                <th className="p-2">Permission</th>
                                <th className="p-2">Default</th>
                                <th className="p-2">Always Allow</th>
                                <th className="p-2">Always Deny</th>
                            </tr>
                        </thead>
                        <tbody>
                            {PERMISSION_LABELS.map(({ key, label }) => (
                                <tr key={key} className="border-t border-slate-100">
                                    <td className="p-2">{label}</td>
                                    {(['default', 'allow', 'deny'] as OverrideState[]).map((state) => (
                                        <td key={state} className="p-2">
                                            <input
                                                type="radio"
                                                name={`override-${key}`}
                                                checked={(editOverrides[key] || 'default') === state}
                                                onChange={() => setEditOverrides((prev) => ({ ...prev, [key]: state }))}
                                            />
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

export default Users;
