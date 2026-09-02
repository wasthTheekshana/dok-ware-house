import { Request, Response } from 'express';
import { execute, withTransaction } from '../db/dbUtils';
import { applyBoxEvent, eventDelta, BoxEventType } from '../utils/boxCount';

export const createBoxEvent = async (req: Request, res: Response) => {
    const { department_id, event_type, quantity, event_date, reference_no, remarks } = req.body;
    const userId = (req as any).user?.id ?? null;

    try {
        const event = await withTransaction(async (exec) => {
            const deptResult = await exec<any>(
                `SELECT id, current_box_count FROM departments WHERE id = :department_id FOR UPDATE`,
                { department_id }
            );
            if (deptResult.rows.length === 0) {
                throw Object.assign(new Error('Department not found'), { statusCode: 404 });
            }

            const currentCount = deptResult.rows[0].CURRENT_BOX_COUNT;
            let newCount: number;
            try {
                newCount = applyBoxEvent(currentCount, event_type as BoxEventType, quantity);
            } catch (e: any) {
                throw Object.assign(e, { statusCode: 400 });
            }

            await exec(
                `UPDATE departments SET current_box_count = :new_count WHERE id = :department_id`,
                { new_count: newCount, department_id }
            );

            const insertResult = await exec<any>(
                `INSERT INTO box_events (department_id, event_type, quantity, event_date, reference_no, remarks, created_by)
                 VALUES (:department_id, :event_type, :quantity, :event_date, :reference_no, :remarks, :created_by)
                 RETURNING *`,
                { department_id, event_type, quantity, event_date, reference_no: reference_no || null, remarks: remarks || null, created_by: userId }
            );

            return insertResult.rows[0];
        });

        res.status(201).json(event);
    } catch (err: any) {
        if (err.statusCode) {
            return res.status(err.statusCode).json({ message: err.message });
        }
        console.error('createBoxEvent error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const getBoxEvents = async (req: Request, res: Response) => {
    const { department_id, event_type, from, to } = req.query;
    try {
        let query = `
            SELECT be.id, be.department_id, be.event_type, be.quantity, be.event_date, be.reference_no, be.remarks, be.created_at,
                   d.name AS department_name, c.name AS company_name
            FROM box_events be
            JOIN departments d ON d.id = be.department_id
            JOIN companies c ON c.id = d.company_id
            WHERE 1=1
        `;
        const params: any = {};

        if (department_id) { query += ` AND be.department_id = :department_id`; params.department_id = department_id; }
        if (event_type) { query += ` AND be.event_type = :event_type`; params.event_type = event_type; }
        if (from) { query += ` AND be.event_date >= :from`; params.from = from; }
        if (to) { query += ` AND be.event_date <= :to`; params.to = to; }

        query += ` ORDER BY be.event_date DESC, be.id DESC LIMIT 500`;

        const result = await execute<any>(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('getBoxEvents error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const updateBoxEvent = async (req: Request, res: Response) => {
    const { id } = req.params;
    const fields = req.body;

    try {
        const event = await withTransaction(async (exec) => {
            const existingResult = await exec<any>(
                `SELECT be.id, be.department_id, be.event_type, be.quantity, be.event_date, be.reference_no, be.remarks, d.current_box_count
                 FROM box_events be
                 JOIN departments d ON d.id = be.department_id
                 WHERE be.id = :id
                 FOR UPDATE`,
                { id }
            );
            if (existingResult.rows.length === 0) {
                throw Object.assign(new Error('Box event not found'), { statusCode: 404 });
            }

            const existing = existingResult.rows[0];
            const newEventType = (fields.event_type ?? existing.EVENT_TYPE) as BoxEventType;
            const newQuantity = fields.quantity ?? existing.QUANTITY;

            const oldDelta = eventDelta(existing.EVENT_TYPE as BoxEventType, existing.QUANTITY);
            const newDelta = eventDelta(newEventType, newQuantity);
            const newCount = existing.CURRENT_BOX_COUNT - oldDelta + newDelta;
            if (newCount < 0) {
                throw Object.assign(
                    new Error(`Insufficient boxes: this edit would take department ${existing.DEPARTMENT_ID}'s count negative`),
                    { statusCode: 400 }
                );
            }

            await exec(
                `UPDATE departments SET current_box_count = :new_count WHERE id = :department_id`,
                { new_count: newCount, department_id: existing.DEPARTMENT_ID }
            );

            const updateResult = await exec<any>(
                `UPDATE box_events
                 SET event_type = :event_type, quantity = :quantity, event_date = :event_date,
                     reference_no = :reference_no, remarks = :remarks
                 WHERE id = :id
                 RETURNING *`,
                {
                    id,
                    event_type: newEventType,
                    quantity: newQuantity,
                    event_date: fields.event_date ?? existing.EVENT_DATE,
                    reference_no: fields.reference_no ?? existing.REFERENCE_NO ?? null,
                    remarks: fields.remarks ?? existing.REMARKS ?? null,
                }
            );

            return updateResult.rows[0];
        });

        res.json(event);
    } catch (err: any) {
        if (err.statusCode) {
            return res.status(err.statusCode).json({ message: err.message });
        }
        console.error('updateBoxEvent error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const deleteBoxEvent = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        await withTransaction(async (exec) => {
            const existingResult = await exec<any>(
                `SELECT be.id, be.department_id, be.event_type, be.quantity, d.current_box_count
                 FROM box_events be
                 JOIN departments d ON d.id = be.department_id
                 WHERE be.id = :id
                 FOR UPDATE`,
                { id }
            );
            if (existingResult.rows.length === 0) {
                throw Object.assign(new Error('Box event not found'), { statusCode: 404 });
            }

            const existing = existingResult.rows[0];
            const newCount = existing.CURRENT_BOX_COUNT - eventDelta(existing.EVENT_TYPE as BoxEventType, existing.QUANTITY);
            if (newCount < 0) {
                throw Object.assign(
                    new Error(`Insufficient boxes: deleting this event would take department ${existing.DEPARTMENT_ID}'s count negative`),
                    { statusCode: 400 }
                );
            }

            await exec(
                `UPDATE departments SET current_box_count = :new_count WHERE id = :department_id`,
                { new_count: newCount, department_id: existing.DEPARTMENT_ID }
            );

            await exec(`DELETE FROM box_events WHERE id = :id`, { id });
        });

        res.json({ message: 'Box event deleted' });
    } catch (err: any) {
        if (err.statusCode) {
            return res.status(err.statusCode).json({ message: err.message });
        }
        console.error('deleteBoxEvent error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};
