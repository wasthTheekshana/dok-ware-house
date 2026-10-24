import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../services/api';
import type { Company } from '../types';
import { PageHeader, Card, Table, Td, Tr, Button } from '../components/ui';

const Companies: React.FC = () => {
    const [companies, setCompanies] = useState<Company[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [name, setName] = useState('');
    const [code, setCode] = useState('');

    const load = () => {
        setLoading(true);
        api.get<Company[]>('/companies').then((res) => setCompanies(res.data)).finally(() => setLoading(false));
    };

    useEffect(load, []);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await api.post('/companies', { name, code: code || undefined });
            toast.success('Company created');
            setName('');
            setCode('');
            setShowForm(false);
            load();
        } catch {
            toast.error('Failed to create company');
        }
    };

    if (loading) return <div>Loading...</div>;

    return (
        <div className="space-y-6">
            <PageHeader
                title="Companies"
                action={
                    <Button onClick={() => setShowForm(!showForm)}>
                        {showForm ? 'Cancel' : 'New Company'}
                    </Button>
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
                        <Button type="submit">Save</Button>
                    </form>
                </Card>
            )}

            <Table headers={['Name', 'Code', 'Departments', 'Total Boxes']} empty={companies.length === 0}>
                {companies.map((c) => (
                    <Tr key={c.ID}>
                        <Td>
                            <Link to={`/companies/${c.ID}`} className="text-blue-600 font-medium">{c.NAME}</Link>
                        </Td>
                        <Td>{c.CODE}</Td>
                        <Td>{c.DEPARTMENT_COUNT}</Td>
                        <Td>{c.TOTAL_BOX_COUNT}</Td>
                    </Tr>
                ))}
            </Table>
        </div>
    );
};

export default Companies;
