import { createRequest, getRequestEvents,getRequests,getRequestById,updateRequestStatus,addNote, deleteRequest,deleteNote,getAllEvents } from '../services/request.services.js';
import z from 'zod'

const createRequestSchema = z.object({
    message: z.string().min(1,'Message is required'),
    customerName: z.string().min(1,'Customer name is required'),
    customerEmail: z.string().email().optional(),
    customerPhone: z.string().optional(),
    source: z.enum(['WEB','EMAIL','TELEGRAM','API']).default('WEB')
});

export const handleCreateRequest = async (req, res) => {
  const result = createRequestSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.flatten() });
  }
  const { request, duplicate } = await createRequest(result.data);
  if (duplicate) {
    return res.status(200).json({ 
      success: true, 
      duplicate: true,
      message: 'Request already exists',
      request 
    });
  }
  return res.status(201).json({ success: true, duplicate: false, request });
};

export const handleGetRequests = async (req, res) => {
  const { status, priority, category, page, limit } = req.query;
  const data = await getRequests({ status, priority, category, page, limit });
  return res.json({ success: true, ...data });
};

export const handleGetRequestById = async (req, res) => {
  const request = await getRequestById(req.params.id);
  return res.json({ success: true, request });
};

export const handleGetRequestEvents = async (req, res) => {
  const { page, limit } = req.query;
  const data = await getRequestEvents({ page, limit });
  return res.json({ success: true, ...data });
};

export const handleUpdateStatus = async (req, res) => {
  try{
  const { status } = req.body;
    const allowed = ['NEW', 'QUEUED', 'PROCESSING', 'CLASSIFIED', 'RESOLVED', 'FAILED'];
    if (!status || !allowed.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const request = await updateRequestStatus(req.params.id, status , req.user.id);
    return res.json({ success: true, request });
  }
  catch(err){
    return res.status(500).json({ error: "Update status error"})
  }
};

export const handleAddNote = async (req, res) => {
  const { body } = req.body;
  if (!body || body.trim() === '') {
    return res.status(400).json({ error: 'Note body is required' });
  }

  const note = await addNote(req.params.id, body.trim(), req.user.id);
  return res.json({ success: true, note });
};

export const handleDeleteRequest = async (req,res) => {
  try{
    await deleteRequest(req.params.id);
    return res.status(200).json({ success: true , message : "Request Deleted"})
  }
  catch(err){
    res.status(404).json({ success: false , message : err.message })
  }
}

export const handleDeleteNote = async (req, res) => {
  try {
    await deleteNote(req.params.noteId, req.user.id);
    return res.json({ success: true, message: 'Note deleted' });
  } catch (err) {
    return res.status(err.message === 'Unauthorized' ? 403 : 404).json({ 
      success: false, 
      message: err.message 
    });
  }
};

export const handleGetEvents = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const events = await getAllEvents(limit);
    return res.json({ success: true, events });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};