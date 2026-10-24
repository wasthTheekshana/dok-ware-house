import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Pencil, Check, X } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import type { Warehouse, Staff as StaffMember } from '../types';
import { PageHeader, Card, Table, Td, Tr, Badge, Button } from '../components/ui';

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
            const selectable = isScoped
                ? warehousesRes.data.filter((w) => selectableWarehouseIds.includes(w.ID))
                : warehousesRes.data;
            if (selectable.length === 1) {
                setFormWarehouseId(String(selectable[0].ID));
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

    const headers = ['Name', 'NIC', ...(!isScoped ? ['Warehouse'] : []), 'Designation', 'Join Date', 'Basic Salary', 'EPF No.', 'Status', 'Actions'];

    return (
        <div className="space-y-6">
            <PageHeader
                title="Staff"
                action={
                    <Button onClick={() => setShowCreateForm(!showCreateForm)}>
                        {showCreateForm ? 'Cancel' : 'New Staff Member'}
                    </Button>
                }
            />

            {showCreateForm && (
                <Card>
                    <form onSubmit={handleCreate} className="flex flex-wrap gap-3 items-end">
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
                    <Button type="submit" disabled={submitting || !formWarehouseId}>
                        {submitting ? 'Saving...' : 'Save'}
                    </Button>
                    </form>
                </Card>
            )}

            <Table headers={headers} empty={staffList.length === 0}>
                {staffList.map((s) =>
                    editingId === s.ID ? (
                        <Tr key={s.ID} className="bg-slate-50">
                            <Td>
                                <input className="border border-slate-300 rounded px-2 py-1 w-full" value={editName} onChange={(e) => setEditName(e.target.value)} />
                            </Td>
                            <Td>{s.NIC}</Td>
                            {!isScoped && <Td>{s.WAREHOUSE_NAME}</Td>}
                            <Td>
                                <input className="border border-slate-300 rounded px-2 py-1 w-full" value={editDesignation} onChange={(e) => setEditDesignation(e.target.value)} />
                            </Td>
                            <Td>{s.JOIN_DATE}</Td>
                            <Td>
                                <input type="number" min="0" step="0.01" className="border border-slate-300 rounded px-2 py-1 w-24" value={editBasicSalary} onChange={(e) => setEditBasicSalary(e.target.value)} />
                            </Td>
                            <Td>
                                <input className="border border-slate-300 rounded px-2 py-1 w-full" value={editEpfNo} onChange={(e) => setEditEpfNo(e.target.value)} />
                            </Td>
                            <Td>
                                <select className="border border-slate-300 rounded px-2 py-1" value={editStatus} onChange={(e) => setEditStatus(e.target.value as 'active' | 'inactive')}>
                                    <option value="active">Active</option>
                                    <option value="inactive">Inactive</option>
                                </select>
                            </Td>
                            <Td>
                                <div className="flex gap-2">
                                    <button onClick={() => saveEdit(s.ID)} className="text-green-600 hover:text-green-700" title="Save"><Check size={16} /></button>
                                    <button onClick={cancelEdit} className="text-slate-400 hover:text-slate-600" title="Cancel"><X size={16} /></button>
                                </div>
                            </Td>
                        </Tr>
                    ) : (
                        <Tr key={s.ID}>
                            <Td>{s.NAME}</Td>
                            <Td>{s.NIC}</Td>
                            {!isScoped && <Td>{s.WAREHOUSE_NAME}</Td>}
                            <Td>{s.DESIGNATION}</Td>
                            <Td>{s.JOIN_DATE}</Td>
                            <Td>{s.BASIC_SALARY.toFixed(2)}</Td>
                            <Td>{s.EPF_NO}</Td>
                            <Td><Badge tone={s.STATUS === 'active' ? 'success' : 'neutral'}>{s.STATUS === 'active' ? 'Active' : 'Inactive'}</Badge></Td>
                            <Td>
                                <button onClick={() => startEdit(s)} className="text-slate-500 hover:text-brand-600" title="Edit"><Pencil size={16} /></button>
                            </Td>
                        </Tr>
                    )
                )}
            </Table>
        </div>
    );
};

export default Staff;
