import { Request, Response } from 'express';
import { execute } from '../db/dbUtils';

export const getCompanySummary = async (req: Request, res: Response) => {
    try {
        const result = await execute<any>(`
            SELECT c.id AS company_id, c.name AS company_name,
                   COALESCE(SUM(d.current_box_count), 0)::int AS total_box_count
            FROM companies c
            LEFT JOIN departments d ON d.company_id = c.id
            WHERE c.status = 'active'
            GROUP BY c.id, c.name
            ORDER BY total_box_count DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('getCompanySummary error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const getMonthlySummary = async (req: Request, res: Response) => {
    const { from, to } = req.query;
    try {
        let query = `
            SELECT date_trunc('month', event_date)::date AS month,
                   SUM(CASE WHEN event_type = 'archived' THEN quantity ELSE 0 END)::int AS archived,
                   SUM(CASE WHEN event_type = 'retrieved' THEN quantity ELSE 0 END)::int AS retrieved,
                   SUM(CASE WHEN event_type = 'empty_carton_issued' THEN quantity ELSE 0 END)::int AS empty_carton_issued
            FROM box_events
            WHERE 1=1
        `;
        const params: any = {};
        if (from) { query += ` AND event_date >= :from`; params.from = from; }
        if (to) { query += ` AND event_date <= :to`; params.to = to; }
        query += ` GROUP BY month ORDER BY month`;

        const result = await execute<any>(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('getMonthlySummary error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};
