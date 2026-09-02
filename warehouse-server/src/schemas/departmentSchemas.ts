import { z } from 'zod';

export const createDepartmentSchema = z.object({
    company_id: z.number().int().positive(),
    name: z.string().min(1).max(200),
    code: z.string().min(1).max(32).optional(),
});

export const updateDepartmentSchema = z.object({
    name: z.string().min(1).max(200).optional(),
    code: z.string().min(1).max(32).optional(),
    status: z.enum(['active', 'inactive']).optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field required' });
