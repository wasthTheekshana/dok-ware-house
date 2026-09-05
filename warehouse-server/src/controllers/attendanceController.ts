import { Request, Response } from 'express';
import { execute, withTransaction } from '../db/dbUtils';

function warehouseScope(req: Request): number[] | null {
    const user = (req as any).user;
    if (!user || user.role !== 'warehouse_admin') return null;
    return user.warehouse_ids || [];
}

export const bulkMarkAttendance = async (req: Request, res: Response) => {
    const { warehouse_id, attendance_date, entries } = req.body;
    const scope = warehouseScope(req);

    if (scope !== null && !scope.includes(warehouse_id)) {
        return res.status(400).json({ message: 'warehouse_id is outside your assigned warehouses' });
    }

    try {
        const saved = await withTransaction(async (exec) => {
            const staffIds = entries.map((e: any) => e.staff_id);
            const staffResult = await exec<any>(
                `SELECT id FROM staff WHERE id = ANY(:staff_ids) AND warehouse_id = :warehouse_id`,
                { staff_ids: staffIds, warehouse_id }
            );
            if (staffResult.rows.length !== staffIds.length) {
                throw Object.assign(
                    new Error('One or more staff_id values do not belong to warehouse_id'),
                    { statusCode: 400 }
                );
            }

            const results = [];
            for (const entry of entries) {
                const upsertResult = await exec<any>(
                    `INSERT INTO attendance (staff_id, attendance_date, status, in_time, out_time)
                     VALUES (:staff_id, :attendance_date, :status, :in_time, :out_time)
                     ON CONFLICT (staff_id, attendance_date)
                     DO UPDATE SET status = :status, in_time = :in_time, out_time = :out_time, updated_at = now()
                     RETURNING *`,
                    {
                        staff_id: entry.staff_id,
                        attendance_date,
                        status: entry.status,
                        in_time: entry.in_time || null,
                        out_time: entry.out_time || null,
                    }
                );
                results.push(upsertResult.rows[0]);
            }
            return results;
        });

        res.status(200).json(saved);
    } catch (err: any) {
        if (err.statusCode) {
            return res.status(err.statusCode).json({ message: err.message });
        }
        console.error('bulkMarkAttendance error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const getAttendance = async (req: Request, res: Response) => {
    const { staff_id, from, to } = req.query;
    const scope = warehouseScope(req);
    try {
        let query = `
            SELECT a.*, s.name AS staff_name, s.warehouse_id
            FROM attendance a
            JOIN staff s ON s.id = a.staff_id
            WHERE 1=1
        `;
        const params: any = {};
        if (staff_id) { query += ` AND a.staff_id = :staff_id`; params.staff_id = staff_id; }
        if (from) { query += ` AND a.attendance_date >= :from`; params.from = from; }
        if (to) { query += ` AND a.attendance_date <= :to`; params.to = to; }
        if (scope !== null) { query += ` AND s.warehouse_id = ANY(:warehouse_ids)`; params.warehouse_ids = scope; }
        query += ` ORDER BY a.attendance_date DESC, s.name`;

        const result = await execute<any>(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('getAttendance error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const getAttendanceSummary = async (req: Request, res: Response) => {
    const { staff_id, year, month } = req.query as { staff_id: string; year: string; month: string };
    const scope = warehouseScope(req);
    try {
        let staffQuery = `SELECT id FROM staff WHERE id = :staff_id`;
        const staffParams: any = { staff_id };
        if (scope !== null) {
            staffQuery += ` AND warehouse_id = ANY(:warehouse_ids)`;
            staffParams.warehouse_ids = scope;
        }
        const staffResult = await execute<any>(staffQuery, staffParams);
        if (staffResult.rows.length === 0) {
            return res.status(404).json({ message: 'Staff member not found' });
        }

        const result = await execute<any>(
            `SELECT status, COUNT(*)::int AS count
             FROM attendance
             WHERE staff_id = :staff_id
               AND date_trunc('month', attendance_date) = make_date(:year::int, :month::int, 1)
             GROUP BY status`,
            { staff_id, year: Number(year), month: Number(month) }
        );

        const counts: Record<string, number> = { present: 0, absent: 0, half_day: 0, leave: 0 };
        for (const row of result.rows) {
            counts[row.STATUS] = row.COUNT;
        }

        res.json({ staff_id: Number(staff_id), year: Number(year), month: Number(month), counts });
    } catch (err) {
        console.error('getAttendanceSummary error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};
