import { Router } from 'express';
import { getUsers, getUserById, createUser, updateUser, changeOwnPassword } from '../controllers/userController';
import { authenticateToken } from '../middleware/authMiddleware';
import { requirePermission } from '../middleware/permissionMiddleware';
import { validateBody } from '../middleware/validationMiddleware';
import { createUserSchema, updateUserSchema, changePasswordSchema } from '../schemas/userSchemas';

const router = Router();

router.use(authenticateToken);

router.post('/me/change-password', validateBody(changePasswordSchema), changeOwnPassword);

router.get('/', requirePermission('manage_users'), getUsers);
router.get('/:id', requirePermission('manage_users'), getUserById);
router.post('/', requirePermission('manage_users'), validateBody(createUserSchema), createUser);
router.put('/:id', requirePermission('manage_users'), validateBody(updateUserSchema), updateUser);

export default router;
