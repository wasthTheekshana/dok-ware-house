import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

export const validateBody = (schema: ZodSchema) =>
    (req: Request, res: Response, next: NextFunction) => {
        const result = schema.safeParse(req.body);
        if (!result.success) {
            return res.status(400).json({
                message: 'Validation error',
                errors: result.error.issues.map(e => ({ field: e.path.map(String).join('.'), message: e.message })),
            });
        }
        req.body = result.data;
        next();
    };

export const validateQuery = (schema: ZodSchema) =>
    (req: Request, res: Response, next: NextFunction) => {
        const result = schema.safeParse(req.query);
        if (!result.success) {
            return res.status(400).json({
                message: 'Validation error',
                errors: result.error.issues.map(e => ({ field: e.path.map(String).join('.'), message: e.message })),
            });
        }
        next();
    };
