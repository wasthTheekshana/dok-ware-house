import { Router } from 'express';
import { getAuditLog } from '../controllers/auditLogController';
import { authenticateToken } from '../middleware/authMiddleware';
import { validateQuery } from '../middleware/validationMiddleware';
import { auditLogQuerySchema } from '../schemas/auditLogSchemas';

const router = Router();

router.use(authenticateToken);
router.get('/', validateQuery(auditLogQuerySchema), getAuditLog);

export default router;
