import React, { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts';
import api from '../services/api';
import type { CompanySummaryRow, MonthlySummaryRow } from '../types';

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
            <h1 className="text-2xl font-bold text-slate-800">Reports</h1>

            <div className="bg-white rounded-xl border border-slate-200 p-4">
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
            </div>

            <div className="bg-white rounded-xl border border-slate-200">
                <div className="p-4 border-b border-slate-200 font-semibold text-slate-700">Company-wise Box Summary</div>
                <table className="w-full text-sm">
                    <thead className="text-left text-slate-500">
                        <tr>
                            <th className="p-3">Company</th>
                            <th className="p-3">Total Boxes</th>
                        </tr>
                    </thead>
                    <tbody>
                        {companySummary.map((c) => (
                            <tr key={c.COMPANY_ID} className="border-t border-slate-100">
                                <td className="p-3">{c.COMPANY_NAME}</td>
                                <td className="p-3">{c.TOTAL_BOX_COUNT.toLocaleString()}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default Reports;
