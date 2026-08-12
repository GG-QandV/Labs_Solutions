import express from 'express';
import { login,refresh,logout } from '../controllers/auth.controllers.js';
import { authenticate_token, cookie_validator, } from '../middleware/auth.middleware.js';
import { authLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

router.post('/login',authLimiter,login);
router.post('/refresh',cookie_validator,refresh);
router.post('/logout',logout);

export default router;