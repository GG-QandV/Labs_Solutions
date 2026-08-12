import prisma from '../config/psql.js';
import { requestQueue } from '../queues/requestQueue.js';
import { createHash } from 'crypto';
import { publishRequestEvent } from '../utils/eventPublisher.js';

const createRequestEvent = async (data) => {
    const event = await prisma.requestEvent.create({ data });
    await publishRequestEvent(event);
    return event;
};

export const createRequest = async (data) => {
  const idempotencyKey = createHash('sha256')
    .update(`${data.customerEmail ?? data.customerName}-${data.message}`)
    .digest('hex');

  const existing = await prisma.customerRequest.findUnique({
    where: { idempotencyKey },
  });

  if (existing) {
    await prisma.customerRequest.update({
      where: { id: existing.id },
      data: { updatedAt: new Date() },
    });
    return { request: existing, duplicate: true };
  }

  const request = await prisma.customerRequest.create({
    data: {
      message: data.message,
      customerName: data.customerName,
      customerEmail: data.customerEmail ?? null,
      customerPhone: data.customerPhone ?? null,
      source: data.source ?? 'WEB',
      status: 'NEW',
      idempotencyKey,
    },
  });

  await createRequestEvent({
    requestId: request.id,
    eventType: 'REQUEST_CREATED',
    newValue: 'NEW',
    metadata: JSON.stringify({ source: request.source }),
  });

  await requestQueue.add('classify', { requestId: request.id }, {
    delay: 500,
  });

  await prisma.customerRequest.update({
    where: { id: request.id },
    data: { status: 'QUEUED' },
  });

  await createRequestEvent({
    requestId: request.id,
    eventType: 'STATUS_CHANGED',
    oldValue: 'NEW',
    newValue: 'QUEUED',
    metadata: JSON.stringify({ trigger: 'enqueued' }),
  });

  return { request, duplicate: false };
};

export const getRequests = async (filters) => {
  const { status, priority, category, page = 1, limit = 10 } = filters;

  const where = {};
  if (status) where.status = status;
  if (priority) where.prioritySnapshot = priority;
  if (category) where.categorySnapshot = category;

  const [requests, total] = await Promise.all([
    prisma.customerRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: Number(limit),
      include: { aiClassification: true},
    }),
    prisma.customerRequest.count({ where }),
  ]);

  return { requests,total,page: Number(page),totalPages: Math.ceil(total / limit) };
};

export const getRequestEvents = async (filters) => {
  const { page = 1, limit = 100 } = filters;
  const total = await prisma.requestEvent.count();
  const events = await prisma.requestEvent.findMany({
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * limit,
    take: Number(limit),
    include: { actor: true },
  });
  return {
    events,
    total,
    page: Number(page),
    totalPages: Math.ceil(total / limit),
  };
};

export const getRequestById = async (id) => {
  const request = await prisma.customerRequest.findUnique({
    where: { id },
    include: { aiClassification: true,requestEvents: { orderBy: { createdAt: 'asc' } }, internalNotes: { orderBy: { createdAt: 'asc' },include: { author: { select: { id: true, name: true, email: true } }, }, },},
  });
  if (!request) throw new Error('Request not found');
  return request;
};

export const updateRequestStatus = async (id, status , actorId) => {
  const request = await prisma.customerRequest.findUnique({ where: { id } });
  if (!request) throw new Error('Request not found');
  const updated = await prisma.customerRequest.update({ where: { id }, data: { status },});
  await createRequestEvent({
    requestId: id,
    eventType: 'STATUS_CHANGED',
    oldValue: request.status,
    newValue: status,
    actorId,
    metadata: JSON.stringify({ trigger: 'admin_update' }),
  });
  return updated;
};

// requestService.js
export const addNote = async (id, body, userId) => {
  const request = await prisma.CustomerRequest.findUnique({ where: { id } });
  if (!request) throw new Error('Request not found');

  const note = await prisma.InternalNote.create({
    data: { requestId: id, body, authorId: userId },
    include: {
      author: { select: { id: true, name: true, email: true } },
    },
  });

  await prisma.RequestEvent.create({
    data: { requestId: id, eventType: 'NOTE_ADDED', newValue: body },
  });

  return note;
};

export const deleteRequest = async (id) => {
  const request = await prisma.CustomerRequest.findUnique({ where: {id}});
  if(!request) throw new Error('Request not found');
  await prisma.CustomerRequest.delete({ where : { id}});
  return { message: "Deleted successfuly"}
}

export const deleteNote = async (noteId, userId) => {
  const note = await prisma.InternalNote.findUnique({ where: { id: noteId } });
  if (!note) throw new Error('Note not found');
  if (note.authorId !== userId) throw new Error('Unauthorized');
  
  await prisma.InternalNote.delete({ where: { id: noteId } });
  return { message: 'Note deleted' };
};

export const getAllEvents = async (limit = 100) => {
  return prisma.RequestEvent.findMany({
    take: limit,
    orderBy: { createdAt: 'desc' },
    include: {
      actor: { select: { id: true, name: true, email: true } },
    },
  });
};