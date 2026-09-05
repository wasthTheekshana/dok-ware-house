import { Router } from 'express';
import { getCompanies, getCompanyById, createCompany, updateCompany } from '../controllers/companyController';
import { authenticateToken } from '../middleware/authMiddleware';
import { requirePermission } from '../middleware/permissionMiddleware';
import { validateBody } from '../middleware/validationMiddleware';
import { createCompanySchema, updateCompanySchema } from '../schemas/companySchemas';

const router = Router();

router.use(authenticateToken);

router.get('/', getCompanies);
router.get('/:id', getCompanyById);
router.post('/', requirePermission('manage_companies'), validateBody(createCompanySchema), createCompany);
router.put('/:id', requirePermission('manage_companies'), validateBody(updateCompanySchema), updateCompany);

export default router;
