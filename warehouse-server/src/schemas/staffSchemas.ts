import { z } from 'zod';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format');

export const createStaffSchema = z.object({
    warehouse_id: z.number().int().positive(),
    name: z.string().min(1).max(200),
    nic: z.string().min(1).max(20),
    designation: z.string().max(100).optional(),
    join_date: dateStr,
    basic_salary: z.number().min(0).optional(),
    epf_no: z.string().max(50).optional(),
});

export const updateStaffSchema = z.object({
    name: z.string().min(1).max(200).optional(),
    nic: z.string().min(1).max(20).optional(),
    designation: z.string().max(100).optional(),
    join_date: dateStr.optional(),
    basic_salary: z.number().min(0).optional(),
    epf_no: z.string().max(50).optional(),
    status: z.enum(['active', 'inactive']).optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field required' });

export const staffQuerySchema = z.object({
    warehouse_id: z.string().regex(/^\d+$/, 'warehouse_id must be numeric').optional(),
    status: z.enum(['active', 'inactive']).optional(),
});
