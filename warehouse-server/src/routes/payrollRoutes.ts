import { Router } from 'express';
import { createPayroll, getPayroll, updatePayroll } from '../controllers/payrollController';
import { authenticateToken } from '../middleware/authMiddleware';
import { requirePermission } from '../middleware/permissionMiddleware';
import { validateBody, validateQuery } from '../middleware/validationMiddleware';
import { createPayrollSchema, updatePayrollSchema, payrollQuerySchema } from '../schemas/payrollSchemas';

const router = Router();

router.use(authenticateToken);
router.use(requirePermission('manage_payroll'));

router.get('/', validateQuery(payrollQuerySchema), getPayroll);
router.post('/', validateBody(createPayrollSchema), createPayroll);
router.put('/:id', validateBody(updatePayrollSchema), updatePayroll);

export default router;
