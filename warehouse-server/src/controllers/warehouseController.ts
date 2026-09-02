import { Request, Response } from 'express';
import { execute } from '../db/dbUtils';

export const getWarehouses = async (req: Request, res: Response) => {
    try {
        const result = await execute<any>(`
            SELECT w.id, w.name, w.code, w.address, w.status,
                   COUNT(d.id)::int AS department_count
            FROM warehouses w
            LEFT JOIN departments d ON d.warehouse_id = w.id
            GROUP BY w.id
            ORDER BY w.name
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('getWarehouses error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const getWarehouseById = async (req: Request, res: Response) => {
    try {
        const warehouseResult = await execute<any>(`SELECT * FROM warehouses WHERE id = :id`, [req.params.id]);
        if (warehouseResult.rows.length === 0) {
            return res.status(404).json({ message: 'Warehouse not found' });
        }
        const warehouse = warehouseResult.rows[0];

        const deptResult = await execute<any>(
            `SELECT d.id, d.name, d.code, d.status, d.current_box_count, d.company_id, c.name AS company_name
             FROM departments d
             JOIN companies c ON c.id = d.company_id
             WHERE d.warehouse_id = :id
             ORDER BY d.name`,
            [req.params.id]
        );
        warehouse.DEPARTMENTS = deptResult.rows;

        res.json(warehouse);
    } catch (err) {
        console.error('getWarehouseById error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const createWarehouse = async (req: Request, res: Response) => {
    const { name, code, address } = req.body;
    try {
        const result = await execute<any>(
            `INSERT INTO warehouses (name, code, address) VALUES (:name, :code, :address) RETURNING *`,
            { name, code: code || null, address: address || null }
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('createWarehouse error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const updateWarehouse = async (req: Request, res: Response) => {
    const fields = req.body;
    const setClauses = Object.keys(fields).map(key => `${key} = :${key}`).join(', ');
    try {
        const result = await execute<any>(
            `UPDATE warehouses SET ${setClauses} WHERE id = :id RETURNING *`,
            { ...fields, id: req.params.id }
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Warehouse not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('updateWarehouse error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};
