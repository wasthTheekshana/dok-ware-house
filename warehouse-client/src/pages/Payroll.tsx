import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import type { Warehouse, Staff, Payroll as PayrollRecord, PayrollReportRow } from '../types';
import { PageHeader, Card, Table, Td, Tr, Badge, Button } from '../components/ui';
import type { BadgeTone } from '../components/ui';

const STATUS_LABELS: Record<string, string> = {
    draft: 'Draft',
    pending_approval: 'Pending Approval',
    approved: 'Approved',
    rejected: 'Rejected',
};

const PAYROLL_BADGE: Record<string, BadgeTone> = {
    draft: 'neutral',
    pending_approval: 'warning',
    approved: 'success',
    rejected: 'danger',
};

function currentMonth(): number {
    return new Date().getMonth() + 1;
}

const Payroll: React.FC = () => {
    const { user } = useAuth();
    const canManagePayroll = user?.EFFECTIVE_PERMISSIONS?.includes('manage_payroll') ?? false;
    const isApprover = user?.ROLE === 'system_admin' || user?.ROLE === 'finance_officer';
    const isScoped = user?.ROLE === 'warehouse_admin';
    const canPrepareStaffList = user?.EFFECTIVE_PERMISSIONS?.includes('manage_staff') ?? false;
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
        api.get<PayrollRecord[]>('/payroll').then((res) => setRecords(res.data)).catch(() => setRecords([]));
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
        }).catch(() => setWarehouses([])).finally(() => setLoading(false));
        loadRecords();
    }, [canManagePayroll, isScoped]);

    useEffect(() => {
        if (!selectedWarehouseId || !canPrepareStaffList) {
            setStaffList([]);
            return;
        }
        api.get<Staff[]>('/staff', { params: { warehouse_id: selectedWarehouseId, status: 'active' } })
            .then((res) => setStaffList(res.data))
            .catch(() => setStaffList([]));
    }, [selectedWarehouseId, canPrepareStaffList]);

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
            if (isApprover) loadReport();
        } catch (err: any) {
            toast.error(err?.response?.data?.message || `Failed to ${action} payroll`);
        }
    };

    const loadReport = () => {
        api.get<PayrollReportRow[]>('/payroll/report', { params: { year: reportYear, month: reportMonth } })
            .then((res) => setReport(res.data))
            .catch(() => setReport([]));
    };

    useEffect(() => {
        if (!isApprover) return;
        loadReport();
    }, [isApprover, reportYear, reportMonth]);

    if (!canManagePayroll) return <div className="text-slate-500">You don't have access to this page.</div>;
    if (loading) return <div>Loading...</div>;

    return (
        <div className="space-y-6">
            <PageHeader title="Payroll" />

            {canPrepareStaffList && (
            <Card className="space-y-3">
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
                <Button onClick={handleCreate} disabled={creating || !selectedStaffId}>
                    {creating ? 'Creating...' : 'Create Draft (pre-filled from attendance)'}
                </Button>
            </Card>
            )}

            <Table headers={['Staff', 'Period', 'Basic', 'OT', 'Deductions', 'EPF (Emp.)', 'EPF (Emplr.)', 'ETF', 'Net Salary', 'Status', 'Actions']} empty={records.length === 0}>
                {records.map((p) =>
                    editingId === p.ID ? (
                        <Tr key={p.ID} className="bg-slate-50">
                            <Td>{p.STAFF_NAME}</Td>
                            <Td>{p.MONTH}/{p.YEAR}</Td>
                            <Td>{p.BASIC_PAY.toFixed(2)}</Td>
                            <Td className="p-2">
                                <input type="number" className="border border-slate-300 rounded px-2 py-1 w-20" value={editOtAmount} onChange={(e) => setEditOtAmount(e.target.value)} />
                            </Td>
                            <Td className="p-2">
                                <input type="number" className="border border-slate-300 rounded px-2 py-1 w-20" value={editDeductions} onChange={(e) => setEditDeductions(e.target.value)} />
                            </Td>
                            <Td className="p-2">
                                <input type="number" className="border border-slate-300 rounded px-2 py-1 w-20" value={editEpfEmployee} onChange={(e) => setEditEpfEmployee(e.target.value)} />
                            </Td>
                            <Td className="p-2">
                                <input type="number" className="border border-slate-300 rounded px-2 py-1 w-20" value={editEpfEmployer} onChange={(e) => setEditEpfEmployer(e.target.value)} />
                            </Td>
                            <Td className="p-2">
                                <input type="number" className="border border-slate-300 rounded px-2 py-1 w-20" value={editEtf} onChange={(e) => setEditEtf(e.target.value)} />
                            </Td>
                            <Td>—</Td>
                            <Td className="capitalize">{STATUS_LABELS[p.STATUS]}</Td>
                            <Td className="p-2">
                                <div className="flex gap-2">
                                    <Button variant="primary" className="text-xs px-2 py-1" onClick={() => saveEdit(p.ID)}>Save</Button>
                                    <Button variant="secondary" className="text-xs px-2 py-1" onClick={cancelEdit}>Cancel</Button>
                                </div>
                            </Td>
                        </Tr>
                    ) : (
                        <Tr key={p.ID}>
                            <Td>{p.STAFF_NAME}</Td>
                            <Td>{p.MONTH}/{p.YEAR}</Td>
                            <Td>{p.BASIC_PAY.toFixed(2)}</Td>
                            <Td>{p.OT_AMOUNT.toFixed(2)}</Td>
                            <Td>{p.DEDUCTIONS.toFixed(2)}</Td>
                            <Td>{p.EPF_EMPLOYEE.toFixed(2)}</Td>
                            <Td>{p.EPF_EMPLOYER.toFixed(2)}</Td>
                            <Td>{p.ETF.toFixed(2)}</Td>
                            <Td className="font-medium">{p.NET_SALARY.toFixed(2)}</Td>
                            <Td>
                                <Badge tone={PAYROLL_BADGE[p.STATUS]}>{STATUS_LABELS[p.STATUS]}</Badge>
                            </Td>
                            <Td>
                                <div className="flex gap-2 flex-wrap">
                                    {(p.STATUS === 'draft' || p.STATUS === 'rejected') && !p.REVERSES_PAYROLL_ID && (
                                        <>
                                            <Button variant="secondary" className="text-xs px-2 py-1" onClick={() => startEdit(p)}>Edit</Button>
                                            <Button variant="primary" className="text-xs px-2 py-1" onClick={() => doAction(p.ID, 'submit', 'Submitted for approval')}>Submit</Button>
                                        </>
                                    )}
                                    {isApprover && p.STATUS === 'pending_approval' && (
                                        <>
                                            <Button variant="primary" className="text-xs px-2 py-1" onClick={() => doAction(p.ID, 'approve', 'Payroll approved')}>Approve</Button>
                                            <Button variant="danger" className="text-xs px-2 py-1" onClick={() => doAction(p.ID, 'reject', 'Payroll rejected')}>Reject</Button>
                                        </>
                                    )}
                                    {isApprover && p.STATUS === 'approved' && !p.REVERSES_PAYROLL_ID && (
                                        <Button variant="secondary" className="text-xs px-2 py-1" onClick={() => doAction(p.ID, 'reverse', 'Payroll reversed')}>Reverse</Button>
                                    )}
                                </div>
                            </Td>
                        </Tr>
                    )
                )}
            </Table>

            {isApprover && (
                <Card>
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
                        <thead className="text-left text-slate-400">
                            <tr>
                                <th className="p-2 font-medium text-xs uppercase tracking-wide">Warehouse</th>
                                <th className="p-2 font-medium text-xs uppercase tracking-wide">Net Salary (Employee-side)</th>
                                <th className="p-2 font-medium text-xs uppercase tracking-wide">Total Employer Cost</th>
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
                </Card>
            )}
        </div>
    );
};

export default Payroll;
