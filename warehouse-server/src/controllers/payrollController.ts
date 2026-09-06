import { Request, Response } from 'express';
import { execute } from '../db/dbUtils';

function warehouseScope(req: Request): number[] | null {
    const user = (req as any).user;
    if (!user || user.role !== 'warehouse_admin') return null;
    return user.warehouse_ids || [];
}

function isApprover(req: Request): boolean {
    const user = (req as any).user;
    return user?.role === 'system_admin' || user?.role === 'finance_officer';
}

function computeNet(fields: { basic_pay?: number; ot_amount?: number; deductions?: number; epf_employee?: number }, existing: any) {
    const basic_pay = fields.basic_pay ?? existing.BASIC_PAY;
    const ot_amount = fields.ot_amount ?? existing.OT_AMOUNT;
    const deductions = fields.deductions ?? existing.DEDUCTIONS;
    const epf_employee = fields.epf_employee ?? existing.EPF_EMPLOYEE;
    return basic_pay + ot_amount - deductions - epf_employee;
}

export const createPayroll = async (req: Request, res: Response) => {
    const { staff_id, month, year } = req.body;
    const scope = warehouseScope(req);

    try {
        let staffQuery = `SELECT id, warehouse_id, basic_salary FROM staff WHERE id = :staff_id`;
        const staffParams: any = { staff_id };
        if (scope !== null) {
            staffQuery += ` AND warehouse_id = ANY(:warehouse_ids)`;
            staffParams.warehouse_ids = scope;
        }
        const staffResult = await execute<any>(staffQuery, staffParams);
        if (staffResult.rows.length === 0) {
            return res.status(404).json({ message: 'Staff member not found' });
        }
        const staff = staffResult.rows[0];

        const existingResult = await execute<any>(
            `SELECT id FROM payroll WHERE staff_id = :staff_id AND month = :month AND year = :year AND reverses_payroll_id IS NULL`,
            { staff_id, month, year }
        );
        if (existingResult.rows.length > 0) {
            return res.status(409).json({ message: 'A payroll record already exists for this staff member and period' });
        }

        const attendanceResult = await execute<any>(
            `SELECT COUNT(*)::int AS count FROM attendance
             WHERE staff_id = :staff_id AND status = 'absent'
               AND date_trunc('month', attendance_date) = make_date(:year::int, :month::int, 1)`,
            { staff_id, year, month }
        );
        const absentDays = attendanceResult.rows[0].COUNT;
        const basicPay = staff.BASIC_SALARY;
        const deductions = (basicPay / 30) * absentDays;
        const netSalary = basicPay - deductions;

        const result = await execute<any>(
            `INSERT INTO payroll (staff_id, warehouse_id, month, year, basic_pay, deductions, net_salary, created_by)
             VALUES (:staff_id, :warehouse_id, :month, :year, :basic_pay, :deductions, :net_salary, :created_by)
             RETURNING *`,
            {
                staff_id, warehouse_id: staff.WAREHOUSE_ID, month, year,
                basic_pay: basicPay, deductions, net_salary: netSalary,
                created_by: (req as any).user?.id ?? null,
            }
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('createPayroll error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const getPayroll = async (req: Request, res: Response) => {
    const { staff_id, month, year, status } = req.query;
    const scope = warehouseScope(req);
    try {
        let query = `
            SELECT p.*, s.name AS staff_name
            FROM payroll p
            JOIN staff s ON s.id = p.staff_id
            WHERE 1=1
        `;
        const params: any = {};
        if (staff_id) { query += ` AND p.staff_id = :staff_id`; params.staff_id = staff_id; }
        if (month) { query += ` AND p.month = :month`; params.month = month; }
        if (year) { query += ` AND p.year = :year`; params.year = year; }
        if (status) { query += ` AND p.status = :status`; params.status = status; }
        if (scope !== null) { query += ` AND p.warehouse_id = ANY(:warehouse_ids)`; params.warehouse_ids = scope; }
        query += ` ORDER BY p.year DESC, p.month DESC, s.name`;

        const result = await execute<any>(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('getPayroll error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const updatePayroll = async (req: Request, res: Response) => {
    const { id } = req.params;
    const fields = req.body;
    const scope = warehouseScope(req);

    try {
        let existingQuery = `SELECT * FROM payroll WHERE id = :id AND status IN ('draft', 'rejected')`;
        const existingParams: any = { id };
        if (scope !== null) {
            existingQuery += ` AND warehouse_id = ANY(:warehouse_ids)`;
            existingParams.warehouse_ids = scope;
        }
        const existingResult = await execute<any>(existingQuery, existingParams);
        if (existingResult.rows.length === 0) {
            return res.status(404).json({ message: 'Payroll record not found' });
        }
        const existing = existingResult.rows[0];

        const netSalary = computeNet(fields, existing);
        const setClauses = Object.keys(fields).map(key => `${key} = :${key}`).join(', ');

        const result = await execute<any>(
            `UPDATE payroll SET ${setClauses}, net_salary = :net_salary, updated_at = now() WHERE id = :id RETURNING *`,
            { ...fields, net_salary: netSalary, id }
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('updatePayroll error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const submitPayroll = async (req: Request, res: Response) => {
    const { id } = req.params;
    const scope = warehouseScope(req);
    try {
        let query = `UPDATE payroll SET status = 'pending_approval', updated_at = now() WHERE id = :id AND status IN ('draft', 'rejected')`;
        const params: any = { id };
        if (scope !== null) {
            query += ` AND warehouse_id = ANY(:warehouse_ids)`;
            params.warehouse_ids = scope;
        }
        query += ` RETURNING *`;
        const result = await execute<any>(query, params);
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Payroll record not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('submitPayroll error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const approvePayroll = async (req: Request, res: Response) => {
    if (!isApprover(req)) {
        return res.status(403).json({ message: 'Only system_admin or finance_officer may approve payroll' });
    }
    const { id } = req.params;
    const userId = (req as any).user?.id ?? null;
    try {
        const result = await execute<any>(
            `UPDATE payroll SET status = 'approved', approved_by = :approved_by, updated_at = now()
             WHERE id = :id AND status = 'pending_approval' RETURNING *`,
            { id, approved_by: userId }
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Payroll record not found or not pending approval' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('approvePayroll error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const rejectPayroll = async (req: Request, res: Response) => {
    if (!isApprover(req)) {
        return res.status(403).json({ message: 'Only system_admin or finance_officer may reject payroll' });
    }
    const { id } = req.params;
    try {
        const result = await execute<any>(
            `UPDATE payroll SET status = 'rejected', updated_at = now()
             WHERE id = :id AND status = 'pending_approval' RETURNING *`,
            { id }
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Payroll record not found or not pending approval' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('rejectPayroll error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const reversePayroll = async (req: Request, res: Response) => {
    if (!isApprover(req)) {
        return res.status(403).json({ message: 'Only system_admin or finance_officer may reverse payroll' });
    }
    const { id } = req.params;
    const userId = (req as any).user?.id ?? null;
    try {
        const originalResult = await execute<any>(
            `SELECT * FROM payroll WHERE id = :id AND status = 'approved' AND reverses_payroll_id IS NULL`,
            { id }
        );
        if (originalResult.rows.length === 0) {
            return res.status(400).json({ message: 'Only an approved, non-reversal payroll record can be reversed' });
        }
        const original = originalResult.rows[0];

        const result = await execute<any>(
            `INSERT INTO payroll
                (staff_id, warehouse_id, month, year, basic_pay, ot_amount, deductions, epf_employee, epf_employer, etf, net_salary, status, reverses_payroll_id, created_by, approved_by)
             VALUES
                (:staff_id, :warehouse_id, :month, :year, :basic_pay, :ot_amount, :deductions, :epf_employee, :epf_employer, :etf, :net_salary, 'approved', :reverses_payroll_id, :created_by, :approved_by)
             RETURNING *`,
            {
                staff_id: original.STAFF_ID,
                warehouse_id: original.WAREHOUSE_ID,
                month: original.MONTH,
                year: original.YEAR,
                basic_pay: -original.BASIC_PAY,
                ot_amount: -original.OT_AMOUNT,
                deductions: -original.DEDUCTIONS,
                epf_employee: -original.EPF_EMPLOYEE,
                epf_employer: -original.EPF_EMPLOYER,
                etf: -original.ETF,
                net_salary: -original.NET_SALARY,
                reverses_payroll_id: original.ID,
                created_by: userId,
                approved_by: userId,
            }
        );
        res.status(201).json(result.rows[0]);
    } catch (err: any) {
        if (err.code === '23505') {
            return res.status(409).json({ message: 'This payroll record has already been reversed' });
        }
        console.error('reversePayroll error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};
