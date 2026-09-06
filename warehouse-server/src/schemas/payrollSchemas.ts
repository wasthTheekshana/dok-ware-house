import { z } from 'zod';

export const createPayrollSchema = z.object({
    staff_id: z.number().int().positive(),
    month: z.number().int().min(1).max(12),
    year: z.number().int().positive(),
});

export const updatePayrollSchema = z.object({
    basic_pay: z.number().min(0).optional(),
    ot_amount: z.number().min(0).optional(),
    deductions: z.number().min(0).optional(),
    epf_employee: z.number().min(0).optional(),
    epf_employer: z.number().min(0).optional(),
    etf: z.number().min(0).optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field required' });

export const payrollQuerySchema = z.object({
    staff_id: z.string().regex(/^\d+$/, 'staff_id must be numeric').optional(),
    month: z.string().regex(/^(0?[1-9]|1[0-2])$/, 'month must be 1-12').optional(),
    year: z.string().regex(/^\d{4}$/, 'year must be a 4-digit number').optional(),
    status: z.enum(['draft', 'pending_approval', 'approved', 'rejected']).optional(),
});
