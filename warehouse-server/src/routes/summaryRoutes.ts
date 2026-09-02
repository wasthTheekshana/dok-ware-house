import { Router } from 'express';
import { getCompanySummary, getMonthlySummary } from '../controllers/summaryController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

router.use(authenticateToken);

router.get('/companies', getCompanySummary);
router.get('/monthly', getMonthlySummary);

export default router;
