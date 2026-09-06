import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import type { Warehouse, Staff, Payroll as PayrollRecord, PayrollReportRow } from '../types';

const STATUS_LABELS: Record<string, string> = {
    draft: 'Draft',
    pending_approval: 'Pending Approval',
    approved: 'Approved',
    rejected: 'Rejected',
};

function currentMonth(): number {
    return new Date().getMonth() + 1;
}

const Payroll: React.FC = () => {
    const { user } = useAuth();
    const canManagePayroll = user?.EFFECTIVE_PERMISSIONS?.includes('manage_payroll') ?? false;
    const isApprover = user?.ROLE === 'system_admin' || user?.ROLE === 'finance_officer';
    const isScoped = user?.ROLE === 'warehouse_admin';
    const selectableWarehouseIds = user?.WAREHOUSE_IDS ?? [];

    const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
    const selectableWarehouses = isScoped
        ? warehouses.filter((w) => selectableWarehouseIds.includes(w.ID))
        : warehouses;
    const [selectedWarehouseId, setSelectedWarehouseId] = useState('');

    const [staffList, setStaffList] = useState<Staff[]>([]);
    const [selectedStaffId, setSelectedStaffId] = useState('');
    const [month, setMonth] = useState(currentMonth());
    const [year, setYear] = useState(new Date().getFullYear());

    const [records, setRecords] = useState<PayrollRecord[]>([]);
    const [loading, setLoading] = useState(canManagePayroll);
    const [creating, setCreating] = useState(false);

    const [editingId, setEditingId] = useState<number | null>(null);
    const [editOtAmount, setEditOtAmount] = useState('');
    const [editDeductions, setEditDeductions] = useState('');
    const [editEpfEmployee, setEditEpfEmployee] = useState('');
    const [editEpfEmployer, setEditEpfEmployer] = useState('');
    const [editEtf, setEditEtf] = useState('');

    const [reportYear, setReportYear] = useState(new Date().getFullYear());
    const [reportMonth, setReportMonth] = useState(currentMonth());
    const [report, setReport] = useState<PayrollReportRow[]>([]);

    const loadRecords = () => {
        api.get<PayrollRecord[]>('/payroll').then((res) => setRecords(res.data));
    };

    useEffect(() => {
        if (!canManagePayroll) return;
        api.get<Warehouse[]>('/warehouses').then((res) => {
            setWarehouses(res.data);
            const selectable = isScoped
                ? res.data.filter((w) => selectableWarehouseIds.includes(w.ID))
                : res.data;
            if (selectable.length === 1) {
                setSelectedWarehouseId(String(selectable[0].ID));
            }
        }).finally(() => setLoading(false));
        loadRecords();
    }, [canManagePayroll, isScoped]);

    useEffect(() => {
        if (!selectedWarehouseId) {
            setStaffList([]);
            return;
        }
        api.get<Staff[]>('/staff', { params: { warehouse_id: selectedWarehouseId, status: 'active' } })
            .then((res) => setStaffList(res.data));
    }, [selectedWarehouseId]);

    const handleCreate = async () => {
        if (!selectedStaffId) return;
        setCreating(true);
        try {
            await api.post('/payroll', { staff_id: Number(selectedStaffId), month, year });
            toast.success('Payroll draft created');
            loadRecords();
        } catch (err: any) {
            toast.error(err?.response?.data?.message || 'Failed to create payroll draft');
        } finally {
            setCreating(false);
        }
    };

    const startEdit = (p: PayrollRecord) => {
        setEditingId(p.ID);
        setEditOtAmount(String(p.OT_AMOUNT));
        setEditDeductions(String(p.DEDUCTIONS));
        setEditEpfEmployee(String(p.EPF_EMPLOYEE));
        setEditEpfEmployer(String(p.EPF_EMPLOYER));
        setEditEtf(String(p.ETF));
    };

    const cancelEdit = () => setEditingId(null);

    const saveEdit = async (id: number) => {
        try {
            await api.put(`/payroll/${id}`, {
                ot_amount: Number(editOtAmount),
                deductions: Number(editDeductions),
                epf_employee: Number(editEpfEmployee),
                epf_employer: Number(editEpfEmployer),
                etf: Number(editEtf),
            });
            toast.success('Payroll updated');
            setEditingId(null);
            loadRecords();
        } catch (err: any) {
            toast.error(err?.response?.data?.message || 'Failed to update payroll');
        }
    };

    const doAction = async (id: number, action: 'submit' | 'approve' | 'reject' | 'reverse', successMessage: string) => {
        try {
            await api.post(`/payroll/${id}/${action}`);
            toast.success(successMessage);
            loadRecords();
        } catch (err: any) {
            toast.error(err?.response?.data?.message || `Failed to ${action} payroll`);
        }
    };

    const loadReport = () => {
        api.get<PayrollReportRow[]>('/payroll/report', { params: { year: reportYear, month: reportMonth } })
            .then((res) => setReport(res.data));
    };

    useEffect(() => {
        if (!isApprover) return;
        loadReport();
    }, [isApprover, reportYear, reportMonth]);

    if (!canManagePayroll) return <div className="text-slate-500">You don't have access to this page.</div>;
    if (loading) return <div>Loading...</div>;

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-bold text-slate-800">Payroll</h1>

            <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
                <h2 className="text-sm font-semibold text-slate-700">Prepare Payroll</h2>
                <div className="grid grid-cols-4 gap-3 items-end">
                    {selectableWarehouses.length > 1 && (
                        <div>
                            <label className="block text-sm font-medium text-slate-600 mb-1">Warehouse</label>
                            <select className="border border-slate-300 rounded-lg px-3 py-2 w-full" value={selectedWarehouseId} onChange={(e) => setSelectedWarehouseId(e.target.value)}>
                                <option value="">Select...</option>
                                {selectableWarehouses.map((w) => (
                                    <option key={w.ID} value={w.ID}>{w.NAME}</option>
                                ))}
                            </select>
                        </div>
                    )}
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">Staff</label>
                        <select className="border border-slate-300 rounded-lg px-3 py-2 w-full" value={selectedStaffId} onChange={(e) => setSelectedStaffId(e.target.value)}>
                            <option value="">Select...</option>
                            {staffList.map((s) => (
                                <option key={s.ID} value={s.ID}>{s.NAME}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">Month</label>
                        <select className="border border-slate-300 rounded-lg px-3 py-2 w-full" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                                <option key={m} value={m}>{m}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">Year</label>
                        <input type="number" className="border border-slate-300 rounded-lg px-3 py-2 w-full" value={year} onChange={(e) => setYear(Number(e.target.value))} />
                    </div>
                </div>
                <button onClick={handleCreate} disabled={creating || !selectedStaffId} className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                    {creating ? 'Creating...' : 'Create Draft (pre-filled from attendance)'}
                </button>
            </div>

            <div className="bg-white rounded-xl border border-slate-200">
                <table className="w-full text-sm">
                    <thead className="text-left text-slate-500">
                        <tr>
                            <th className="p-3">Staff</th>
                            <th className="p-3">Period</th>
                            <th className="p-3">Basic</th>
                            <th className="p-3">OT</th>
                            <th className="p-3">Deductions</th>
                            <th className="p-3">EPF (Emp.)</th>
                            <th className="p-3">Net Salary</th>
                            <th className="p-3">Status</th>
                            <th className="p-3">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {records.map((p) =>
                            editingId === p.ID ? (
                                <tr key={p.ID} className="border-t border-slate-100 bg-slate-50">
                                    <td className="p-3">{p.STAFF_NAME}</td>
                                    <td className="p-3">{p.MONTH}/{p.YEAR}</td>
                                    <td className="p-3">{p.BASIC_PAY.toFixed(2)}</td>
                                    <td className="p-2">
                                        <input type="number" className="border border-slate-300 rounded px-2 py-1 w-20" value={editOtAmount} onChange={(e) => setEditOtAmount(e.target.value)} />
                                    </td>
                                    <td className="p-2">
                                        <input type="number" className="border border-slate-300 rounded px-2 py-1 w-20" value={editDeductions} onChange={(e) => setEditDeductions(e.target.value)} />
                                    </td>
                                    <td className="p-2">
                                        <input type="number" className="border border-slate-300 rounded px-2 py-1 w-20" value={editEpfEmployee} onChange={(e) => setEditEpfEmployee(e.target.value)} />
                                    </td>
                                    <td className="p-3">—</td>
                                    <td className="p-3 capitalize">{STATUS_LABELS[p.STATUS]}</td>
                                    <td className="p-2">
                                        <div className="flex gap-2">
                                            <button onClick={() => saveEdit(p.ID)} className="text-green-600 hover:text-green-700 text-xs font-medium">Save</button>
                                            <button onClick={cancelEdit} className="text-slate-400 hover:text-slate-600 text-xs font-medium">Cancel</button>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                <tr key={p.ID} className="border-t border-slate-100">
                                    <td className="p-3">{p.STAFF_NAME}</td>
                                    <td className="p-3">{p.MONTH}/{p.YEAR}</td>
                                    <td className="p-3">{p.BASIC_PAY.toFixed(2)}</td>
                                    <td className="p-3">{p.OT_AMOUNT.toFixed(2)}</td>
                                    <td className="p-3">{p.DEDUCTIONS.toFixed(2)}</td>
                                    <td className="p-3">{p.EPF_EMPLOYEE.toFixed(2)}</td>
                                    <td className="p-3 font-medium">{p.NET_SALARY.toFixed(2)}</td>
                                    <td className="p-3">
                                        <span className={
                                            p.STATUS === 'approved' ? 'text-green-600' :
                                            p.STATUS === 'rejected' ? 'text-red-600' :
                                            p.STATUS === 'pending_approval' ? 'text-amber-600' : 'text-slate-500'
                                        }>
                                            {STATUS_LABELS[p.STATUS]}
                                        </span>
                                    </td>
                                    <td className="p-3">
                                        <div className="flex gap-2 flex-wrap">
                                            {(p.STATUS === 'draft' || p.STATUS === 'rejected') && !p.REVERSES_PAYROLL_ID && (
                                                <>
                                                    <button onClick={() => startEdit(p)} className="text-slate-500 hover:text-blue-600 text-xs font-medium">Edit</button>
                                                    <button onClick={() => doAction(p.ID, 'submit', 'Submitted for approval')} className="text-blue-600 hover:text-blue-700 text-xs font-medium">Submit</button>
                                                </>
                                            )}
                                            {isApprover && p.STATUS === 'pending_approval' && (
                                                <>
                                                    <button onClick={() => doAction(p.ID, 'approve', 'Payroll approved')} className="text-green-600 hover:text-green-700 text-xs font-medium">Approve</button>
                                                    <button onClick={() => doAction(p.ID, 'reject', 'Payroll rejected')} className="text-red-600 hover:text-red-700 text-xs font-medium">Reject</button>
                                                </>
                                            )}
                                            {isApprover && p.STATUS === 'approved' && !p.REVERSES_PAYROLL_ID && (
                                                <button onClick={() => doAction(p.ID, 'reverse', 'Payroll reversed')} className="text-amber-600 hover:text-amber-700 text-xs font-medium">Reverse</button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            )
                        )}
                    </tbody>
                </table>
            </div>

            {isApprover && (
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="text-sm font-semibold text-slate-700">Consolidated Payroll Report</h2>
                        <div className="flex gap-2">
                            <select className="border border-slate-300 rounded px-2 py-1 text-sm" value={reportMonth} onChange={(e) => setReportMonth(Number(e.target.value))}>
                                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                                    <option key={m} value={m}>{m}</option>
                                ))}
                            </select>
                            <input type="number" className="border border-slate-300 rounded px-2 py-1 text-sm w-20" value={reportYear} onChange={(e) => setReportYear(Number(e.target.value))} />
                        </div>
                    </div>
                    <table className="w-full text-sm">
                        <thead className="text-left text-slate-500">
                            <tr>
                                <th className="p-2">Warehouse</th>
                                <th className="p-2">Net Salary (Employee-side)</th>
                                <th className="p-2">Total Employer Cost</th>
                            </tr>
                        </thead>
                        <tbody>
                            {report.map((row) => (
                                <tr key={row.WAREHOUSE_ID} className="border-t border-slate-100">
                                    <td className="p-2">{row.WAREHOUSE_NAME}</td>
                                    <td className="p-2">{row.TOTAL_NET_SALARY.toFixed(2)}</td>
                                    <td className="p-2">{row.TOTAL_EMPLOYER_COST.toFixed(2)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

export default Payroll;
