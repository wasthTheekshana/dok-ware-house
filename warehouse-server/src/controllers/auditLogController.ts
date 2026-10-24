import { Request, Response } from 'express';
import { execute } from '../db/dbUtils';

export const getAuditLog = async (req: Request, res: Response) => {
    if ((req as any).user?.role !== 'system_admin') {
        return res.status(403).json({ message: 'Only system_admin may view the audit log' });
    }
    const { table_name, record_id, actor_id, from, to } = req.query;
    try {
        let query = `
            SELECT al.*, u.username AS actor_username, u.name AS actor_name
            FROM audit_log al
            LEFT JOIN users u ON u.id = al.actor_id
            WHERE 1=1
        `;
        const params: any = {};
        if (table_name) { query += ` AND al.table_name = :table_name`; params.table_name = table_name; }
        if (record_id) { query += ` AND al.record_id = :record_id`; params.record_id = record_id; }
        if (actor_id) { query += ` AND al.actor_id = :actor_id`; params.actor_id = actor_id; }
        if (from) { query += ` AND al.created_at >= :from`; params.from = from; }
        if (to) { query += ` AND al.created_at < :to::date + interval '1 day'`; params.to = to; }
        query += ` ORDER BY al.created_at DESC LIMIT 500`;

        const result = await execute<any>(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('getAuditLog error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};
