import { z } from 'zod';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format');
const timeStr = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Must be HH:MM format').optional();

const attendanceEntrySchema = z.object({
    staff_id: z.number().int().positive(),
    status: z.enum(['present', 'absent', 'half_day', 'leave']),
    in_time: timeStr,
    out_time: timeStr,
});

export const bulkMarkSchema = z.object({
    warehouse_id: z.number().int().positive(),
    attendance_date: dateStr,
    entries: z.array(attendanceEntrySchema).min(1),
});

export const attendanceQuerySchema = z.object({
    staff_id: z.string().regex(/^\d+$/, 'staff_id must be numeric').optional(),
    from: dateStr.optional(),
    to: dateStr.optional(),
});

export const attendanceSummaryQuerySchema = z.object({
    staff_id: z.string().regex(/^\d+$/, 'staff_id must be numeric'),
    year: z.string().regex(/^\d{4}$/, 'year must be a 4-digit number'),
    month: z.string().regex(/^(0?[1-9]|1[0-2])$/, 'month must be 1-12'),
});
