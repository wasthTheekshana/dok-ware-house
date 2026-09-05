import { Request, Response } from 'express';
import { execute } from '../db/dbUtils';

export function warehouseScope(req: Request): number[] | null {
    const user = (req as any).user;
    if (!user || user.role !== 'warehouse_admin') return null;
    return user.warehouse_ids || [];
}

const AMOUNT_FIELDS = ['transport_amount', 'fuel_amount', 'labour_amount', 'meals_amount', 'other_amount'] as const;

export const createExpense = async (req: Request, res: Response) => {
    const { warehouse_id, expense_date, remarks, ...amounts } = req.body;
    const userId = (req as any).user?.id ?? null;
    const scope = warehouseScope(req);

    if (scope !== null && !scope.includes(warehouse_id)) {
        return res.status(400).json({ message: 'warehouse_id is outside your assigned warehouses' });
    }

    try {
        const fields: any = { warehouse_id, expense_date, remarks: remarks || null, created_by: userId };
        for (const key of AMOUNT_FIELDS) {
            fields[key] = amounts[key] ?? 0;
        }

        const result = await execute<any>(
            `INSERT INTO warehouse_expenses
                (warehouse_id, expense_date, transport_amount, fuel_amount, labour_amount, meals_amount, other_amount, remarks, created_by)
             VALUES
                (:warehouse_id, :expense_date, :transport_amount, :fuel_amount, :labour_amount, :meals_amount, :other_amount, :remarks, :created_by)
             RETURNING *`,
            fields
        );
        res.status(201).json(result.rows[0]);
    } catch (err: any) {
        if (err.code === '23505') {
            return res.status(409).json({ message: 'An expense entry already exists for this warehouse and date' });
        }
        console.error('createExpense error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const getExpenses = async (req: Request, res: Response) => {
    const { warehouse_id, from, to } = req.query;
    const scope = warehouseScope(req);
    try {
        let query = `
            SELECT we.*, w.name AS warehouse_name
            FROM warehouse_expenses we
            JOIN warehouses w ON w.id = we.warehouse_id
            WHERE 1=1
        `;
        const params: any = {};
        if (warehouse_id) { query += ` AND we.warehouse_id = :warehouse_id`; params.warehouse_id = warehouse_id; }
        if (from) { query += ` AND we.expense_date >= :from`; params.from = from; }
        if (to) { query += ` AND we.expense_date <= :to`; params.to = to; }
        if (scope !== null) { query += ` AND we.warehouse_id = ANY(:warehouse_ids)`; params.warehouse_ids = scope; }
        query += ` ORDER BY we.expense_date DESC, we.id DESC LIMIT 500`;

        const result = await execute<any>(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('getExpenses error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const updateExpense = async (req: Request, res: Response) => {
    const { id } = req.params;
    const fields = req.body;
    const scope = warehouseScope(req);

    try {
        let existingQuery = `SELECT id FROM warehouse_expenses WHERE id = :id`;
        const existingParams: any = { id };
        if (scope !== null) {
            existingQuery += ` AND warehouse_id = ANY(:warehouse_ids)`;
            existingParams.warehouse_ids = scope;
        }
        const existingResult = await execute<any>(existingQuery, existingParams);
        if (existingResult.rows.length === 0) {
            return res.status(404).json({ message: 'Expense entry not found' });
        }

        const setClauses = Object.keys(fields).map(key => `${key} = :${key}`).join(', ');
        const result = await execute<any>(
            `UPDATE warehouse_expenses SET ${setClauses}, updated_at = now() WHERE id = :id RETURNING *`,
            { ...fields, id }
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('updateExpense error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const deleteExpense = async (req: Request, res: Response) => {
    const { id } = req.params;
    const scope = warehouseScope(req);

    try {
        let existingQuery = `SELECT id FROM warehouse_expenses WHERE id = :id`;
        const existingParams: any = { id };
        if (scope !== null) {
            existingQuery += ` AND warehouse_id = ANY(:warehouse_ids)`;
            existingParams.warehouse_ids = scope;
        }
        const existingResult = await execute<any>(existingQuery, existingParams);
        if (existingResult.rows.length === 0) {
            return res.status(404).json({ message: 'Expense entry not found' });
        }

        await execute(`DELETE FROM warehouse_expenses WHERE id = :id`, { id });
        res.json({ message: 'Expense entry deleted' });
    } catch (err) {
        console.error('deleteExpense error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};
