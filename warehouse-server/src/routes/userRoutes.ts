import { Router } from 'express';
import { getUsers, getUserById, createUser, updateUser } from '../controllers/userController';
import { authenticateToken, requireRole } from '../middleware/authMiddleware';
import { validateBody } from '../middleware/validationMiddleware';
import { createUserSchema, updateUserSchema } from '../schemas/userSchemas';

const router = Router();

router.use(authenticateToken);

router.get('/', requireRole(['admin']), getUsers);
router.get('/:id', requireRole(['admin']), getUserById);
router.post('/', requireRole(['admin']), validateBody(createUserSchema), createUser);
router.put('/:id', requireRole(['admin']), validateBody(updateUserSchema), updateUser);

export default router;
