import { Request, Response } from 'express';
import { execute } from '../db/dbUtils';

export const getCompanies = async (req: Request, res: Response) => {
    try {
        const result = await execute<any>(`
            SELECT c.id, c.name, c.code, c.contact_person, c.phone, c.email, c.address, c.status,
                   COUNT(d.id)::int AS department_count,
                   COALESCE(SUM(d.current_box_count), 0)::int AS total_box_count
            FROM companies c
            LEFT JOIN departments d ON d.company_id = c.id
            GROUP BY c.id
            ORDER BY c.name
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('getCompanies error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const getCompanyById = async (req: Request, res: Response) => {
    try {
        const companyResult = await execute<any>(`SELECT * FROM companies WHERE id = :id`, [req.params.id]);
        if (companyResult.rows.length === 0) {
            return res.status(404).json({ message: 'Company not found' });
        }
        const company = companyResult.rows[0];

        const deptResult = await execute<any>(
            `SELECT d.id, d.name, d.code, d.status, d.current_box_count, d.warehouse_id, w.name AS warehouse_name,
                    d.price_per_archived_box, d.price_per_retrieved_box, d.price_per_empty_carton
             FROM departments d
             JOIN warehouses w ON w.id = d.warehouse_id
             WHERE d.company_id = :id
             ORDER BY d.name`,
            [req.params.id]
        );
        company.DEPARTMENTS = deptResult.rows;

        res.json(company);
    } catch (err) {
        console.error('getCompanyById error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const createCompany = async (req: Request, res: Response) => {
    const { name, code, contact_person, phone, email, address } = req.body;
    try {
        const result = await execute<any>(
            `INSERT INTO companies (name, code, contact_person, phone, email, address)
             VALUES (:name, :code, :contact_person, :phone, :email, :address)
             RETURNING *`,
            { name, code: code || null, contact_person: contact_person || null, phone: phone || null, email: email || null, address: address || null }
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('createCompany error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const updateCompany = async (req: Request, res: Response) => {
    const fields = req.body;
    const setClauses = Object.keys(fields).map(key => `${key} = :${key}`).join(', ');
    try {
        const result = await execute<any>(
            `UPDATE companies SET ${setClauses} WHERE id = :id RETURNING *`,
            { ...fields, id: req.params.id }
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Company not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('updateCompany error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};
