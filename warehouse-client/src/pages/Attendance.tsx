import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import type { Warehouse, Staff, AttendanceStatus, AttendanceSummary } from '../types';

const STATUS_OPTIONS: { value: AttendanceStatus; label: string }[] = [
    { value: 'present', label: 'Present' },
    { value: 'absent', label: 'Absent' },
    { value: 'half_day', label: 'Half-Day' },
    { value: 'leave', label: 'Leave' },
];

function todayISO(): string {
    return new Date().toISOString().slice(0, 10);
}

interface RowState {
    status: AttendanceStatus;
    in_time: string;
    out_time: string;
}

const Attendance: React.FC = () => {
    const { user } = useAuth();
    const canManageStaff = user?.EFFECTIVE_PERMISSIONS?.includes('manage_staff') ?? false;
    const isScoped = user?.ROLE === 'warehouse_admin';
    const selectableWarehouseIds = user?.WAREHOUSE_IDS ?? [];

    const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
    const selectableWarehouses = isScoped
        ? warehouses.filter((w) => selectableWarehouseIds.includes(w.ID))
        : warehouses;
    const [selectedWarehouseId, setSelectedWarehouseId] = useState('');
    const [attendanceDate, setAttendanceDate] = useState(todayISO());

    const [staffList, setStaffList] = useState<Staff[]>([]);
    const [rows, setRows] = useState<Record<number, RowState>>({});
    const [loading, setLoading] = useState(canManageStaff);
    const [saving, setSaving] = useState(false);

    const [summaryStaffId, setSummaryStaffId] = useState('');
    const [summaryYear, setSummaryYear] = useState(new Date().getFullYear());
    const [summaryMonth, setSummaryMonth] = useState(new Date().getMonth() + 1);
    const [summary, setSummary] = useState<AttendanceSummary | null>(null);

    useEffect(() => {
        if (!canManageStaff) return;
        api.get<Warehouse[]>('/warehouses').then((res) => {
            setWarehouses(res.data);
            if (isScoped) {
                const ownWarehouses = res.data.filter((w) => selectableWarehouseIds.includes(w.ID));
                if (ownWarehouses.length === 1) {
                    setSelectedWarehouseId(String(ownWarehouses[0].ID));
                }
            }
        }).finally(() => setLoading(false));
    }, [canManageStaff, isScoped]);

    useEffect(() => {
        if (!selectedWarehouseId) {
            setStaffList([]);
            return;
        }
        api.get<Staff[]>('/staff', { params: { warehouse_id: selectedWarehouseId, status: 'active' } })
            .then((res) => {
                setStaffList(res.data);
                const initial: Record<number, RowState> = {};
                for (const s of res.data) {
                    initial[s.ID] = { status: 'present', in_time: '', out_time: '' };
                }
                setRows(initial);
            });
    }, [selectedWarehouseId]);

    const updateRow = (staffId: number, field: keyof RowState, value: string) => {
        setRows((prev) => ({ ...prev, [staffId]: { ...prev[staffId], [field]: value } }));
    };

    const handleSaveDay = async () => {
        setSaving(true);
        try {
            const entries = staffList.map((s) => {
                const row = rows[s.ID];
                const entry: any = { staff_id: s.ID, status: row.status };
                if (row.in_time) entry.in_time = row.in_time;
                if (row.out_time) entry.out_time = row.out_time;
                return entry;
            });
            await api.post('/attendance/bulk-mark', {
                warehouse_id: Number(selectedWarehouseId),
                attendance_date: attendanceDate,
                entries,
            });
            toast.success('Attendance saved');
        } catch (err: any) {
            toast.error(err?.response?.data?.message || 'Failed to save attendance');
        } finally {
            setSaving(false);
        }
    };

    const loadSummary = () => {
        if (!summaryStaffId) return;
        api.get<AttendanceSummary>('/attendance/summary', { params: { staff_id: summaryStaffId, year: summaryYear, month: summaryMonth } })
            .then((res) => setSummary(res.data));
    };

    useEffect(() => {
        loadSummary();
    }, [summaryStaffId, summaryYear, summaryMonth]);

    if (!canManageStaff) return <div className="text-slate-500">You don't have access to this page.</div>;
    if (loading) return <div>Loading...</div>;

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-bold text-slate-800">Attendance</h1>

            <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-4">
                <div className="grid grid-cols-2 gap-3">
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
                        <label className="block text-sm font-medium text-slate-600 mb-1">Date</label>
                        <input type="date" className="border border-slate-300 rounded-lg px-3 py-2 w-full" value={attendanceDate} onChange={(e) => setAttendanceDate(e.target.value)} />
                    </div>
                </div>

                {staffList.length > 0 && (
                    <table className="w-full text-sm">
                        <thead className="text-left text-slate-500">
                            <tr>
                                <th className="p-2">Staff</th>
                                <th className="p-2">Status</th>
                                <th className="p-2">In Time</th>
                                <th className="p-2">Out Time</th>
                            </tr>
                        </thead>
                        <tbody>
                            {staffList.map((s) => (
                                <tr key={s.ID} className="border-t border-slate-100">
                                    <td className="p-2">{s.NAME}</td>
                                    <td className="p-2">
                                        <select
                                            className="border border-slate-300 rounded px-2 py-1"
                                            value={rows[s.ID]?.status || 'present'}
                                            onChange={(e) => updateRow(s.ID, 'status', e.target.value)}
                                        >
                                            {STATUS_OPTIONS.map((opt) => (
                                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                                            ))}
                                        </select>
                                    </td>
                                    <td className="p-2">
                                        {(rows[s.ID]?.status === 'present' || rows[s.ID]?.status === 'half_day') && (
                                            <input type="time" className="border border-slate-300 rounded px-2 py-1" value={rows[s.ID]?.in_time || ''} onChange={(e) => updateRow(s.ID, 'in_time', e.target.value)} />
                                        )}
                                    </td>
                                    <td className="p-2">
                                        {(rows[s.ID]?.status === 'present' || rows[s.ID]?.status === 'half_day') && (
                                            <input type="time" className="border border-slate-300 rounded px-2 py-1" value={rows[s.ID]?.out_time || ''} onChange={(e) => updateRow(s.ID, 'out_time', e.target.value)} />
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}

                {staffList.length > 0 && (
                    <button onClick={handleSaveDay} disabled={saving} className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                        {saving ? 'Saving...' : 'Save Day'}
                    </button>
                )}
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-semibold text-slate-700">Monthly Summary</h2>
                    <div className="flex gap-2">
                        <select className="border border-slate-300 rounded px-2 py-1 text-sm" value={summaryStaffId} onChange={(e) => setSummaryStaffId(e.target.value)}>
                            <option value="">Select staff...</option>
                            {staffList.map((s) => (
                                <option key={s.ID} value={s.ID}>{s.NAME}</option>
                            ))}
                        </select>
                        <select className="border border-slate-300 rounded px-2 py-1 text-sm" value={summaryMonth} onChange={(e) => setSummaryMonth(Number(e.target.value))}>
                            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                                <option key={m} value={m}>{m}</option>
                            ))}
                        </select>
                        <input type="number" className="border border-slate-300 rounded px-2 py-1 text-sm w-20" value={summaryYear} onChange={(e) => setSummaryYear(Number(e.target.value))} />
                    </div>
                </div>
                {summary && (
                    <div className="grid grid-cols-4 gap-3 text-sm">
                        <div className="bg-slate-50 rounded-lg p-3 text-center">
                            <div className="text-slate-500">Present</div>
                            <div className="text-lg font-semibold">{summary.counts.present}</div>
                        </div>
                        <div className="bg-slate-50 rounded-lg p-3 text-center">
                            <div className="text-slate-500">Absent</div>
                            <div className="text-lg font-semibold">{summary.counts.absent}</div>
                        </div>
                        <div className="bg-slate-50 rounded-lg p-3 text-center">
                            <div className="text-slate-500">Half-Day</div>
                            <div className="text-lg font-semibold">{summary.counts.half_day}</div>
                        </div>
                        <div className="bg-slate-50 rounded-lg p-3 text-center">
                            <div className="text-slate-500">Leave</div>
                            <div className="text-lg font-semibold">{summary.counts.leave}</div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Attendance;
