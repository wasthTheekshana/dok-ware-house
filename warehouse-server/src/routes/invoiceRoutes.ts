import { Router } from 'express';
import { previewInvoice, createInvoice, getInvoices, deleteInvoice } from '../controllers/invoiceController';
import { authenticateToken } from '../middleware/authMiddleware';
import { requirePermission } from '../middleware/permissionMiddleware';
import { validateBody, validateQuery } from '../middleware/validationMiddleware';
import { invoicePeriodSchema, invoiceQuerySchema } from '../schemas/invoiceSchemas';

const router = Router();

router.use(authenticateToken);

router.get('/', requirePermission('view_invoices'), validateQuery(invoiceQuerySchema), getInvoices);
router.post('/preview', requirePermission('manage_invoices'), validateBody(invoicePeriodSchema), previewInvoice);
router.post('/', requirePermission('manage_invoices'), validateBody(invoicePeriodSchema), createInvoice);
router.delete('/:id', requirePermission('manage_invoices'), deleteInvoice);

export default router;
