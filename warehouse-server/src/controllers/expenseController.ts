import { Request, Response } from 'express';
import { execute } from '../db/dbUtils';
import { computeVariance } from '../utils/expenseVariance';

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

const CATEGORIES = ['transport_amount', 'fuel_amount', 'labour_amount', 'meals_amount', 'other_amount'] as const;

async function getMonthTotals(warehouseId: number, year: number, month: number): Promise<Record<string, number> | null> {
    const result = await execute<any>(
        `SELECT
            COALESCE(SUM(transport_amount), 0)::float AS transport_amount,
            COALESCE(SUM(fuel_amount), 0)::float AS fuel_amount,
            COALESCE(SUM(labour_amount), 0)::float AS labour_amount,
            COALESCE(SUM(meals_amount), 0)::float AS meals_amount,
            COALESCE(SUM(other_amount), 0)::float AS other_amount,
            COUNT(*)::int AS entry_count
         FROM warehouse_expenses
         WHERE warehouse_id = :warehouse_id
           AND date_trunc('month', expense_date) = make_date(:year::int, :month::int, 1)`,
        { warehouse_id: warehouseId, year, month }
    );
    const row = result.rows[0];
    if (row.ENTRY_COUNT === 0) return null;
    return {
        transport_amount: row.TRANSPORT_AMOUNT,
        fuel_amount: row.FUEL_AMOUNT,
        labour_amount: row.LABOUR_AMOUNT,
        meals_amount: row.MEALS_AMOUNT,
        other_amount: row.OTHER_AMOUNT,
    };
}

export const getExpenseSummary = async (req: Request, res: Response) => {
    const { year, month } = req.query as { year: string; month: string };
    const scope = warehouseScope(req);
    let warehouseId: number | null = req.query.warehouse_id ? Number(req.query.warehouse_id) : null;

    if (scope !== null) {
        warehouseId = scope[0] ?? null;
    }
    if (!warehouseId) {
        return res.status(400).json({ message: 'warehouse_id is required' });
    }

    try {
        const y = Number(year);
        const m = Number(month);
        const priorY = m === 1 ? y - 1 : y;
        const priorM = m === 1 ? 12 : m - 1;

        const current = await getMonthTotals(warehouseId, y, m);
        const prior = await getMonthTotals(warehouseId, priorY, priorM);

        const categories: Record<string, any> = {};
        for (const cat of CATEGORIES) {
            const currentVal = current ? current[cat] : 0;
            const priorVal = prior ? prior[cat] : null;
            categories[cat] = {
                current: currentVal,
                variance: computeVariance(currentVal, priorVal),
            };
        }

        res.json({ warehouse_id: warehouseId, year: y, month: m, categories });
    } catch (err) {
        console.error('getExpenseSummary error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const getExpenseComparison = async (req: Request, res: Response) => {
    const { year, month } = req.query as { year: string; month: string };
    const scope = warehouseScope(req);
    try {
        let query = `
            SELECT w.id AS warehouse_id, w.name AS warehouse_name,
                   COALESCE(SUM(we.transport_amount + we.fuel_amount + we.labour_amount + we.meals_amount + we.other_amount), 0)::float AS total_amount
            FROM warehouses w
            LEFT JOIN warehouse_expenses we ON we.warehouse_id = w.id
                AND date_trunc('month', we.expense_date) = make_date(:year::int, :month::int, 1)
            WHERE 1=1
        `;
        const params: any = { year: Number(year), month: Number(month) };
        if (scope !== null) {
            query += ` AND w.id = ANY(:warehouse_ids)`;
            params.warehouse_ids = scope;
        }
        query += ` GROUP BY w.id, w.name ORDER BY w.name`;

        const result = await execute<any>(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('getExpenseComparison error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};
