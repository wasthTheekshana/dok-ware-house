import { Router } from 'express';
import { getUsers, getUserById, createUser, updateUser, changeOwnPassword } from '../controllers/userController';
import { authenticateToken, requireRole } from '../middleware/authMiddleware';
import { validateBody } from '../middleware/validationMiddleware';
import { createUserSchema, updateUserSchema, changePasswordSchema } from '../schemas/userSchemas';

const router = Router();

router.use(authenticateToken);

router.post('/me/change-password', validateBody(changePasswordSchema), changeOwnPassword);

router.get('/', requireRole(['admin']), getUsers);
router.get('/:id', requireRole(['admin']), getUserById);
router.post('/', requireRole(['admin']), validateBody(createUserSchema), createUser);
router.put('/:id', requireRole(['admin']), validateBody(updateUserSchema), updateUser);

export default router;
