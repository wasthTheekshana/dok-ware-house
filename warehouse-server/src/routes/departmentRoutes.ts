import { Router } from 'express';
import { getDepartments, createDepartment, updateDepartment } from '../controllers/departmentController';
import { authenticateToken } from '../middleware/authMiddleware';
import { requirePermission } from '../middleware/permissionMiddleware';
import { validateBody } from '../middleware/validationMiddleware';
import { createDepartmentSchema, updateDepartmentSchema } from '../schemas/departmentSchemas';

const router = Router();

router.use(authenticateToken);

router.get('/', getDepartments);
router.post('/', requirePermission('manage_companies'), validateBody(createDepartmentSchema), createDepartment);
router.put('/:id', requirePermission('manage_companies'), validateBody(updateDepartmentSchema), updateDepartment);

export default router;
