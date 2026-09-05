import { Router } from 'express';
import { createExpense, getExpenses, updateExpense, deleteExpense } from '../controllers/expenseController';
import { authenticateToken } from '../middleware/authMiddleware';
import { requirePermission } from '../middleware/permissionMiddleware';
import { validateBody, validateQuery } from '../middleware/validationMiddleware';
import { createExpenseSchema, updateExpenseSchema, expenseQuerySchema } from '../schemas/expenseSchemas';

const router = Router();

router.use(authenticateToken);
router.use(requirePermission('manage_expenses'));

router.get('/', validateQuery(expenseQuerySchema), getExpenses);
router.post('/', validateBody(createExpenseSchema), createExpense);
router.put('/:id', validateBody(updateExpenseSchema), updateExpense);
router.delete('/:id', deleteExpense);

export default router;
