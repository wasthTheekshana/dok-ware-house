import { z } from 'zod';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format');
const amount = z.number().min(0);

export const createExpenseSchema = z.object({
    warehouse_id: z.number().int().positive(),
    expense_date: dateStr,
    transport_amount: amount.optional(),
    fuel_amount: amount.optional(),
    labour_amount: amount.optional(),
    meals_amount: amount.optional(),
    other_amount: amount.optional(),
    remarks: z.string().optional(),
});

export const updateExpenseSchema = z.object({
    transport_amount: amount.optional(),
    fuel_amount: amount.optional(),
    labour_amount: amount.optional(),
    meals_amount: amount.optional(),
    other_amount: amount.optional(),
    remarks: z.string().optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field required' });

export const expenseQuerySchema = z.object({
    warehouse_id: z.string().regex(/^\d+$/, 'warehouse_id must be numeric').optional(),
    from: dateStr.optional(),
    to: dateStr.optional(),
});

export const expenseSummaryQuerySchema = z.object({
    warehouse_id: z.string().regex(/^\d+$/, 'warehouse_id must be numeric').optional(),
    year: z.string().regex(/^\d{4}$/, 'year must be a 4-digit number'),
    month: z.string().regex(/^(0?[1-9]|1[0-2])$/, 'month must be 1-12'),
});

export const expenseComparisonQuerySchema = z.object({
    year: z.string().regex(/^\d{4}$/, 'year must be a 4-digit number'),
    month: z.string().regex(/^(0?[1-9]|1[0-2])$/, 'month must be 1-12'),
});
