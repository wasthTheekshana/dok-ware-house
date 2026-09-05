import { Router } from 'express';
import { getStaff, createStaff, updateStaff } from '../controllers/staffController';
import { authenticateToken } from '../middleware/authMiddleware';
import { requirePermission } from '../middleware/permissionMiddleware';
import { validateBody, validateQuery } from '../middleware/validationMiddleware';
import { createStaffSchema, updateStaffSchema, staffQuerySchema } from '../schemas/staffSchemas';

const router = Router();

router.use(authenticateToken);
router.use(requirePermission('manage_staff'));

router.get('/', validateQuery(staffQuerySchema), getStaff);
router.post('/', validateBody(createStaffSchema), createStaff);
router.put('/:id', validateBody(updateStaffSchema), updateStaff);

export default router;
