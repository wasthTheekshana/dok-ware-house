import { Request, Response } from 'express';
import { execute } from '../db/dbUtils';

export const getDepartments = async (req: Request, res: Response) => {
    const { company_id } = req.query;
    try {
        let query = `
            SELECT d.id, d.company_id, d.warehouse_id, d.name, d.code, d.status, d.current_box_count,
                   w.name AS warehouse_name
            FROM departments d
            JOIN warehouses w ON w.id = d.warehouse_id
            WHERE 1=1
        `;
        const params: any = {};
        if (company_id) {
            query += ` AND d.company_id = :company_id`;
            params.company_id = company_id;
        }
        query += ` ORDER BY d.name`;
        const result = await execute<any>(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('getDepartments error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const createDepartment = async (req: Request, res: Response) => {
    const { company_id, warehouse_id, name, code } = req.body;
    try {
        const companyCheck = await execute<any>(`SELECT id FROM companies WHERE id = :company_id`, [company_id]);
        if (companyCheck.rows.length === 0) {
            return res.status(400).json({ message: 'company_id does not reference an existing company' });
        }

        const warehouseCheck = await execute<any>(`SELECT id FROM warehouses WHERE id = :warehouse_id`, [warehouse_id]);
        if (warehouseCheck.rows.length === 0) {
            return res.status(400).json({ message: 'warehouse_id does not reference an existing warehouse' });
        }

        const result = await execute<any>(
            `INSERT INTO departments (company_id, warehouse_id, name, code) VALUES (:company_id, :warehouse_id, :name, :code) RETURNING *`,
            { company_id, warehouse_id, name, code: code || null }
        );
        res.status(201).json(result.rows[0]);
    } catch (err: any) {
        if (err.code === '23505') {
            return res.status(409).json({ message: 'A department with this name already exists for this company' });
        }
        console.error('createDepartment error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const updateDepartment = async (req: Request, res: Response) => {
    const fields = req.body;
    const setClauses = Object.keys(fields).map(key => `${key} = :${key}`).join(', ');
    try {
        const result = await execute<any>(
            `UPDATE departments SET ${setClauses} WHERE id = :id RETURNING *`,
            { ...fields, id: req.params.id }
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Department not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('updateDepartment error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};
