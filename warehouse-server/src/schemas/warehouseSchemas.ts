import { z } from 'zod';

export const createWarehouseSchema = z.object({
    name: z.string().min(1).max(200),
    code: z.string().min(1).max(32).optional(),
    address: z.string().optional(),
});

export const updateWarehouseSchema = z.object({
    name: z.string().min(1).max(200).optional(),
    code: z.string().min(1).max(32).optional(),
    address: z.string().optional(),
    status: z.enum(['active', 'inactive']).optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field required' });
