import { Router } from 'express';
import { previewInvoice, createInvoice, getInvoices, deleteInvoice } from '../controllers/invoiceController';
import { authenticateToken, requireRole } from '../middleware/authMiddleware';
import { validateBody, validateQuery } from '../middleware/validationMiddleware';
import { invoicePeriodSchema, invoiceQuerySchema } from '../schemas/invoiceSchemas';

const router = Router();

router.use(authenticateToken);
router.use(requireRole(['admin']));

router.get('/', validateQuery(invoiceQuerySchema), getInvoices);
router.post('/preview', validateBody(invoicePeriodSchema), previewInvoice);
router.post('/', validateBody(invoicePeriodSchema), createInvoice);
router.delete('/:id', deleteInvoice);

export default router;
