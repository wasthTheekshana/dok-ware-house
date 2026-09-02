import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import type { Warehouse } from '../types';

const Warehouses: React.FC = () => {
    const { user } = useAuth();
    const isAdmin = user?.ROLE === 'admin';

    const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [name, setName] = useState('');
    const [code, setCode] = useState('');
    const [address, setAddress] = useState('');

    const load = () => {
        setLoading(true);
        api.get<Warehouse[]>('/warehouses').then((res) => setWarehouses(res.data)).finally(() => setLoading(false));
    };

    useEffect(load, []);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await api.post('/warehouses', { name, code: code || undefined, address: address || undefined });
            toast.success('Warehouse created');
            setName('');
            setCode('');
            setAddress('');
            setShowForm(false);
            load();
        } catch {
            toast.error('Failed to create warehouse');
        }
    };

    if (loading) return <div>Loading...</div>;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-slate-800">Warehouses</h1>
                {isAdmin && (
                    <button
                        onClick={() => setShowForm(!showForm)}
                        className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700"
                    >
                        {showForm ? 'Cancel' : 'New Warehouse'}
                    </button>
                )}
            </div>

            {showForm && (
                <form onSubmit={handleCreate} className="bg-white rounded-xl border border-slate-200 p-4 flex gap-3 items-end">
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">Name</label>
                        <input className="border border-slate-300 rounded-lg px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} required />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">Code</label>
                        <input className="border border-slate-300 rounded-lg px-3 py-2" value={code} onChange={(e) => setCode(e.target.value)} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">Address</label>
                        <input className="border border-slate-300 rounded-lg px-3 py-2" value={address} onChange={(e) => setAddress(e.target.value)} />
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
                            <th className="p-3">Name</th>
                            <th className="p-3">Code</th>
                            <th className="p-3">Address</th>
                            <th className="p-3">Departments</th>
                            <th className="p-3">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {warehouses.map((w) => (
                            <tr key={w.ID} className="border-t border-slate-100">
                                <td className="p-3 font-medium">{w.NAME}</td>
                                <td className="p-3">{w.CODE}</td>
                                <td className="p-3">{w.ADDRESS}</td>
                                <td className="p-3">{w.DEPARTMENT_COUNT}</td>
                                <td className="p-3 capitalize">{w.STATUS}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default Warehouses;
