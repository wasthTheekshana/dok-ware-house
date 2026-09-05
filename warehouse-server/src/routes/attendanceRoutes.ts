import { Router } from 'express';
import { bulkMarkAttendance, getAttendance, getAttendanceSummary } from '../controllers/attendanceController';
import { authenticateToken } from '../middleware/authMiddleware';
import { requirePermission } from '../middleware/permissionMiddleware';
import { validateBody, validateQuery } from '../middleware/validationMiddleware';
import { bulkMarkSchema, attendanceQuerySchema, attendanceSummaryQuerySchema } from '../schemas/attendanceSchemas';

const router = Router();

router.use(authenticateToken);
router.use(requirePermission('manage_staff'));

router.get('/summary', validateQuery(attendanceSummaryQuerySchema), getAttendanceSummary);
router.get('/', validateQuery(attendanceQuerySchema), getAttendance);
router.post('/bulk-mark', validateBody(bulkMarkSchema), bulkMarkAttendance);

export default router;
