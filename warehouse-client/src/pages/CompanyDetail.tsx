import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Pencil, Check, X } from 'lucide-react';
import api from '../services/api';
import type { Company, Warehouse, Department } from '../types';
import { PageHeader, Card, Table, Td, Tr, Button } from '../components/ui';

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
            <PageHeader
                title={company.NAME}
                subtitle={company.CODE ?? undefined}
                action={
                    <Button onClick={() => setShowForm(!showForm)}>
                        {showForm ? 'Cancel' : 'New Department'}
                    </Button>
                }
            />

            {showForm && (
                <Card>
                    <form onSubmit={handleCreate} className="flex gap-3 items-end">
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
                        <Button type="submit">Save</Button>
                    </form>
                </Card>
            )}

            <Table
                headers={['Name', 'Code', 'Warehouse', 'Current Box Count', 'Price/Archived', 'Price/Retrieved', 'Price/Empty Carton', 'Price/Storage Rental (monthly)', 'Actions']}
                empty={(company.DEPARTMENTS || []).length === 0}
            >
                {(company.DEPARTMENTS || []).map((d) =>
                    editingDeptId === d.ID ? (
                        <Tr key={d.ID} className="bg-slate-50">
                            <Td>{d.NAME}</Td>
                            <Td>{d.CODE}</Td>
                            <Td>{d.WAREHOUSE_NAME}</Td>
                            <Td>{d.CURRENT_BOX_COUNT}</Td>
                            <Td className="p-2">
                                <input type="number" min="0" step="0.01" className="border border-slate-300 rounded px-2 py-1 w-24" value={editArchivedPrice} onChange={(e) => setEditArchivedPrice(e.target.value)} />
                            </Td>
                            <Td className="p-2">
                                <input type="number" min="0" step="0.01" className="border border-slate-300 rounded px-2 py-1 w-24" value={editRetrievedPrice} onChange={(e) => setEditRetrievedPrice(e.target.value)} />
                            </Td>
                            <Td className="p-2">
                                <input type="number" min="0" step="0.01" className="border border-slate-300 rounded px-2 py-1 w-24" value={editEmptyCartonPrice} onChange={(e) => setEditEmptyCartonPrice(e.target.value)} />
                            </Td>
                            <Td className="p-2">
                                <input type="number" min="0" step="0.01" className="border border-slate-300 rounded px-2 py-1 w-24" value={editStoredMonthlyPrice} onChange={(e) => setEditStoredMonthlyPrice(e.target.value)} />
                            </Td>
                            <Td className="p-2">
                                <div className="flex gap-2">
                                    <button onClick={() => saveEditDept(d.ID)} className="text-green-600 hover:text-green-700" title="Save"><Check size={16} /></button>
                                    <button onClick={cancelEditDept} className="text-slate-400 hover:text-slate-600" title="Cancel"><X size={16} /></button>
                                </div>
                            </Td>
                        </Tr>
                    ) : (
                        <Tr key={d.ID}>
                            <Td>{d.NAME}</Td>
                            <Td>{d.CODE}</Td>
                            <Td>{d.WAREHOUSE_NAME}</Td>
                            <Td>{d.CURRENT_BOX_COUNT}</Td>
                            <Td>{d.PRICE_PER_ARCHIVED_BOX}</Td>
                            <Td>{d.PRICE_PER_RETRIEVED_BOX}</Td>
                            <Td>{d.PRICE_PER_EMPTY_CARTON}</Td>
                            <Td>{d.PRICE_PER_BOX_STORED_MONTHLY}</Td>
                            <Td>
                                <button onClick={() => startEditDept(d)} className="text-slate-500 hover:text-brand-600" title="Edit"><Pencil size={16} /></button>
                            </Td>
                        </Tr>
                    )
                )}
            </Table>
        </div>
    );
};

export default CompanyDetail;
