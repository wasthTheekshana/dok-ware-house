import { Request, Response } from 'express';
import { execute } from '../db/dbUtils';
import { computeInvoiceAmounts } from '../utils/invoiceCalc';

const SSCL_RATE = parseFloat(process.env.SSCL_RATE || '0.025641');
const VAT_RATE = parseFloat(process.env.VAT_RATE || '0.18');

async function computeBreakdown(department_id: number, period_from: string, period_to: string) {
    const deptResult = await execute<any>(
        `SELECT d.id, d.company_id, d.name AS department_name, c.name AS company_name,
                d.price_per_archived_box, d.price_per_retrieved_box, d.price_per_empty_carton
         FROM departments d
         JOIN companies c ON c.id = d.company_id
         WHERE d.id = :department_id`,
        { department_id }
    );
    if (deptResult.rows.length === 0) {
        return null;
    }
    const dept = deptResult.rows[0];

    const countsResult = await execute<any>(
        `SELECT event_type, COALESCE(SUM(quantity), 0)::int AS total
         FROM box_events
         WHERE department_id = :department_id AND event_date >= :period_from AND event_date <= :period_to
         GROUP BY event_type`,
        { department_id, period_from, period_to }
    );
    const counts: Record<string, number> = { archived: 0, retrieved: 0, empty_carton_issued: 0 };
    for (const row of countsResult.rows) {
        counts[row.EVENT_TYPE] = row.TOTAL;
    }

    const amounts = computeInvoiceAmounts(
        counts.archived,
        counts.retrieved,
        counts.empty_carton_issued,
        {
            archived: dept.PRICE_PER_ARCHIVED_BOX,
            retrieved: dept.PRICE_PER_RETRIEVED_BOX,
            emptyCarton: dept.PRICE_PER_EMPTY_CARTON,
        },
        SSCL_RATE,
        VAT_RATE
    );

    return {
        DEPARTMENT_ID: dept.ID,
        COMPANY_ID: dept.COMPANY_ID,
        DEPARTMENT_NAME: dept.DEPARTMENT_NAME,
        COMPANY_NAME: dept.COMPANY_NAME,
        PERIOD_FROM: period_from,
        PERIOD_TO: period_to,
        ARCHIVED_COUNT: counts.archived,
        RETRIEVED_COUNT: counts.retrieved,
        EMPTY_CARTON_COUNT: counts.empty_carton_issued,
        PRICE_PER_ARCHIVED_BOX: dept.PRICE_PER_ARCHIVED_BOX,
        PRICE_PER_RETRIEVED_BOX: dept.PRICE_PER_RETRIEVED_BOX,
        PRICE_PER_EMPTY_CARTON: dept.PRICE_PER_EMPTY_CARTON,
        SUBTOTAL: amounts.subtotal,
        SSCL_AMOUNT: amounts.ssclAmount,
        VAT_AMOUNT: amounts.vatAmount,
        TOTAL_AMOUNT: amounts.totalAmount,
    };
}

export const previewInvoice = async (req: Request, res: Response) => {
    const { department_id, period_from, period_to } = req.body;
    try {
        const breakdown = await computeBreakdown(department_id, period_from, period_to);
        if (!breakdown) {
            return res.status(404).json({ message: 'Department not found' });
        }
        res.json(breakdown);
    } catch (err) {
        console.error('previewInvoice error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const createInvoice = async (req: Request, res: Response) => {
    const { department_id, period_from, period_to } = req.body;
    const userId = (req as any).user?.id ?? null;
    try {
        const breakdown = await computeBreakdown(department_id, period_from, period_to);
        if (!breakdown) {
            return res.status(404).json({ message: 'Department not found' });
        }

        const result = await execute<any>(
            `INSERT INTO invoices (
                department_id, company_id, department_name, company_name,
                period_from, period_to, archived_count, retrieved_count, empty_carton_count,
                price_per_archived_box, price_per_retrieved_box, price_per_empty_carton,
                subtotal, sscl_amount, vat_amount, total_amount, created_by
            ) VALUES (
                :department_id, :company_id, :department_name, :company_name,
                :period_from, :period_to, :archived_count, :retrieved_count, :empty_carton_count,
                :price_per_archived_box, :price_per_retrieved_box, :price_per_empty_carton,
                :subtotal, :sscl_amount, :vat_amount, :total_amount, :created_by
            ) RETURNING *`,
            {
                department_id: breakdown.DEPARTMENT_ID,
                company_id: breakdown.COMPANY_ID,
                department_name: breakdown.DEPARTMENT_NAME,
                company_name: breakdown.COMPANY_NAME,
                period_from: breakdown.PERIOD_FROM,
                period_to: breakdown.PERIOD_TO,
                archived_count: breakdown.ARCHIVED_COUNT,
                retrieved_count: breakdown.RETRIEVED_COUNT,
                empty_carton_count: breakdown.EMPTY_CARTON_COUNT,
                price_per_archived_box: breakdown.PRICE_PER_ARCHIVED_BOX,
                price_per_retrieved_box: breakdown.PRICE_PER_RETRIEVED_BOX,
                price_per_empty_carton: breakdown.PRICE_PER_EMPTY_CARTON,
                subtotal: breakdown.SUBTOTAL,
                sscl_amount: breakdown.SSCL_AMOUNT,
                vat_amount: breakdown.VAT_AMOUNT,
                total_amount: breakdown.TOTAL_AMOUNT,
                created_by: userId,
            }
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('createInvoice error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const getInvoices = async (req: Request, res: Response) => {
    const { department_id, company_id, from, to } = req.query;
    try {
        let query = `SELECT * FROM invoices WHERE 1=1`;
        const params: any = {};
        if (department_id) { query += ` AND department_id = :department_id`; params.department_id = department_id; }
        if (company_id) { query += ` AND company_id = :company_id`; params.company_id = company_id; }
        if (from) { query += ` AND period_from >= :from`; params.from = from; }
        if (to) { query += ` AND period_to <= :to`; params.to = to; }
        query += ` ORDER BY created_at DESC`;
        const result = await execute<any>(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('getInvoices error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const deleteInvoice = async (req: Request, res: Response) => {
    try {
        const result = await execute<any>(`DELETE FROM invoices WHERE id = :id RETURNING id`, [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Invoice not found' });
        }
        res.json({ message: 'Invoice deleted' });
    } catch (err) {
        console.error('deleteInvoice error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};
