import { Router } from 'express';
import { getWarehouses, getWarehouseById, createWarehouse, updateWarehouse } from '../controllers/warehouseController';
import { authenticateToken } from '../middleware/authMiddleware';
import { requirePermission } from '../middleware/permissionMiddleware';
import { validateBody } from '../middleware/validationMiddleware';
import { createWarehouseSchema, updateWarehouseSchema } from '../schemas/warehouseSchemas';

const router = Router();

router.use(authenticateToken);

router.get('/', getWarehouses);
router.get('/:id', getWarehouseById);
router.post('/', requirePermission('manage_warehouses'), validateBody(createWarehouseSchema), createWarehouse);
router.put('/:id', requirePermission('manage_warehouses'), validateBody(updateWarehouseSchema), updateWarehouse);

export default router;
