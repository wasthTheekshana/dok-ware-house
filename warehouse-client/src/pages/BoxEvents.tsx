import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Pencil, Trash2, Check, X } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import type { Company, Department, BoxEvent, BoxEventType } from '../types';

const EVENT_TYPES: { value: BoxEventType; label: string }[] = [
    { value: 'archived', label: 'Archived (new boxes)' },
    { value: 'retrieved', label: 'Retrieved' },
    { value: 'empty_carton_issued', label: 'Empty Carton Issued' },
];

const BoxEvents: React.FC = () => {
    const { user } = useAuth();
    const isAdmin = user?.ROLE === 'admin';

    const [companies, setCompanies] = useState<Company[]>([]);
    const [events, setEvents] = useState<BoxEvent[]>([]);
    const [loading, setLoading] = useState(true);

    const [editingId, setEditingId] = useState<number | null>(null);
    const [editQuantity, setEditQuantity] = useState('');
    const [editEventDate, setEditEventDate] = useState('');
    const [editEventType, setEditEventType] = useState<BoxEventType>('archived');
    const [editReferenceNo, setEditReferenceNo] = useState('');

    const [companyId, setCompanyId] = useState('');
    const [departmentId, setDepartmentId] = useState('');
    const [departments, setDepartments] = useState<Department[]>([]);
    const [eventType, setEventType] = useState<BoxEventType>('archived');
    const [quantity, setQuantity] = useState('');
    const [eventDate, setEventDate] = useState('');
    const [referenceNo, setReferenceNo] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const loadEvents = () => {
        api.get<BoxEvent[]>('/box-events').then((res) => setEvents(res.data));
    };

    useEffect(() => {
        Promise.all([
            api.get<Company[]>('/companies'),
            api.get<BoxEvent[]>('/box-events'),
        ]).then(([companiesRes, eventsRes]) => {
            setCompanies(companiesRes.data);
            setEvents(eventsRes.data);
        }).finally(() => setLoading(false));
    }, []);

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

    const selectedCompany = companies.find((c) => String(c.ID) === companyId);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            await api.post('/box-events', {
                department_id: Number(departmentId),
                event_type: eventType,
                quantity: Number(quantity),
                event_date: eventDate,
                reference_no: referenceNo || undefined,
            });
            toast.success('Event logged');
            setQuantity('');
            setReferenceNo('');
            loadEvents();
            loadDepartments(companyId);
        } catch (err: any) {
            toast.error(err?.response?.data?.message || 'Failed to log event');
        } finally {
            setSubmitting(false);
        }
    };

    const startEdit = (event: BoxEvent) => {
        setEditingId(event.ID);
        setEditQuantity(String(event.QUANTITY));
        setEditEventDate(event.EVENT_DATE);
        setEditEventType(event.EVENT_TYPE);
        setEditReferenceNo(event.REFERENCE_NO || '');
    };

    const cancelEdit = () => setEditingId(null);

    const saveEdit = async (id: number) => {
        try {
            await api.put(`/box-events/${id}`, {
                quantity: Number(editQuantity),
                event_date: editEventDate,
                event_type: editEventType,
                reference_no: editReferenceNo || undefined,
            });
            toast.success('Event updated');
            setEditingId(null);
            loadEvents();
            loadDepartments(companyId);
        } catch (err: any) {
            toast.error(err?.response?.data?.message || 'Failed to update event');
        }
    };

    const deleteEvent = async (id: number) => {
        if (!window.confirm('Delete this box event? This will reverse its effect on the department count.')) return;
        try {
            await api.delete(`/box-events/${id}`);
            toast.success('Event deleted');
            loadEvents();
            loadDepartments(companyId);
        } catch (err: any) {
            toast.error(err?.response?.data?.message || 'Failed to delete event');
        }
    };

    if (loading) return <div>Loading...</div>;

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-bold text-slate-800">Box Events</h1>

            <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 p-4 grid grid-cols-6 gap-3 items-end">
                <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Company</label>
                    <select className="border border-slate-300 rounded-lg px-3 py-2 w-full" value={companyId} onChange={(e) => { setCompanyId(e.target.value); setDepartmentId(''); }} required>
                        <option value="">Select...</option>
                        {companies.map((c) => (
                            <option key={c.ID} value={c.ID}>{c.NAME}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Department</label>
                    <select className="border border-slate-300 rounded-lg px-3 py-2 w-full" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} required disabled={!selectedCompany}>
                        <option value="">Select...</option>
                        {departments.map((d) => (
                            <option key={d.ID} value={d.ID}>{d.NAME} — {d.WAREHOUSE_NAME} ({d.CURRENT_BOX_COUNT})</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Event Type</label>
                    <select className="border border-slate-300 rounded-lg px-3 py-2 w-full" value={eventType} onChange={(e) => setEventType(e.target.value as BoxEventType)}>
                        {EVENT_TYPES.map((t) => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Quantity</label>
                    <input type="number" min="1" className="border border-slate-300 rounded-lg px-3 py-2 w-full" value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Date</label>
                    <input type="date" className="border border-slate-300 rounded-lg px-3 py-2 w-full" value={eventDate} onChange={(e) => setEventDate(e.target.value)} required />
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Reference No.</label>
                    <input className="border border-slate-300 rounded-lg px-3 py-2 w-full" value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} />
                </div>
                <div className="col-span-6">
                    <button type="submit" disabled={submitting} className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                        {submitting ? 'Logging...' : 'Log Event'}
                    </button>
                </div>
            </form>

            <div className="bg-white rounded-xl border border-slate-200">
                <table className="w-full text-sm">
                    <thead className="text-left text-slate-500">
                        <tr>
                            <th className="p-3">Date</th>
                            <th className="p-3">Company</th>
                            <th className="p-3">Department</th>
                            <th className="p-3">Type</th>
                            <th className="p-3">Qty</th>
                            <th className="p-3">Reference</th>
                            {isAdmin && <th className="p-3">Actions</th>}
                        </tr>
                    </thead>
                    <tbody>
                        {events.map((e) =>
                            editingId === e.ID ? (
                                <tr key={e.ID} className="border-t border-slate-100 bg-slate-50">
                                    <td className="p-2">
                                        <input type="date" className="border border-slate-300 rounded px-2 py-1 w-full" value={editEventDate} onChange={(ev) => setEditEventDate(ev.target.value)} />
                                    </td>
                                    <td className="p-3">{e.COMPANY_NAME}</td>
                                    <td className="p-3">{e.DEPARTMENT_NAME}</td>
                                    <td className="p-2">
                                        <select className="border border-slate-300 rounded px-2 py-1 w-full" value={editEventType} onChange={(ev) => setEditEventType(ev.target.value as BoxEventType)}>
                                            {EVENT_TYPES.map((t) => (
                                                <option key={t.value} value={t.value}>{t.label}</option>
                                            ))}
                                        </select>
                                    </td>
                                    <td className="p-2">
                                        <input type="number" min="1" className="border border-slate-300 rounded px-2 py-1 w-20" value={editQuantity} onChange={(ev) => setEditQuantity(ev.target.value)} />
                                    </td>
                                    <td className="p-2">
                                        <input className="border border-slate-300 rounded px-2 py-1 w-full" value={editReferenceNo} onChange={(ev) => setEditReferenceNo(ev.target.value)} />
                                    </td>
                                    <td className="p-2">
                                        <div className="flex gap-2">
                                            <button onClick={() => saveEdit(e.ID)} className="text-green-600 hover:text-green-700" title="Save"><Check size={16} /></button>
                                            <button onClick={cancelEdit} className="text-slate-400 hover:text-slate-600" title="Cancel"><X size={16} /></button>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                <tr key={e.ID} className="border-t border-slate-100">
                                    <td className="p-3">{e.EVENT_DATE}</td>
                                    <td className="p-3">{e.COMPANY_NAME}</td>
                                    <td className="p-3">{e.DEPARTMENT_NAME}</td>
                                    <td className="p-3 capitalize">{e.EVENT_TYPE.replace('_', ' ')}</td>
                                    <td className="p-3">{e.QUANTITY}</td>
                                    <td className="p-3">{e.REFERENCE_NO}</td>
                                    {isAdmin && (
                                        <td className="p-3">
                                            <div className="flex gap-2">
                                                <button onClick={() => startEdit(e)} className="text-slate-500 hover:text-blue-600" title="Edit"><Pencil size={16} /></button>
                                                <button onClick={() => deleteEvent(e.ID)} className="text-slate-500 hover:text-red-600" title="Delete"><Trash2 size={16} /></button>
                                            </div>
                                        </td>
                                    )}
                                </tr>
                            )
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default BoxEvents;
