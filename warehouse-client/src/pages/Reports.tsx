import React, { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts';
import api from '../services/api';
import type { CompanySummaryRow, MonthlySummaryRow } from '../types';
import { Card, PageHeader, Table, Td, Tr } from '../components/ui';

const Reports: React.FC = () => {
    const [companySummary, setCompanySummary] = useState<CompanySummaryRow[]>([]);
    const [monthlySummary, setMonthlySummary] = useState<MonthlySummaryRow[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        Promise.all([
            api.get<CompanySummaryRow[]>('/summary/companies'),
            api.get<MonthlySummaryRow[]>('/summary/monthly'),
        ]).then(([companyRes, monthlyRes]) => {
            setCompanySummary(companyRes.data);
            setMonthlySummary(monthlyRes.data);
        }).finally(() => setLoading(false));
    }, []);

    if (loading) return <div>Loading...</div>;

    return (
        <div className="space-y-6">
            <PageHeader title="Reports" />

            <Card>
                <h2 className="font-semibold text-slate-700 mb-4">Monthly Box Activity</h2>
                <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={monthlySummary}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="MONTH" />
                        <YAxis />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="ARCHIVED" fill="#2563eb" name="Archived" />
                        <Bar dataKey="RETRIEVED" fill="#dc2626" name="Retrieved" />
                        <Bar dataKey="EMPTY_CARTON_ISSUED" fill="#16a34a" name="Empty Cartons" />
                    </BarChart>
                </ResponsiveContainer>
            </Card>

            <Table headers={['Company', 'Total Boxes']} title="Company-wise Box Summary" empty={companySummary.length === 0}>
                {companySummary.map((c) => (
                    <Tr key={c.COMPANY_ID}>
                        <Td>{c.COMPANY_NAME}</Td>
                        <Td>{c.TOTAL_BOX_COUNT.toLocaleString()}</Td>
                    </Tr>
                ))}
            </Table>
        </div>
    );
};

export default Reports;
