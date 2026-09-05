import { Request, Response } from 'express';
import { execute } from '../db/dbUtils';

function warehouseScope(req: Request): number[] | null {
    const user = (req as any).user;
    if (!user || user.role !== 'warehouse_admin') return null;
    return user.warehouse_ids || [];
}

export const getCompanySummary = async (req: Request, res: Response) => {
    const scope = warehouseScope(req);
    try {
        let query = `
            SELECT c.id AS company_id, c.name AS company_name,
                   COALESCE(SUM(d.current_box_count), 0)::int AS total_box_count
            FROM companies c
            LEFT JOIN departments d ON d.company_id = c.id
            WHERE c.status = 'active'
        `;
        const params: any = {};
        if (scope !== null) {
            query += ` AND (d.id IS NULL OR d.warehouse_id = ANY(:warehouse_ids))`;
            params.warehouse_ids = scope;
        }
        query += ` GROUP BY c.id, c.name ORDER BY total_box_count DESC`;
        const result = await execute<any>(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('getCompanySummary error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const getMonthlySummary = async (req: Request, res: Response) => {
    const { from, to } = req.query;
    const scope = warehouseScope(req);
    try {
        let query = `
            SELECT date_trunc('month', be.event_date)::date AS month,
                   SUM(CASE WHEN be.event_type = 'archived' THEN be.quantity ELSE 0 END)::int AS archived,
                   SUM(CASE WHEN be.event_type = 'retrieved' THEN be.quantity ELSE 0 END)::int AS retrieved,
                   SUM(CASE WHEN be.event_type = 'empty_carton_issued' THEN be.quantity ELSE 0 END)::int AS empty_carton_issued
            FROM box_events be
        `;
        const params: any = {};
        if (scope !== null) {
            query += ` JOIN departments d ON d.id = be.department_id AND d.warehouse_id = ANY(:warehouse_ids)`;
            params.warehouse_ids = scope;
        }
        query += ` WHERE 1=1`;
        if (from) { query += ` AND be.event_date >= :from`; params.from = from; }
        if (to) { query += ` AND be.event_date <= :to`; params.to = to; }
        query += ` GROUP BY month ORDER BY month`;

        const result = await execute<any>(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('getMonthlySummary error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};
