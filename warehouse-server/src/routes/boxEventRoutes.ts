import { Router } from 'express';
import { createBoxEvent, getBoxEvents, updateBoxEvent, deleteBoxEvent } from '../controllers/boxEventController';
import { authenticateToken, requireRole } from '../middleware/authMiddleware';
import { validateBody, validateQuery } from '../middleware/validationMiddleware';
import { createBoxEventSchema, updateBoxEventSchema, boxEventQuerySchema } from '../schemas/boxEventSchemas';

const router = Router();

router.use(authenticateToken);

router.get('/', validateQuery(boxEventQuerySchema), getBoxEvents);
router.post('/', validateBody(createBoxEventSchema), createBoxEvent);
router.put('/:id', requireRole(['admin']), validateBody(updateBoxEventSchema), updateBoxEvent);
router.delete('/:id', requireRole(['admin']), deleteBoxEvent);

export default router;
