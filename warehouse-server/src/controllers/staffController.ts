import { Request, Response } from 'express';
import { execute } from '../db/dbUtils';

export function warehouseScope(req: Request): number[] | null {
    const user = (req as any).user;
    if (!user || user.role !== 'warehouse_admin') return null;
    return user.warehouse_ids || [];
}

export const getStaff = async (req: Request, res: Response) => {
    const { warehouse_id, status } = req.query;
    const scope = warehouseScope(req);
    try {
        let query = `
            SELECT s.*, w.name AS warehouse_name
            FROM staff s
            JOIN warehouses w ON w.id = s.warehouse_id
            WHERE 1=1
        `;
        const params: any = {};
        if (warehouse_id) { query += ` AND s.warehouse_id = :warehouse_id`; params.warehouse_id = warehouse_id; }
        if (status) { query += ` AND s.status = :status`; params.status = status; }
        if (scope !== null) { query += ` AND s.warehouse_id = ANY(:warehouse_ids)`; params.warehouse_ids = scope; }
        query += ` ORDER BY s.name`;

        const result = await execute<any>(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('getStaff error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const createStaff = async (req: Request, res: Response) => {
    const { warehouse_id, name, nic, designation, join_date, basic_salary, epf_no } = req.body;
    const scope = warehouseScope(req);

    if (scope !== null && !scope.includes(warehouse_id)) {
        return res.status(400).json({ message: 'warehouse_id is outside your assigned warehouses' });
    }

    try {
        const result = await execute<any>(
            `INSERT INTO staff (warehouse_id, name, nic, designation, join_date, basic_salary, epf_no)
             VALUES (:warehouse_id, :name, :nic, :designation, :join_date, :basic_salary, :epf_no)
             RETURNING *`,
            {
                warehouse_id, name, nic,
                designation: designation || null,
                join_date,
                basic_salary: basic_salary ?? 0,
                epf_no: epf_no || null,
            }
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('createStaff error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const updateStaff = async (req: Request, res: Response) => {
    const { id } = req.params;
    const fields = req.body;
    const scope = warehouseScope(req);

    try {
        let existingQuery = `SELECT id FROM staff WHERE id = :id`;
        const existingParams: any = { id };
        if (scope !== null) {
            existingQuery += ` AND warehouse_id = ANY(:warehouse_ids)`;
            existingParams.warehouse_ids = scope;
        }
        const existingResult = await execute<any>(existingQuery, existingParams);
        if (existingResult.rows.length === 0) {
            return res.status(404).json({ message: 'Staff member not found' });
        }

        const setClauses = Object.keys(fields).map(key => `${key} = :${key}`).join(', ');
        const result = await execute<any>(
            `UPDATE staff SET ${setClauses} WHERE id = :id RETURNING *`,
            { ...fields, id }
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('updateStaff error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};
