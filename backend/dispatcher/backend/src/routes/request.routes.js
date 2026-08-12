import express from 'express';
import { handleCreateRequest, handleGetRequests, handleGetRequestEvents, handleGetRequestById, handleUpdateStatus, handleAddNote , handleDeleteRequest , handleDeleteNote , handleGetEvents } from '../controllers/request.controllers.js';
import { authenticate_token } from '../middleware/auth.middleware.js';
import { createRequestLimiter } from '../middleware/rateLimiter.js';
import { requireAdmin, requireAgentOrAdmin } from '../middleware/roleChecker.js';

const router = express.Router();


// AGENT + ADMIN
router.get('/', authenticate_token, requireAgentOrAdmin, handleGetRequests);
router.get('/events', authenticate_token, requireAdmin, handleGetEvents);
router.get('/:id', authenticate_token, requireAgentOrAdmin, handleGetRequestById);
router.patch('/:id/status', authenticate_token, requireAgentOrAdmin, handleUpdateStatus);
router.post('/:id/notes', authenticate_token, requireAgentOrAdmin, handleAddNote);

// ADMIN only
router.delete('/:id', authenticate_token, requireAdmin, handleDeleteRequest);
router.delete('/:id/notes/:noteId', authenticate_token, requireAdmin, handleDeleteNote);

export default router;