import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import type { Warehouse } from '../types';
import { PageHeader, Card, Table, Td, Tr, Badge, Button } from '../components/ui';

const Warehouses: React.FC = () => {
    const { user } = useAuth();
    const canManageWarehouses = user?.EFFECTIVE_PERMISSIONS?.includes('manage_warehouses') ?? false;

    const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [name, setName] = useState('');
    const [code, setCode] = useState('');
    const [address, setAddress] = useState('');

    const load = () => {
        setLoading(true);
        api.get<Warehouse[]>('/warehouses').then((res) => setWarehouses(res.data)).finally(() => setLoading(false));
    };

    useEffect(load, []);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await api.post('/warehouses', { name, code: code || undefined, address: address || undefined });
            toast.success('Warehouse created');
            setName('');
            setCode('');
            setAddress('');
            setShowForm(false);
            load();
        } catch {
            toast.error('Failed to create warehouse');
        }
    };

    if (loading) return <div>Loading...</div>;

    return (
        <div className="space-y-6">
            <PageHeader
                title="Warehouses"
                action={
                    canManageWarehouses && (
                        <Button onClick={() => setShowForm(!showForm)}>
                            {showForm ? 'Cancel' : 'New Warehouse'}
                        </Button>
                    )
                }
            />

            {showForm && (
                <Card>
                    <form onSubmit={handleCreate} className="flex gap-3 items-end">
                        <div>
                            <label className="block text-sm font-medium text-slate-600 mb-1">Name</label>
                            <input className="border border-slate-300 rounded-lg px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} required />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-600 mb-1">Code</label>
                            <input className="border border-slate-300 rounded-lg px-3 py-2" value={code} onChange={(e) => setCode(e.target.value)} />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-600 mb-1">Address</label>
                            <input className="border border-slate-300 rounded-lg px-3 py-2" value={address} onChange={(e) => setAddress(e.target.value)} />
                        </div>
                        <Button type="submit">Save</Button>
                    </form>
                </Card>
            )}

            <Table headers={['Name', 'Code', 'Address', 'Departments', 'Status']} empty={warehouses.length === 0}>
                {warehouses.map((w) => (
                    <Tr key={w.ID}>
                        <Td className="font-medium">{w.NAME}</Td>
                        <Td>{w.CODE}</Td>
                        <Td>{w.ADDRESS}</Td>
                        <Td>{w.DEPARTMENT_COUNT}</Td>
                        <Td>
                            <Badge tone={w.STATUS === 'active' ? 'success' : 'neutral'}>{w.STATUS === 'active' ? 'Active' : 'Inactive'}</Badge>
                        </Td>
                    </Tr>
                ))}
            </Table>
        </div>
    );
};

export default Warehouses;
