import React, { useEffect, useState } from 'react';
import api from '../services/api';
import type { CompanySummaryRow, BoxEvent } from '../types';

const Dashboard: React.FC = () => {
    const [companies, setCompanies] = useState<CompanySummaryRow[]>([]);
    const [recentEvents, setRecentEvents] = useState<BoxEvent[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        Promise.all([
            api.get<CompanySummaryRow[]>('/summary/companies'),
            api.get<BoxEvent[]>('/box-events'),
        ]).then(([companiesRes, eventsRes]) => {
            setCompanies(companiesRes.data);
            setRecentEvents(eventsRes.data.slice(0, 10));
        }).finally(() => setLoading(false));
    }, []);

    const totalBoxes = companies.reduce((sum, c) => sum + c.TOTAL_BOX_COUNT, 0);

    if (loading) return <div>Loading...</div>;

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-bold text-slate-800">Dashboard</h1>

            <div className="grid grid-cols-3 gap-4">
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                    <div className="text-sm text-slate-500">Total Boxes in Storage</div>
                    <div className="text-3xl font-bold text-slate-800">{totalBoxes.toLocaleString()}</div>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                    <div className="text-sm text-slate-500">Active Companies</div>
                    <div className="text-3xl font-bold text-slate-800">{companies.length}</div>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                    <div className="text-sm text-slate-500">Recent Events</div>
                    <div className="text-3xl font-bold text-slate-800">{recentEvents.length}</div>
                </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200">
                <div className="p-4 border-b border-slate-200 font-semibold text-slate-700">Recent Box Events</div>
                <table className="w-full text-sm">
                    <thead className="text-left text-slate-500">
                        <tr>
                            <th className="p-3">Date</th>
                            <th className="p-3">Company</th>
                            <th className="p-3">Department</th>
                            <th className="p-3">Type</th>
                            <th className="p-3">Qty</th>
                        </tr>
                    </thead>
                    <tbody>
                        {recentEvents.map((e) => (
                            <tr key={e.ID} className="border-t border-slate-100">
                                <td className="p-3">{e.EVENT_DATE}</td>
                                <td className="p-3">{e.COMPANY_NAME}</td>
                                <td className="p-3">{e.DEPARTMENT_NAME}</td>
                                <td className="p-3 capitalize">{e.EVENT_TYPE.replace('_', ' ')}</td>
                                <td className="p-3">{e.QUANTITY}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default Dashboard;
