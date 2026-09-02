import { z } from 'zod';

export const createCompanySchema = z.object({
    name: z.string().min(1).max(200),
    code: z.string().min(1).max(32).optional(),
    contact_person: z.string().max(200).optional(),
    phone: z.string().max(64).optional(),
    email: z.string().email().max(200).optional(),
    address: z.string().optional(),
});

export const updateCompanySchema = z.object({
    name: z.string().min(1).max(200).optional(),
    code: z.string().min(1).max(32).optional(),
    contact_person: z.string().max(200).optional(),
    phone: z.string().max(64).optional(),
    email: z.string().email().max(200).optional(),
    address: z.string().optional(),
    status: z.enum(['active', 'inactive']).optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field required' });
