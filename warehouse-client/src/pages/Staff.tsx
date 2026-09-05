import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Pencil, Check, X } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import type { Warehouse, Staff as StaffMember } from '../types';

function todayISO(): string {
    return new Date().toISOString().slice(0, 10);
}

const Staff: React.FC = () => {
    const { user } = useAuth();
    const canManageStaff = user?.EFFECTIVE_PERMISSIONS?.includes('manage_staff') ?? false;
    const isScoped = user?.ROLE === 'warehouse_admin';
    const selectableWarehouseIds = user?.WAREHOUSE_IDS ?? [];

    const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
    const selectableWarehouses = isScoped
        ? warehouses.filter((w) => selectableWarehouseIds.includes(w.ID))
        : warehouses;
    const [staffList, setStaffList] = useState<StaffMember[]>([]);
    const [loading, setLoading] = useState(canManageStaff);

    const [showCreateForm, setShowCreateForm] = useState(false);
    const [formWarehouseId, setFormWarehouseId] = useState('');
    const [name, setName] = useState('');
    const [nic, setNic] = useState('');
    const [designation, setDesignation] = useState('');
    const [joinDate, setJoinDate] = useState(todayISO());
    const [basicSalary, setBasicSalary] = useState('');
    const [epfNo, setEpfNo] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const [editingId, setEditingId] = useState<number | null>(null);
    const [editName, setEditName] = useState('');
    const [editDesignation, setEditDesignation] = useState('');
    const [editBasicSalary, setEditBasicSalary] = useState('');
    const [editEpfNo, setEditEpfNo] = useState('');
    const [editStatus, setEditStatus] = useState<'active' | 'inactive'>('active');

    const loadStaff = () => {
        api.get<StaffMember[]>('/staff').then((res) => setStaffList(res.data));
    };

    useEffect(() => {
        if (!canManageStaff) return;
        Promise.all([
            api.get<Warehouse[]>('/warehouses'),
            api.get<StaffMember[]>('/staff'),
        ]).then(([warehousesRes, staffRes]) => {
            setWarehouses(warehousesRes.data);
            setStaffList(staffRes.data);
            if (isScoped) {
                const ownWarehouses = warehousesRes.data.filter((w) => selectableWarehouseIds.includes(w.ID));
                if (ownWarehouses.length === 1) {
                    setFormWarehouseId(String(ownWarehouses[0].ID));
                }
            }
        }).finally(() => setLoading(false));
    }, [canManageStaff, isScoped]);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            await api.post('/staff', {
                warehouse_id: Number(formWarehouseId),
                name, nic,
                designation: designation || undefined,
                join_date: joinDate,
                basic_salary: basicSalary ? Number(basicSalary) : undefined,
                epf_no: epfNo || undefined,
            });
            toast.success('Staff member added');
            setName(''); setNic(''); setDesignation(''); setBasicSalary(''); setEpfNo('');
            setShowCreateForm(false);
            loadStaff();
        } catch (err: any) {
            toast.error(err?.response?.data?.message || 'Failed to add staff member');
        } finally {
            setSubmitting(false);
        }
    };

    const startEdit = (s: StaffMember) => {
        setEditingId(s.ID);
        setEditName(s.NAME);
        setEditDesignation(s.DESIGNATION || '');
        setEditBasicSalary(String(s.BASIC_SALARY));
        setEditEpfNo(s.EPF_NO || '');
        setEditStatus(s.STATUS);
    };

    const cancelEdit = () => setEditingId(null);

    const saveEdit = async (id: number) => {
        try {
            await api.put(`/staff/${id}`, {
                name: editName,
                designation: editDesignation || undefined,
                basic_salary: editBasicSalary ? Number(editBasicSalary) : undefined,
                epf_no: editEpfNo || undefined,
                status: editStatus,
            });
            toast.success('Staff member updated');
            setEditingId(null);
            loadStaff();
        } catch (err: any) {
            toast.error(err?.response?.data?.message || 'Failed to update staff member');
        }
    };

    if (!canManageStaff) return <div className="text-slate-500">You don't have access to this page.</div>;
    if (loading) return <div>Loading...</div>;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-slate-800">Staff</h1>
                <button
                    onClick={() => setShowCreateForm(!showCreateForm)}
                    className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700"
                >
                    {showCreateForm ? 'Cancel' : 'New Staff Member'}
                </button>
            </div>

            {showCreateForm && (
                <form onSubmit={handleCreate} className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap gap-3 items-end">
                    {selectableWarehouses.length > 1 && (
                        <div>
                            <label className="block text-sm font-medium text-slate-600 mb-1">Warehouse</label>
                            <select className="border border-slate-300 rounded-lg px-3 py-2" value={formWarehouseId} onChange={(e) => setFormWarehouseId(e.target.value)} required>
                                <option value="">Select...</option>
                                {selectableWarehouses.map((w) => (
                                    <option key={w.ID} value={w.ID}>{w.NAME}</option>
                                ))}
                            </select>
                        </div>
                    )}
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">Name</label>
                        <input className="border border-slate-300 rounded-lg px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} required />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">NIC</label>
                        <input className="border border-slate-300 rounded-lg px-3 py-2" value={nic} onChange={(e) => setNic(e.target.value)} required />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">Designation</label>
                        <input className="border border-slate-300 rounded-lg px-3 py-2" value={designation} onChange={(e) => setDesignation(e.target.value)} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">Join Date</label>
                        <input type="date" className="border border-slate-300 rounded-lg px-3 py-2" value={joinDate} onChange={(e) => setJoinDate(e.target.value)} required />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">Basic Salary</label>
                        <input type="number" min="0" step="0.01" className="border border-slate-300 rounded-lg px-3 py-2 w-32" value={basicSalary} onChange={(e) => setBasicSalary(e.target.value)} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">EPF No.</label>
                        <input className="border border-slate-300 rounded-lg px-3 py-2" value={epfNo} onChange={(e) => setEpfNo(e.target.value)} />
                    </div>
                    <button type="submit" disabled={submitting || !formWarehouseId} className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                        {submitting ? 'Saving...' : 'Save'}
                    </button>
                </form>
            )}

            <div className="bg-white rounded-xl border border-slate-200">
                <table className="w-full text-sm">
                    <thead className="text-left text-slate-500">
                        <tr>
                            <th className="p-3">Name</th>
                            <th className="p-3">NIC</th>
                            {!isScoped && <th className="p-3">Warehouse</th>}
                            <th className="p-3">Designation</th>
                            <th className="p-3">Join Date</th>
                            <th className="p-3">Basic Salary</th>
                            <th className="p-3">EPF No.</th>
                            <th className="p-3">Status</th>
                            <th className="p-3">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {staffList.map((s) =>
                            editingId === s.ID ? (
                                <tr key={s.ID} className="border-t border-slate-100 bg-slate-50">
                                    <td className="p-2">
                                        <input className="border border-slate-300 rounded px-2 py-1 w-full" value={editName} onChange={(e) => setEditName(e.target.value)} />
                                    </td>
                                    <td className="p-3">{s.NIC}</td>
                                    {!isScoped && <td className="p-3">{s.WAREHOUSE_NAME}</td>}
                                    <td className="p-2">
                                        <input className="border border-slate-300 rounded px-2 py-1 w-full" value={editDesignation} onChange={(e) => setEditDesignation(e.target.value)} />
                                    </td>
                                    <td className="p-3">{s.JOIN_DATE}</td>
                                    <td className="p-2">
                                        <input type="number" min="0" step="0.01" className="border border-slate-300 rounded px-2 py-1 w-24" value={editBasicSalary} onChange={(e) => setEditBasicSalary(e.target.value)} />
                                    </td>
                                    <td className="p-2">
                                        <input className="border border-slate-300 rounded px-2 py-1 w-full" value={editEpfNo} onChange={(e) => setEditEpfNo(e.target.value)} />
                                    </td>
                                    <td className="p-2">
                                        <select className="border border-slate-300 rounded px-2 py-1" value={editStatus} onChange={(e) => setEditStatus(e.target.value as 'active' | 'inactive')}>
                                            <option value="active">Active</option>
                                            <option value="inactive">Inactive</option>
                                        </select>
                                    </td>
                                    <td className="p-2">
                                        <div className="flex gap-2">
                                            <button onClick={() => saveEdit(s.ID)} className="text-green-600 hover:text-green-700" title="Save"><Check size={16} /></button>
                                            <button onClick={cancelEdit} className="text-slate-400 hover:text-slate-600" title="Cancel"><X size={16} /></button>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                <tr key={s.ID} className="border-t border-slate-100">
                                    <td className="p-3">{s.NAME}</td>
                                    <td className="p-3">{s.NIC}</td>
                                    {!isScoped && <td className="p-3">{s.WAREHOUSE_NAME}</td>}
                                    <td className="p-3">{s.DESIGNATION}</td>
                                    <td className="p-3">{s.JOIN_DATE}</td>
                                    <td className="p-3">{s.BASIC_SALARY.toFixed(2)}</td>
                                    <td className="p-3">{s.EPF_NO}</td>
                                    <td className="p-3 capitalize">{s.STATUS}</td>
                                    <td className="p-3">
                                        <button onClick={() => startEdit(s)} className="text-slate-500 hover:text-blue-600" title="Edit"><Pencil size={16} /></button>
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

export default Staff;
