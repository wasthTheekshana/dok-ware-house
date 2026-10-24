import { Request, Response } from 'express';
import { execute, withTransaction } from '../db/dbUtils';
import { logAudit } from '../utils/auditLog';

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
        const insertedRow = await withTransaction(async (exec) => {
            const result = await exec<any>(
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
            await logAudit(exec, 'staff', result.rows[0].ID, 'create', (req as any).user?.id ?? null, null, result.rows[0]);
            return result.rows[0];
        });
        res.status(201).json(insertedRow);
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
        let existingQuery = `SELECT * FROM staff WHERE id = :id`;
        const existingParams: any = { id };
        if (scope !== null) {
            existingQuery += ` AND warehouse_id = ANY(:warehouse_ids)`;
            existingParams.warehouse_ids = scope;
        }
        const existingResult = await execute<any>(existingQuery, existingParams);
        if (existingResult.rows.length === 0) {
            return res.status(404).json({ message: 'Staff member not found' });
        }
        const before = existingResult.rows[0];

        const setClauses = Object.keys(fields).map(key => `${key} = :${key}`).join(', ');
        const updatedRow = await withTransaction(async (exec) => {
            const result = await exec<any>(
                `UPDATE staff SET ${setClauses} WHERE id = :id RETURNING *`,
                { ...fields, id }
            );
            if (result.rows.length === 0) {
                return null;
            }
            await logAudit(exec, 'staff', result.rows[0].ID, 'update', (req as any).user?.id ?? null, before, result.rows[0]);
            return result.rows[0];
        });
        if (!updatedRow) {
            return res.status(404).json({ message: 'Staff member not found' });
        }
        res.json(updatedRow);
    } catch (err) {
        console.error('updateStaff error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};
