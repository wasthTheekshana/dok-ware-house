import { Router } from 'express';
import { createBoxEvent, getBoxEvents, updateBoxEvent, deleteBoxEvent } from '../controllers/boxEventController';
import { authenticateToken } from '../middleware/authMiddleware';
import { requirePermission } from '../middleware/permissionMiddleware';
import { validateBody, validateQuery } from '../middleware/validationMiddleware';
import { createBoxEventSchema, updateBoxEventSchema, boxEventQuerySchema } from '../schemas/boxEventSchemas';

const router = Router();

router.use(authenticateToken);
router.use(requirePermission('manage_box_events'));

router.get('/', validateQuery(boxEventQuerySchema), getBoxEvents);
router.post('/', validateBody(createBoxEventSchema), createBoxEvent);
router.put('/:id', validateBody(updateBoxEventSchema), updateBoxEvent);
router.delete('/:id', deleteBoxEvent);

export default router;
