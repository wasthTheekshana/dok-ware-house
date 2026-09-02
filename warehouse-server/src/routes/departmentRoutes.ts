import { Router } from 'express';
import { getDepartments, createDepartment, updateDepartment } from '../controllers/departmentController';
import { authenticateToken, requireRole } from '../middleware/authMiddleware';
import { validateBody } from '../middleware/validationMiddleware';
import { createDepartmentSchema, updateDepartmentSchema } from '../schemas/departmentSchemas';

const router = Router();

router.use(authenticateToken);

router.get('/', getDepartments);
router.post('/', requireRole(['admin']), validateBody(createDepartmentSchema), createDepartment);
router.put('/:id', requireRole(['admin']), validateBody(updateDepartmentSchema), updateDepartment);

export default router;
