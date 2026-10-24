import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Pencil, Check, X } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import type { Warehouse, WarehouseExpense, ExpenseSummary, ExpenseComparisonRow } from '../types';
import { PageHeader, Card, Table, Td, Tr, Button } from '../components/ui';

const CATEGORY_FIELDS = [
    { key: 'transport_amount', label: 'Transport/Parking' },
    { key: 'fuel_amount', label: 'Fuel' },
    { key: 'labour_amount', label: 'Labour' },
    { key: 'meals_amount', label: 'Meals & Refreshments' },
    { key: 'other_amount', label: 'Other' },
] as const;

type CategoryKey = typeof CATEGORY_FIELDS[number]['key'];

function todayISO(): string {
    return new Date().toISOString().slice(0, 10);
}

const Expenses: React.FC = () => {
    const { user } = useAuth();
    const canManageExpenses = user?.EFFECTIVE_PERMISSIONS?.includes('manage_expenses') ?? false;
    // Scoped to a specific warehouse (or set of warehouses) rather than able
    // to act across all of them. Only warehouse_admin is scoped by role
    // default — system_admin and any finance_officer granted manage_expenses
    // via a permission override are both backend-unscoped, so both must see
    // the full warehouse picker and the cross-warehouse comparison view.
    const isScoped = user?.ROLE === 'warehouse_admin';
    const selectableWarehouseIds = user?.WAREHOUSE_IDS ?? [];

    const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
    const selectableWarehouses = isScoped
        ? warehouses.filter((w) => selectableWarehouseIds.includes(w.ID))
        : warehouses;
    const [entries, setEntries] = useState<WarehouseExpense[]>([]);
    const [loading, setLoading] = useState(canManageExpenses);

    const [formWarehouseId, setFormWarehouseId] = useState('');
    const [formDate, setFormDate] = useState(todayISO());
    const [formAmounts, setFormAmounts] = useState<Record<CategoryKey, string>>({
        transport_amount: '', fuel_amount: '', labour_amount: '', meals_amount: '', other_amount: '',
    });
    const [formRemarks, setFormRemarks] = useState('');
    const [existingEntryId, setExistingEntryId] = useState<number | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const [editingId, setEditingId] = useState<number | null>(null);
    const [editAmounts, setEditAmounts] = useState<Record<CategoryKey, string>>({
        transport_amount: '', fuel_amount: '', labour_amount: '', meals_amount: '', other_amount: '',
    });
    const [editRemarks, setEditRemarks] = useState('');

    const [summary, setSummary] = useState<ExpenseSummary | null>(null);
    const [summaryYear, setSummaryYear] = useState(new Date().getFullYear());
    const [summaryMonth, setSummaryMonth] = useState(new Date().getMonth() + 1);
    const [comparison, setComparison] = useState<ExpenseComparisonRow[]>([]);

    const loadEntries = () => {
        api.get<WarehouseExpense[]>('/expenses').then((res) => setEntries(res.data));
    };

    useEffect(() => {
        if (!canManageExpenses) return;
        Promise.all([
            api.get<Warehouse[]>('/warehouses'),
            api.get<WarehouseExpense[]>('/expenses'),
        ]).then(([warehousesRes, entriesRes]) => {
            setWarehouses(warehousesRes.data);
            setEntries(entriesRes.data);
            const selectable = isScoped
                ? warehousesRes.data.filter((w) => selectableWarehouseIds.includes(w.ID))
                : warehousesRes.data;
            if (selectable.length === 1) {
                setFormWarehouseId(String(selectable[0].ID));
            }
        }).finally(() => setLoading(false));
    }, [canManageExpenses, isScoped]);

    // Pre-fill (and switch to edit mode) when a same-day entry already exists
    // for the selected warehouse — matches UC-5's "pre-filled... enters
    // amounts" re-entry flow.
    useEffect(() => {
        if (!formWarehouseId || !formDate) {
            setExistingEntryId(null);
            return;
        }
        api.get<WarehouseExpense[]>('/expenses', { params: { warehouse_id: formWarehouseId, from: formDate, to: formDate } })
            .then((res) => {
                const existing = res.data[0];
                if (existing) {
                    setExistingEntryId(existing.ID);
                    setFormAmounts({
                        transport_amount: String(existing.TRANSPORT_AMOUNT),
                        fuel_amount: String(existing.FUEL_AMOUNT),
                        labour_amount: String(existing.LABOUR_AMOUNT),
                        meals_amount: String(existing.MEALS_AMOUNT),
                        other_amount: String(existing.OTHER_AMOUNT),
                    });
                    setFormRemarks(existing.REMARKS || '');
                } else {
                    setExistingEntryId(null);
                }
            });
    }, [formWarehouseId, formDate]);

    const loadSummary = (warehouseId: string, year: number, month: number) => {
        if (!warehouseId) return;
        api.get<ExpenseSummary>('/expenses/summary', { params: { warehouse_id: warehouseId, year, month } })
            .then((res) => setSummary(res.data));
    };

    useEffect(() => {
        loadSummary(formWarehouseId, summaryYear, summaryMonth);
    }, [formWarehouseId, summaryYear, summaryMonth]);

    useEffect(() => {
        if (isScoped) return;
        api.get<ExpenseComparisonRow[]>('/expenses/comparison', { params: { year: summaryYear, month: summaryMonth } })
            .then((res) => setComparison(res.data));
    }, [isScoped, summaryYear, summaryMonth]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        const payload: any = { remarks: formRemarks };
        for (const { key } of CATEGORY_FIELDS) {
            payload[key] = formAmounts[key] ? Number(formAmounts[key]) : 0;
        }
        try {
            if (existingEntryId) {
                await api.put(`/expenses/${existingEntryId}`, payload);
                toast.success('Expense entry updated');
            } else {
                await api.post('/expenses', { ...payload, warehouse_id: Number(formWarehouseId), expense_date: formDate });
                toast.success('Expense entry saved');
            }
            loadEntries();
            loadSummary(formWarehouseId, summaryYear, summaryMonth);
        } catch (err: any) {
            toast.error(err?.response?.data?.message || 'Failed to save expense entry');
        } finally {
            setSubmitting(false);
        }
    };

    const startEdit = (entry: WarehouseExpense) => {
        setEditingId(entry.ID);
        setEditAmounts({
            transport_amount: String(entry.TRANSPORT_AMOUNT),
            fuel_amount: String(entry.FUEL_AMOUNT),
            labour_amount: String(entry.LABOUR_AMOUNT),
            meals_amount: String(entry.MEALS_AMOUNT),
            other_amount: String(entry.OTHER_AMOUNT),
        });
        setEditRemarks(entry.REMARKS || '');
    };

    const cancelEdit = () => setEditingId(null);

    const saveEdit = async (id: number) => {
        const payload: any = { remarks: editRemarks };
        for (const { key } of CATEGORY_FIELDS) {
            payload[key] = editAmounts[key] ? Number(editAmounts[key]) : 0;
        }
        try {
            await api.put(`/expenses/${id}`, payload);
            toast.success('Expense entry updated');
            setEditingId(null);
            loadEntries();
        } catch (err: any) {
            toast.error(err?.response?.data?.message || 'Failed to update expense entry');
        }
    };

    if (!canManageExpenses) return <div className="text-slate-500">You don't have access to this page.</div>;
    if (loading) return <div>Loading...</div>;

    const headers = ['Date', ...(!isScoped ? ['Warehouse'] : []), ...CATEGORY_FIELDS.map((f) => f.label), 'Remarks', 'Actions'];

    return (
        <div className="space-y-6">
            <PageHeader title="Warehouse Expenses" />

            <Card>
                <form onSubmit={handleSubmit} className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                        {selectableWarehouses.length > 1 && (
                            <div>
                                <label className="block text-sm font-medium text-slate-600 mb-1">Warehouse</label>
                                <select className="border border-slate-300 rounded-lg px-3 py-2 w-full" value={formWarehouseId} onChange={(e) => setFormWarehouseId(e.target.value)} required>
                                    <option value="">Select...</option>
                                    {selectableWarehouses.map((w) => (
                                        <option key={w.ID} value={w.ID}>{w.NAME}</option>
                                    ))}
                                </select>
                            </div>
                        )}
                        <div>
                            <label className="block text-sm font-medium text-slate-600 mb-1">Date</label>
                            <input type="date" className="border border-slate-300 rounded-lg px-3 py-2 w-full" value={formDate} onChange={(e) => setFormDate(e.target.value)} required />
                        </div>
                    </div>
                    <div className="grid grid-cols-5 gap-3">
                        {CATEGORY_FIELDS.map(({ key, label }) => (
                            <div key={key}>
                                <label className="block text-sm font-medium text-slate-600 mb-1">{label}</label>
                                <input type="number" min="0" step="0.01" className="border border-slate-300 rounded-lg px-3 py-2 w-full" value={formAmounts[key]} onChange={(e) => setFormAmounts((prev) => ({ ...prev, [key]: e.target.value }))} />
                            </div>
                        ))}
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">Remarks</label>
                        <input className="border border-slate-300 rounded-lg px-3 py-2 w-full" value={formRemarks} onChange={(e) => setFormRemarks(e.target.value)} />
                    </div>
                    <Button type="submit" disabled={submitting || !formWarehouseId}>
                        {submitting ? 'Saving...' : existingEntryId ? 'Update Entry' : 'Save Entry'}
                    </Button>
                </form>
            </Card>

            {summary && (
                <Card>
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="text-sm font-semibold text-slate-700">Monthly Summary</h2>
                        <div className="flex gap-2">
                            <select className="border border-slate-300 rounded px-2 py-1 text-sm" value={summaryMonth} onChange={(e) => setSummaryMonth(Number(e.target.value))}>
                                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                                    <option key={m} value={m}>{m}</option>
                                ))}
                            </select>
                            <input type="number" className="border border-slate-300 rounded px-2 py-1 text-sm w-20" value={summaryYear} onChange={(e) => setSummaryYear(Number(e.target.value))} />
                        </div>
                    </div>
                    <table className="w-full text-sm">
                        <thead className="text-left text-slate-400">
                            <tr>
                                <th className="p-2 font-medium text-xs uppercase tracking-wide">Category</th>
                                <th className="p-2 font-medium text-xs uppercase tracking-wide">This Month</th>
                                <th className="p-2 font-medium text-xs uppercase tracking-wide">Variance</th>
                            </tr>
                        </thead>
                        <tbody>
                            {CATEGORY_FIELDS.map(({ key, label }) => {
                                const cat = summary.categories[key];
                                return (
                                    <tr key={key} className="border-t border-slate-100">
                                        <td className="p-2">{label}</td>
                                        <td className="p-2">{cat.current.toFixed(2)}</td>
                                        <td className="p-2">
                                            {cat.variance.value === null
                                                ? <span className="text-slate-400">N/A</span>
                                                : <span className={cat.variance.value >= 0 ? 'text-red-600' : 'text-green-600'}>
                                                    {cat.variance.value >= 0 ? '+' : ''}{cat.variance.value.toFixed(2)}
                                                    {cat.variance.percent !== null && ` (${cat.variance.percent >= 0 ? '+' : ''}${cat.variance.percent.toFixed(1)}%)`}
                                                  </span>}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </Card>
            )}

            {!isScoped && comparison.length > 0 && (
                <Card>
                    <h2 className="text-sm font-semibold text-slate-700 mb-3">Cross-Warehouse Comparison</h2>
                    <table className="w-full text-sm">
                        <thead className="text-left text-slate-400">
                            <tr>
                                <th className="p-2 font-medium text-xs uppercase tracking-wide">Warehouse</th>
                                <th className="p-2 font-medium text-xs uppercase tracking-wide">Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            {comparison.map((row) => (
                                <tr key={row.WAREHOUSE_ID} className="border-t border-slate-100">
                                    <td className="p-2">{row.WAREHOUSE_NAME}</td>
                                    <td className="p-2">{row.TOTAL_AMOUNT.toFixed(2)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </Card>
            )}

            <Table headers={headers} empty={entries.length === 0}>
                {entries.map((entry) =>
                    editingId === entry.ID ? (
                        <Tr key={entry.ID} className="bg-slate-50">
                            <Td>{entry.EXPENSE_DATE}</Td>
                            {!isScoped && <Td>{entry.WAREHOUSE_NAME}</Td>}
                            {CATEGORY_FIELDS.map(({ key }) => (
                                <Td key={key}>
                                    <input type="number" min="0" step="0.01" className="border border-slate-300 rounded px-2 py-1 w-24" value={editAmounts[key]} onChange={(e) => setEditAmounts((prev) => ({ ...prev, [key]: e.target.value }))} />
                                </Td>
                            ))}
                            <Td>
                                <input className="border border-slate-300 rounded px-2 py-1 w-full" value={editRemarks} onChange={(e) => setEditRemarks(e.target.value)} />
                            </Td>
                            <Td>
                                <div className="flex gap-2">
                                    <button onClick={() => saveEdit(entry.ID)} className="text-green-600 hover:text-green-700" title="Save"><Check size={16} /></button>
                                    <button onClick={cancelEdit} className="text-slate-400 hover:text-slate-600" title="Cancel"><X size={16} /></button>
                                </div>
                            </Td>
                        </Tr>
                    ) : (
                        <Tr key={entry.ID}>
                            <Td>{entry.EXPENSE_DATE}</Td>
                            {!isScoped && <Td>{entry.WAREHOUSE_NAME}</Td>}
                            <Td>{entry.TRANSPORT_AMOUNT.toFixed(2)}</Td>
                            <Td>{entry.FUEL_AMOUNT.toFixed(2)}</Td>
                            <Td>{entry.LABOUR_AMOUNT.toFixed(2)}</Td>
                            <Td>{entry.MEALS_AMOUNT.toFixed(2)}</Td>
                            <Td>{entry.OTHER_AMOUNT.toFixed(2)}</Td>
                            <Td>{entry.REMARKS}</Td>
                            <Td>
                                <button onClick={() => startEdit(entry)} className="text-slate-500 hover:text-brand-600" title="Edit"><Pencil size={16} /></button>
                            </Td>
                        </Tr>
                    )
                )}
            </Table>
        </div>
    );
};

export default Expenses;
