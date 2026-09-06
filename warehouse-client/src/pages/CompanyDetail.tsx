import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Pencil, Check, X } from 'lucide-react';
import api from '../services/api';
import type { Company, Warehouse, Department } from '../types';

const CompanyDetail: React.FC = () => {
    const { id } = useParams();
    const [company, setCompany] = useState<Company | null>(null);
    const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [deptName, setDeptName] = useState('');
    const [deptCode, setDeptCode] = useState('');
    const [deptWarehouseId, setDeptWarehouseId] = useState('');

    const [editingDeptId, setEditingDeptId] = useState<number | null>(null);
    const [editArchivedPrice, setEditArchivedPrice] = useState('');
    const [editRetrievedPrice, setEditRetrievedPrice] = useState('');
    const [editEmptyCartonPrice, setEditEmptyCartonPrice] = useState('');
    const [editStoredMonthlyPrice, setEditStoredMonthlyPrice] = useState('');

    const load = () => {
        setLoading(true);
        Promise.all([
            api.get<Company>(`/companies/${id}`),
            api.get<Warehouse[]>('/warehouses'),
        ]).then(([companyRes, warehousesRes]) => {
            setCompany(companyRes.data);
            setWarehouses(warehousesRes.data);
        }).finally(() => setLoading(false));
    };

    useEffect(load, [id]);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await api.post('/departments', {
                company_id: Number(id),
                warehouse_id: Number(deptWarehouseId),
                name: deptName,
                code: deptCode || undefined,
            });
            toast.success('Department created');
            setDeptName('');
            setDeptCode('');
            setDeptWarehouseId('');
            setShowForm(false);
            load();
        } catch (err: any) {
            toast.error(err?.response?.data?.message || 'Failed to create department');
        }
    };

    const startEditDept = (d: Department) => {
        setEditingDeptId(d.ID);
        setEditArchivedPrice(String(d.PRICE_PER_ARCHIVED_BOX ?? 0));
        setEditRetrievedPrice(String(d.PRICE_PER_RETRIEVED_BOX ?? 0));
        setEditEmptyCartonPrice(String(d.PRICE_PER_EMPTY_CARTON ?? 0));
        setEditStoredMonthlyPrice(String(d.PRICE_PER_BOX_STORED_MONTHLY ?? 0));
    };

    const cancelEditDept = () => setEditingDeptId(null);

    const saveEditDept = async (deptId: number) => {
        try {
            const body: Record<string, number> = {};
            if (editArchivedPrice !== '') body.price_per_archived_box = Number(editArchivedPrice);
            if (editRetrievedPrice !== '') body.price_per_retrieved_box = Number(editRetrievedPrice);
            if (editEmptyCartonPrice !== '') body.price_per_empty_carton = Number(editEmptyCartonPrice);
            if (editStoredMonthlyPrice !== '') body.price_per_box_stored_monthly = Number(editStoredMonthlyPrice);
            await api.put(`/departments/${deptId}`, body);
            toast.success('Pricing updated');
            setEditingDeptId(null);
            load();
        } catch (err: any) {
            toast.error(err?.response?.data?.message || 'Failed to update pricing');
        }
    };

    if (loading || !company) return <div>Loading...</div>;

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-bold text-slate-800">{company.NAME}</h1>
            <div className="text-sm text-slate-500">{company.CODE}</div>

            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-700">Departments</h2>
                <button
                    onClick={() => setShowForm(!showForm)}
                    className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700"
                >
                    {showForm ? 'Cancel' : 'New Department'}
                </button>
            </div>

            {showForm && (
                <form onSubmit={handleCreate} className="bg-white rounded-xl border border-slate-200 p-4 flex gap-3 items-end">
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">Name</label>
                        <input className="border border-slate-300 rounded-lg px-3 py-2" value={deptName} onChange={(e) => setDeptName(e.target.value)} required />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">Code</label>
                        <input className="border border-slate-300 rounded-lg px-3 py-2" value={deptCode} onChange={(e) => setDeptCode(e.target.value)} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">Warehouse</label>
                        <select className="border border-slate-300 rounded-lg px-3 py-2" value={deptWarehouseId} onChange={(e) => setDeptWarehouseId(e.target.value)} required>
                            <option value="">Select...</option>
                            {warehouses.map((w) => (
                                <option key={w.ID} value={w.ID}>{w.NAME}</option>
                            ))}
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
                            <th className="p-3">Name</th>
                            <th className="p-3">Code</th>
                            <th className="p-3">Warehouse</th>
                            <th className="p-3">Current Box Count</th>
                            <th className="p-3">Price/Archived</th>
                            <th className="p-3">Price/Retrieved</th>
                            <th className="p-3">Price/Empty Carton</th>
                            <th className="p-3">Price/Storage Rental (monthly)</th>
                            <th className="p-3">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {(company.DEPARTMENTS || []).map((d) =>
                            editingDeptId === d.ID ? (
                                <tr key={d.ID} className="border-t border-slate-100 bg-slate-50">
                                    <td className="p-3">{d.NAME}</td>
                                    <td className="p-3">{d.CODE}</td>
                                    <td className="p-3">{d.WAREHOUSE_NAME}</td>
                                    <td className="p-3">{d.CURRENT_BOX_COUNT}</td>
                                    <td className="p-2">
                                        <input type="number" min="0" step="0.01" className="border border-slate-300 rounded px-2 py-1 w-24" value={editArchivedPrice} onChange={(e) => setEditArchivedPrice(e.target.value)} />
                                    </td>
                                    <td className="p-2">
                                        <input type="number" min="0" step="0.01" className="border border-slate-300 rounded px-2 py-1 w-24" value={editRetrievedPrice} onChange={(e) => setEditRetrievedPrice(e.target.value)} />
                                    </td>
                                    <td className="p-2">
                                        <input type="number" min="0" step="0.01" className="border border-slate-300 rounded px-2 py-1 w-24" value={editEmptyCartonPrice} onChange={(e) => setEditEmptyCartonPrice(e.target.value)} />
                                    </td>
                                    <td className="p-2">
                                        <input type="number" min="0" step="0.01" className="border border-slate-300 rounded px-2 py-1 w-24" value={editStoredMonthlyPrice} onChange={(e) => setEditStoredMonthlyPrice(e.target.value)} />
                                    </td>
                                    <td className="p-2">
                                        <div className="flex gap-2">
                                            <button onClick={() => saveEditDept(d.ID)} className="text-green-600 hover:text-green-700" title="Save"><Check size={16} /></button>
                                            <button onClick={cancelEditDept} className="text-slate-400 hover:text-slate-600" title="Cancel"><X size={16} /></button>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                <tr key={d.ID} className="border-t border-slate-100">
                                    <td className="p-3">{d.NAME}</td>
                                    <td className="p-3">{d.CODE}</td>
                                    <td className="p-3">{d.WAREHOUSE_NAME}</td>
                                    <td className="p-3">{d.CURRENT_BOX_COUNT}</td>
                                    <td className="p-3">{d.PRICE_PER_ARCHIVED_BOX}</td>
                                    <td className="p-3">{d.PRICE_PER_RETRIEVED_BOX}</td>
                                    <td className="p-3">{d.PRICE_PER_EMPTY_CARTON}</td>
                                    <td className="p-3">{d.PRICE_PER_BOX_STORED_MONTHLY}</td>
                                    <td className="p-3">
                                        <button onClick={() => startEditDept(d)} className="text-slate-500 hover:text-blue-600" title="Edit"><Pencil size={16} /></button>
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

export default CompanyDetail;
