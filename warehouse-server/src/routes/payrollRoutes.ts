import { Router } from 'express';
import { createPayroll, getPayroll, updatePayroll, submitPayroll, approvePayroll, rejectPayroll, reversePayroll } from '../controllers/payrollController';
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
router.post('/:id/submit', submitPayroll);
router.post('/:id/approve', approvePayroll);
router.post('/:id/reject', rejectPayroll);
router.post('/:id/reverse', reversePayroll);

export default router;
