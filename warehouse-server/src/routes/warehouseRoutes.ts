import { Router } from 'express';
import { getWarehouses, getWarehouseById, createWarehouse, updateWarehouse } from '../controllers/warehouseController';
import { authenticateToken, requireRole } from '../middleware/authMiddleware';
import { validateBody } from '../middleware/validationMiddleware';
import { createWarehouseSchema, updateWarehouseSchema } from '../schemas/warehouseSchemas';

const router = Router();

router.use(authenticateToken);

router.get('/', getWarehouses);
router.get('/:id', getWarehouseById);
router.post('/', requireRole(['admin']), validateBody(createWarehouseSchema), createWarehouse);
router.put('/:id', requireRole(['admin']), validateBody(updateWarehouseSchema), updateWarehouse);

export default router;
