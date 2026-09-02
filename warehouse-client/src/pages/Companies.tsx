import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../services/api';
import type { Company } from '../types';

const Companies: React.FC = () => {
    const [companies, setCompanies] = useState<Company[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [name, setName] = useState('');
    const [code, setCode] = useState('');

    const load = () => {
        setLoading(true);
        api.get<Company[]>('/companies').then((res) => setCompanies(res.data)).finally(() => setLoading(false));
    };

    useEffect(load, []);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await api.post('/companies', { name, code: code || undefined });
            toast.success('Company created');
            setName('');
            setCode('');
            setShowForm(false);
            load();
        } catch {
            toast.error('Failed to create company');
        }
    };

    if (loading) return <div>Loading...</div>;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-slate-800">Companies</h1>
                <button
                    onClick={() => setShowForm(!showForm)}
                    className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700"
                >
                    {showForm ? 'Cancel' : 'New Company'}
                </button>
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
                            <th className="p-3">Departments</th>
                            <th className="p-3">Total Boxes</th>
                        </tr>
                    </thead>
                    <tbody>
                        {companies.map((c) => (
                            <tr key={c.ID} className="border-t border-slate-100 hover:bg-slate-50">
                                <td className="p-3">
                                    <Link to={`/companies/${c.ID}`} className="text-blue-600 font-medium">{c.NAME}</Link>
                                </td>
                                <td className="p-3">{c.CODE}</td>
                                <td className="p-3">{c.DEPARTMENT_COUNT}</td>
                                <td className="p-3">{c.TOTAL_BOX_COUNT}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default Companies;
