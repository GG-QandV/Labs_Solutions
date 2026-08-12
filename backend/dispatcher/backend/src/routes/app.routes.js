import express from "express";
import requestsRouter from './request.routes.js';
import authRoutes from './auth.routes.js'

const router = express.Router();

router.use('/auth',authRoutes);
router.use('/requests', requestsRouter);

export default router