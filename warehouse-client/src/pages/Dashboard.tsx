import React, { useEffect, useMemo, useState } from 'react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import type { CompanySummaryRow, BoxEvent, Department, MonthlySummaryRow, Invoice } from '../types';
import { StatCard, Table, Td, Tr, Badge, PageHeader } from '../components/ui';
import type { BadgeTone } from '../components/ui';
import { Package, Building2, Wallet, Zap } from 'lucide-react';

const EVENT_BADGE: Record<string, BadgeTone> = {
    archived: 'success',
    retrieved: 'info',
    empty_carton_issued: 'neutral',
    disposed: 'danger',
};

const EVENT_LABEL: Record<string, string> = {
    archived: 'Archived',
    retrieved: 'Retrieved',
    empty_carton_issued: 'Empty Carton',
    disposed: 'Disposed',
};

function monthRange(): { from: string; to: string } {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    return { from, to };
}

function last6MonthsRange(): { from: string; to: string } {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString().slice(0, 10);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    return { from, to };
}

const Dashboard: React.FC = () => {
    const { user } = useAuth();
    const canViewInvoices = user?.EFFECTIVE_PERMISSIONS?.includes('view_invoices') ?? false;

    const [companies, setCompanies] = useState<CompanySummaryRow[]>([]);
    const [allEvents, setAllEvents] = useState<BoxEvent[]>([]);
    const [departments, setDepartments] = useState<Department[]>([]);
    const [monthly, setMonthly] = useState<MonthlySummaryRow[]>([]);
    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const { from, to } = last6MonthsRange();
        const requests: Promise<any>[] = [
            api.get<CompanySummaryRow[]>('/summary/companies'),
            api.get<BoxEvent[]>('/box-events'),
            api.get<Department[]>('/departments'),
            api.get<MonthlySummaryRow[]>(`/summary/monthly?from=${from}&to=${to}`),
        ];
        if (canViewInvoices) {
            requests.push(api.get<Invoice[]>('/invoices'));
        }
        Promise.all(requests).then(([companiesRes, eventsRes, deptsRes, monthlyRes, invoicesRes]) => {
            setCompanies(companiesRes.data);
            setAllEvents(eventsRes.data);
            setDepartments(deptsRes.data);
            setMonthly(monthlyRes.data);
            if (invoicesRes) setInvoices(invoicesRes.data);
        }).finally(() => setLoading(false));
    }, [canViewInvoices]);

    const totalBoxes = companies.reduce((sum, c) => sum + c.TOTAL_BOX_COUNT, 0);
    const recentEvents = allEvents.slice(0, 8);

    const eventsThisWeek = useMemo(() => {
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        return allEvents.filter((e) => new Date(e.EVENT_DATE) >= weekAgo);
    }, [allEvents]);

    const revenueThisMonth = useMemo(() => {
        const { from, to } = monthRange();
        return invoices
            .filter((inv) => inv.CREATED_AT >= from && inv.CREATED_AT <= `${to}T23:59:59`)
            .reduce((sum, inv) => sum + inv.TOTAL_AMOUNT, 0);
    }, [invoices]);

    const boxesByWarehouse = useMemo(() => {
        const map = new Map<string, number>();
        for (const d of departments) {
            const name = d.WAREHOUSE_NAME || 'Unknown';
            map.set(name, (map.get(name) || 0) + d.CURRENT_BOX_COUNT);
        }
        return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
    }, [departments]);

    const maxWarehouseCount = Math.max(1, ...boxesByWarehouse.map(([, count]) => count));

    const archivedRetrievedByMonth = monthly.map((m) => ({
        month: m.MONTH,
        total: m.ARCHIVED + m.RETRIEVED,
    }));
    const maxMonthTotal = Math.max(1, ...archivedRetrievedByMonth.map((m) => m.total));

    const archivedThisWeek = eventsThisWeek.filter((e) => e.EVENT_TYPE === 'archived').length;
    const retrievedThisWeek = eventsThisWeek.filter((e) => e.EVENT_TYPE === 'retrieved').length;

    if (loading) return <div className="text-slate-400 text-sm">Loading dashboard...</div>;

    return (
        <div className="space-y-5">
            <PageHeader title="Dashboard" subtitle="Here's what's happening across your warehouses today" />

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                    label="Total Boxes"
                    value={totalBoxes.toLocaleString()}
                    icon={Package}
                    accent="brand"
                />
                <StatCard
                    label="Active Companies"
                    value={String(companies.length)}
                    icon={Building2}
                    accent="sky"
                    trend={`across ${boxesByWarehouse.length} warehouse${boxesByWarehouse.length === 1 ? '' : 's'}`}
                />
                {canViewInvoices && (
                    <StatCard
                        label="Revenue This Month"
                        value={`LKR ${revenueThisMonth.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                        icon={Wallet}
                        accent="green"
                    />
                )}
                <StatCard
                    label="Events This Week"
                    value={String(eventsThisWeek.length)}
                    icon={Zap}
                    accent="amber"
                    trend={`${archivedThisWeek} archived, ${retrievedThisWeek} retrieved`}
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-4">
                <div className="bg-white rounded-card shadow-soft p-4">
                    <div className="text-sm font-semibold text-slate-700 mb-4">Box Movement — Last 6 Months</div>
                    <div className="flex items-end gap-3 h-28">
                        {archivedRetrievedByMonth.map((m) => (
                            <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                                <div
                                    className="w-full rounded-t bg-gradient-to-b from-brand-400 to-brand-600"
                                    style={{ height: `${Math.max(4, (m.total / maxMonthTotal) * 100)}%` }}
                                />
                                <div className="text-[10px] text-slate-400">
                                    {new Date(m.month).toLocaleDateString(undefined, { month: 'short' })}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="bg-white rounded-card shadow-soft p-4">
                    <div className="text-sm font-semibold text-slate-700 mb-4">Boxes by Warehouse</div>
                    {boxesByWarehouse.map(([name, count]) => (
                        <div key={name} className="mb-2.5 last:mb-0">
                            <div className="flex justify-between text-xs text-slate-500 mb-1">
                                <span>{name}</span>
                                <span className="font-semibold">{count.toLocaleString()}</span>
                            </div>
                            <div className="h-1.5 bg-slate-100 rounded-full">
                                <div
                                    className="h-full bg-brand-500 rounded-full"
                                    style={{ width: `${(count / maxWarehouseCount) * 100}%` }}
                                />
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <Table headers={['Date', 'Company', 'Department', 'Type', 'Qty']} title="Recent Box Events" empty={recentEvents.length === 0}>
                {recentEvents.map((e) => (
                    <Tr key={e.ID}>
                        <Td>{e.EVENT_DATE}</Td>
                        <Td>{e.COMPANY_NAME}</Td>
                        <Td>{e.DEPARTMENT_NAME}</Td>
                        <Td><Badge tone={EVENT_BADGE[e.EVENT_TYPE]}>{EVENT_LABEL[e.EVENT_TYPE]}</Badge></Td>
                        <Td>{e.QUANTITY}</Td>
                    </Tr>
                ))}
            </Table>
        </div>
    );
};

export default Dashboard;
