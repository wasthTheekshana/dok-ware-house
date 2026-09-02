import { Router } from 'express';
import { getCompanies, getCompanyById, createCompany, updateCompany } from '../controllers/companyController';
import { authenticateToken, requireRole } from '../middleware/authMiddleware';
import { validateBody } from '../middleware/validationMiddleware';
import { createCompanySchema, updateCompanySchema } from '../schemas/companySchemas';

const router = Router();

router.use(authenticateToken);

router.get('/', getCompanies);
router.get('/:id', getCompanyById);
router.post('/', requireRole(['admin']), validateBody(createCompanySchema), createCompany);
router.put('/:id', requireRole(['admin']), validateBody(updateCompanySchema), updateCompany);

export default router;
