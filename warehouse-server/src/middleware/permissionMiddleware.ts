import { Response, NextFunction } from 'express';
import { execute } from '../db/dbUtils';
import { computeEffectivePermissions, PermissionKey, PermissionOverride } from '../utils/permissions';
import { AuthRequest } from './authMiddleware';

export const requirePermission = (key: PermissionKey) => {
    return async (req: AuthRequest, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(403).json({ message: 'Forbidden: Insufficient privileges' });
        }
        try {
            const overridesResult = await execute<any>(
                `SELECT permission_key, granted FROM user_permission_overrides WHERE user_id = :user_id`,
                { user_id: req.user.id }
            );
            const overrides: PermissionOverride[] = overridesResult.rows.map((r: any) => ({
                permission_key: r.PERMISSION_KEY,
                granted: r.GRANTED,
            }));
            const effective = computeEffectivePermissions(req.user.role, overrides);
            if (!effective.includes(key)) {
                return res.status(403).json({ message: 'Forbidden: Insufficient privileges' });
            }
            next();
        } catch (err) {
            console.error('requirePermission error:', err);
            res.status(500).json({ message: 'Server error' });
        }
    };
};
