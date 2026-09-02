import { z } from 'zod';

export const createUserSchema = z.object({
    username: z.string().min(1).max(64),
    name: z.string().min(1).max(200),
    password: z.string().min(6).max(255),
    role: z.enum(['admin', 'staff']),
});

export const updateUserSchema = z.object({
    name: z.string().min(1).max(200).optional(),
    role: z.enum(['admin', 'staff']).optional(),
    status: z.enum(['active', 'inactive']).optional(),
    password: z.string().min(6).max(255).optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field required' });

export const changePasswordSchema = z.object({
    current_password: z.string().min(1),
    new_password: z.string().min(6).max(255),
});
