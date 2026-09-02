import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import type { AppUser } from '../types';

const Users: React.FC = () => {
    const { user } = useAuth();
    const isAdmin = user?.ROLE === 'admin';

    const [users, setUsers] = useState<AppUser[]>([]);
    const [loading, setLoading] = useState(isAdmin);
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [username, setUsername] = useState('');
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const [role, setRole] = useState<'admin' | 'staff'>('staff');

    const [editingId, setEditingId] = useState<number | null>(null);
    const [editName, setEditName] = useState('');
    const [editRole, setEditRole] = useState<'admin' | 'staff'>('staff');
    const [editStatus, setEditStatus] = useState<'active' | 'inactive'>('active');
    const [editPassword, setEditPassword] = useState('');

    const load = () => {
        setLoading(true);
        api.get<AppUser[]>('/users').then((res) => setUsers(res.data)).finally(() => setLoading(false));
    };

    useEffect(() => {
        if (isAdmin) load();
    }, [isAdmin]);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await api.post('/users', { username, name, password, role });
            toast.success('User created');
            setUsername('');
            setName('');
            setPassword('');
            setRole('staff');
            setShowCreateForm(false);
            load();
        } catch (err: any) {
            toast.error(err?.response?.data?.message || 'Failed to create user');
        }
    };

    const startEdit = (u: AppUser) => {
        setEditingId(u.ID);
        setEditName(u.NAME);
        setEditRole(u.ROLE);
        setEditStatus(u.STATUS);
        setEditPassword('');
    };

    const cancelEdit = () => setEditingId(null);

    const saveEdit = async (id: number) => {
        try {
            await api.put(`/users/${id}`, {
                name: editName,
                role: editRole,
                status: editStatus,
                password: editPassword || undefined,
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
                <form onSubmit={handleCreate} className="bg-white rounded-xl border border-slate-200 p-4 flex gap-3 items-end">
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
                        <select className="border border-slate-300 rounded-lg px-3 py-2" value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'staff')}>
                            <option value="staff">Staff</option>
                            <option value="admin">Admin</option>
                        </select>
                    </div>
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
                            <th className="p-3">Status</th>
                            <th className="p-3">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {users.map((u) =>
                            editingId === u.ID ? (
                                <tr key={u.ID} className="border-t border-slate-100 bg-slate-50">
                                    <td className="p-3">{u.USERNAME}</td>
                                    <td className="p-2">
                                        <input className="border border-slate-300 rounded px-2 py-1 w-full" value={editName} onChange={(e) => setEditName(e.target.value)} />
                                    </td>
                                    <td className="p-2">
                                        <select className="border border-slate-300 rounded px-2 py-1" value={editRole} onChange={(e) => setEditRole(e.target.value as 'admin' | 'staff')}>
                                            <option value="staff">Staff</option>
                                            <option value="admin">Admin</option>
                                        </select>
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
                                    <td className="p-3 capitalize">{u.ROLE}</td>
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
        </div>
    );
};

export default Users;
