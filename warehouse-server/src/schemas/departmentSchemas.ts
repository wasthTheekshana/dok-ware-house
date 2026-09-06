import { z } from 'zod';

export const createDepartmentSchema = z.object({
    company_id: z.number().int().positive(),
    warehouse_id: z.number().int().positive(),
    name: z.string().min(1).max(200),
    code: z.string().min(1).max(32).optional(),
});

export const updateDepartmentSchema = z.object({
    name: z.string().min(1).max(200).optional(),
    code: z.string().min(1).max(32).optional(),
    status: z.enum(['active', 'inactive']).optional(),
    price_per_archived_box: z.number().nonnegative().optional(),
    price_per_retrieved_box: z.number().nonnegative().optional(),
    price_per_empty_carton: z.number().nonnegative().optional(),
    price_per_box_stored_monthly: z.number().nonnegative().optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field required' });
