import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import type { Company, Department, Invoice, InvoiceBreakdown } from '../types';
import { PageHeader, Card, Table, Td, Tr, Badge, Button } from '../components/ui';

const Invoices: React.FC = () => {
    const { user } = useAuth();
    const canViewInvoices = user?.EFFECTIVE_PERMISSIONS?.includes('view_invoices') ?? false;
    const canManageInvoices = user?.EFFECTIVE_PERMISSIONS?.includes('manage_invoices') ?? false;

    const [companies, setCompanies] = useState<Company[]>([]);
    const [departments, setDepartments] = useState<Department[]>([]);
    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [loading, setLoading] = useState(canViewInvoices);

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
        if (!canViewInvoices) return;
        Promise.all([
            api.get<Company[]>('/companies'),
            api.get<Invoice[]>('/invoices'),
        ]).then(([companiesRes, invoicesRes]) => {
            setCompanies(companiesRes.data);
            setInvoices(invoicesRes.data);
        }).finally(() => setLoading(false));
    }, [canViewInvoices]);

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

    const handleReverse = async (id: number) => {
        if (!window.confirm('Reverse this invoice? This will create a negative correcting entry.')) return;
        try {
            await api.post(`/invoices/${id}/reverse`);
            toast.success('Invoice reversed');
            loadInvoices();
        } catch (err: any) {
            toast.error(err?.response?.data?.message || 'Failed to reverse invoice');
        }
    };

    const reversedOriginalIds = new Set(
        invoices.filter((inv) => inv.REVERSES_INVOICE_ID !== null).map((inv) => inv.REVERSES_INVOICE_ID)
    );

    if (!canViewInvoices) return <div className="text-slate-500">You don't have access to this page.</div>;
    if (loading) return <div>Loading...</div>;

    return (
        <div className="space-y-6">
            <PageHeader title="Invoices" />

            <Card className="grid grid-cols-5 gap-3 items-end">
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
                    <input type="date" className="border border-slate-300 rounded-lg px-3 py-2 w-full" value={periodFrom} onChange={(e) => { setPeriodFrom(e.target.value); setPreview(null); }} />
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Period To</label>
                    <input type="date" className="border border-slate-300 rounded-lg px-3 py-2 w-full" value={periodTo} onChange={(e) => { setPeriodTo(e.target.value); setPreview(null); }} />
                </div>
                <Button
                    onClick={handlePreview}
                    disabled={!canManageInvoices || !departmentId || !periodFrom || !periodTo || previewing}
                >
                    {previewing ? 'Loading...' : 'Preview'}
                </Button>
            </Card>

            {preview && (
                <Card className="space-y-3">
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
                            <tr className="border-t border-slate-100">
                                <td className="p-2">Storage rental</td>
                                <td className="p-2">{preview.BOX_COUNT_AT_BILLING} boxes × {preview.STORAGE_RENTAL_AMOUNT / (preview.BOX_COUNT_AT_BILLING || 1)} = {preview.STORAGE_RENTAL_AMOUNT}</td>
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
                    <Button
                        variant="primary"
                        onClick={handleSave}
                        disabled={saving}
                    >
                        {saving ? 'Saving...' : 'Save Invoice'}
                    </Button>
                </Card>
            )}

            <Table headers={['Period', 'Company', 'Department', 'Total', 'Saved', 'Actions']} title="Saved Invoices" empty={invoices.length === 0}>
                {invoices.map((inv) => (
                    <Tr key={inv.ID}>
                        <Td>{inv.PERIOD_FROM} to {inv.PERIOD_TO}</Td>
                        <Td>{inv.COMPANY_NAME}</Td>
                        <Td>{inv.DEPARTMENT_NAME}</Td>
                        <Td>{inv.TOTAL_AMOUNT}</Td>
                        <Td>{inv.CREATED_AT}</Td>
                        <Td>
                            {canManageInvoices && inv.REVERSES_INVOICE_ID === null && !reversedOriginalIds.has(inv.ID) && (
                                <Button variant="danger" className="text-xs px-2 py-1" onClick={() => handleReverse(inv.ID)}>Reverse</Button>
                            )}
                            {inv.REVERSES_INVOICE_ID !== null && (
                                <Badge tone="neutral">Reversal of #{inv.REVERSES_INVOICE_ID}</Badge>
                            )}
                        </Td>
                    </Tr>
                ))}
            </Table>
        </div>
    );
};

export default Invoices;
