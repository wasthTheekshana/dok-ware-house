import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Pencil, Trash2, Check, X } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import type { Company, Department, BoxEvent, BoxEventType } from '../types';
import { PageHeader, Card, Table, Td, Tr, Badge, Button } from '../components/ui';
import type { BadgeTone } from '../components/ui';

const EVENT_TYPES: { value: BoxEventType; label: string }[] = [
    { value: 'archived', label: 'Archived (new boxes)' },
    { value: 'retrieved', label: 'Retrieved' },
    { value: 'empty_carton_issued', label: 'Empty Carton Issued' },
    { value: 'disposed', label: 'Disposed' },
];

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

const BoxEvents: React.FC = () => {
    const { user } = useAuth();
    const canManageBoxEvents = user?.EFFECTIVE_PERMISSIONS?.includes('manage_box_events') ?? false;

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
        if (!canManageBoxEvents) return;
        Promise.all([
            api.get<Company[]>('/companies'),
            api.get<BoxEvent[]>('/box-events'),
        ]).then(([companiesRes, eventsRes]) => {
            setCompanies(companiesRes.data);
            setEvents(eventsRes.data);
        }).finally(() => setLoading(false));
    }, [canManageBoxEvents]);

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

    if (!canManageBoxEvents) return <div className="text-slate-500">You don't have access to this page.</div>;
    if (loading) return <div>Loading...</div>;

    const headers = ['Date', 'Company', 'Department', 'Type', 'Qty', 'Reference', ...(canManageBoxEvents ? ['Actions'] : [])];

    return (
        <div className="space-y-6">
            <PageHeader title="Box Events" />

            <Card>
                <form onSubmit={handleSubmit} className="grid grid-cols-6 gap-3 items-end">
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
                        <Button type="submit" disabled={submitting}>
                            {submitting ? 'Logging...' : 'Log Event'}
                        </Button>
                    </div>
                </form>
            </Card>

            <Table headers={headers} empty={events.length === 0}>
                {events.map((e) =>
                    editingId === e.ID ? (
                        <Tr key={e.ID} className="bg-slate-50">
                            <Td>
                                <input type="date" className="border border-slate-300 rounded px-2 py-1 w-full" value={editEventDate} onChange={(ev) => setEditEventDate(ev.target.value)} />
                            </Td>
                            <Td>{e.COMPANY_NAME}</Td>
                            <Td>{e.DEPARTMENT_NAME}</Td>
                            <Td>
                                <select className="border border-slate-300 rounded px-2 py-1 w-full" value={editEventType} onChange={(ev) => setEditEventType(ev.target.value as BoxEventType)}>
                                    {EVENT_TYPES.map((t) => (
                                        <option key={t.value} value={t.value}>{t.label}</option>
                                    ))}
                                </select>
                            </Td>
                            <Td>
                                <input type="number" min="1" className="border border-slate-300 rounded px-2 py-1 w-20" value={editQuantity} onChange={(ev) => setEditQuantity(ev.target.value)} />
                            </Td>
                            <Td>
                                <input className="border border-slate-300 rounded px-2 py-1 w-full" value={editReferenceNo} onChange={(ev) => setEditReferenceNo(ev.target.value)} />
                            </Td>
                            {canManageBoxEvents && (
                                <Td>
                                    <div className="flex gap-2">
                                        <button onClick={() => saveEdit(e.ID)} className="text-green-600 hover:text-green-700" title="Save"><Check size={16} /></button>
                                        <button onClick={cancelEdit} className="text-slate-400 hover:text-slate-600" title="Cancel"><X size={16} /></button>
                                    </div>
                                </Td>
                            )}
                        </Tr>
                    ) : (
                        <Tr key={e.ID}>
                            <Td>{e.EVENT_DATE}</Td>
                            <Td>{e.COMPANY_NAME}</Td>
                            <Td>{e.DEPARTMENT_NAME}</Td>
                            <Td><Badge tone={EVENT_BADGE[e.EVENT_TYPE]}>{EVENT_LABEL[e.EVENT_TYPE]}</Badge></Td>
                            <Td>{e.QUANTITY}</Td>
                            <Td>{e.REFERENCE_NO}</Td>
                            {canManageBoxEvents && (
                                <Td>
                                    <div className="flex gap-2">
                                        <button onClick={() => startEdit(e)} className="text-slate-500 hover:text-brand-600" title="Edit"><Pencil size={16} /></button>
                                        <button onClick={() => deleteEvent(e.ID)} className="text-slate-500 hover:text-red-600" title="Delete"><Trash2 size={16} /></button>
                                    </div>
                                </Td>
                            )}
                        </Tr>
                    )
                )}
            </Table>
        </div>
    );
};

export default BoxEvents;
