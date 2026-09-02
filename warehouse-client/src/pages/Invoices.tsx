import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import type { Company, Department, Invoice, InvoiceBreakdown } from '../types';

const Invoices: React.FC = () => {
    const { user } = useAuth();
    const isAdmin = user?.ROLE === 'admin';

    const [companies, setCompanies] = useState<Company[]>([]);
    const [departments, setDepartments] = useState<Department[]>([]);
    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [loading, setLoading] = useState(isAdmin);

    const [companyId, setCompanyId] = useState('');
    const [departmentId, setDepartmentId] = useState('');
    const [periodFrom, setPeriodFrom] = useState('');
    const [periodTo, setPeriodTo] = useState('');
    const [preview, setPreview] = useState<InvoiceBreakdown | null>(null);
    const [previewing, setPreviewing] = useState(false);
    const [saving, setSaving] = useState(false);

    const loadInvoices = () => {
        api.get<Invoice[]>('/invoices').then((res) => setInvoices(res.data));
    };

    useEffect(() => {
        if (!isAdmin) return;
        Promise.all([
            api.get<Company[]>('/companies'),
            api.get<Invoice[]>('/invoices'),
        ]).then(([companiesRes, invoicesRes]) => {
            setCompanies(companiesRes.data);
            setInvoices(invoicesRes.data);
        }).finally(() => setLoading(false));
    }, [isAdmin]);

    const loadDepartments = (forCompanyId: string) => {
        if (!forCompanyId) {
            setDepartments([]);
            return;
        }
        api.get<Department[]>('/departments', { params: { company_id: forCompanyId } })
            .then((res) => setDepartments(res.data));
    };

    useEffect(() => {
        loadDepartments(companyId);
    }, [companyId]);

    const handlePreview = async () => {
        setPreviewing(true);
        setPreview(null);
        try {
            const res = await api.post<InvoiceBreakdown>('/invoices/preview', {
                department_id: Number(departmentId),
                period_from: periodFrom,
                period_to: periodTo,
            });
            setPreview(res.data);
        } catch (err: any) {
            toast.error(err?.response?.data?.message || 'Failed to generate preview');
        } finally {
            setPreviewing(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await api.post('/invoices', {
                department_id: Number(departmentId),
                period_from: periodFrom,
                period_to: periodTo,
            });
            toast.success('Invoice saved');
            setPreview(null);
            loadInvoices();
        } catch (err: any) {
            toast.error(err?.response?.data?.message || 'Failed to save invoice');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: number) => {
        if (!window.confirm('Delete this invoice?')) return;
        try {
            await api.delete(`/invoices/${id}`);
            toast.success('Invoice deleted');
            loadInvoices();
        } catch (err: any) {
            toast.error(err?.response?.data?.message || 'Failed to delete invoice');
        }
    };

    if (!isAdmin) return <div className="text-slate-500">You don't have access to this page.</div>;
    if (loading) return <div>Loading...</div>;

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-bold text-slate-800">Invoices</h1>

            <div className="bg-white rounded-xl border border-slate-200 p-4 grid grid-cols-5 gap-3 items-end">
                <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Company</label>
                    <select className="border border-slate-300 rounded-lg px-3 py-2 w-full" value={companyId} onChange={(e) => { setCompanyId(e.target.value); setDepartmentId(''); setPreview(null); }}>
                        <option value="">Select...</option>
                        {companies.map((c) => (
                            <option key={c.ID} value={c.ID}>{c.NAME}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Department</label>
                    <select className="border border-slate-300 rounded-lg px-3 py-2 w-full" value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); setPreview(null); }} disabled={!companyId}>
                        <option value="">Select...</option>
                        {departments.map((d) => (
                            <option key={d.ID} value={d.ID}>{d.NAME}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Period From</label>
                    <input type="date" className="border border-slate-300 rounded-lg px-3 py-2 w-full" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} />
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Period To</label>
                    <input type="date" className="border border-slate-300 rounded-lg px-3 py-2 w-full" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} />
                </div>
                <button
                    onClick={handlePreview}
                    disabled={!departmentId || !periodFrom || !periodTo || previewing}
                    className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                    {previewing ? 'Loading...' : 'Preview'}
                </button>
            </div>

            {preview && (
                <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
                    <h2 className="text-lg font-semibold text-slate-700">{preview.DEPARTMENT_NAME} — {preview.COMPANY_NAME}</h2>
                    <div className="text-sm text-slate-500">{preview.PERIOD_FROM} to {preview.PERIOD_TO}</div>
                    <table className="w-full text-sm">
                        <tbody>
                            <tr className="border-t border-slate-100">
                                <td className="p-2">Archived boxes</td>
                                <td className="p-2">{preview.ARCHIVED_COUNT} × {preview.PRICE_PER_ARCHIVED_BOX}</td>
                            </tr>
                            <tr className="border-t border-slate-100">
                                <td className="p-2">Retrieved boxes</td>
                                <td className="p-2">{preview.RETRIEVED_COUNT} × {preview.PRICE_PER_RETRIEVED_BOX}</td>
                            </tr>
                            <tr className="border-t border-slate-100">
                                <td className="p-2">Empty cartons</td>
                                <td className="p-2">{preview.EMPTY_CARTON_COUNT} × {preview.PRICE_PER_EMPTY_CARTON}</td>
                            </tr>
                            <tr className="border-t border-slate-200 font-medium">
                                <td className="p-2">Subtotal</td>
                                <td className="p-2">{preview.SUBTOTAL}</td>
                            </tr>
                            <tr className="border-t border-slate-100">
                                <td className="p-2">SSCL</td>
                                <td className="p-2">{preview.SSCL_AMOUNT}</td>
                            </tr>
                            <tr className="border-t border-slate-100">
                                <td className="p-2">VAT</td>
                                <td className="p-2">{preview.VAT_AMOUNT}</td>
                            </tr>
                            <tr className="border-t border-slate-200 font-bold">
                                <td className="p-2">Total</td>
                                <td className="p-2">{preview.TOTAL_AMOUNT}</td>
                            </tr>
                        </tbody>
                    </table>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="bg-green-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                    >
                        {saving ? 'Saving...' : 'Save Invoice'}
                    </button>
                </div>
            )}

            <div className="bg-white rounded-xl border border-slate-200">
                <div className="p-4 border-b border-slate-200 font-semibold text-slate-700">Saved Invoices</div>
                <table className="w-full text-sm">
                    <thead className="text-left text-slate-500">
                        <tr>
                            <th className="p-3">Period</th>
                            <th className="p-3">Company</th>
                            <th className="p-3">Department</th>
                            <th className="p-3">Total</th>
                            <th className="p-3">Saved</th>
                            <th className="p-3">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {invoices.map((inv) => (
                            <tr key={inv.ID} className="border-t border-slate-100">
                                <td className="p-3">{inv.PERIOD_FROM} to {inv.PERIOD_TO}</td>
                                <td className="p-3">{inv.COMPANY_NAME}</td>
                                <td className="p-3">{inv.DEPARTMENT_NAME}</td>
                                <td className="p-3">{inv.TOTAL_AMOUNT}</td>
                                <td className="p-3">{inv.CREATED_AT}</td>
                                <td className="p-3">
                                    <button onClick={() => handleDelete(inv.ID)} className="text-red-600 hover:text-red-700 text-xs font-medium">Delete</button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default Invoices;
