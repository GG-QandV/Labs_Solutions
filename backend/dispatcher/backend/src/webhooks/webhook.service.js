import prisma from '../config/psql.js'
import { requestQueue } from '../queues/requestQueue.js'

export const sanitizeMessage = (text) => {
  return text
    .replace(/[`\\]/g, '')
    .slice(0, 1000)
}

export const ingestRequest = async ({ 
  message, 
  customerName, 
  customerEmail = null,
  source,
  actor, 
  metadata = {} 
}) => {
  const sanitized = sanitizeMessage(message)

  const request = await prisma.CustomerRequest.create({
    data: {
      message: sanitized,
      customerName,
      customerEmail,
      source,
      status: 'NEW'
    }
  })

  await prisma.RequestEvent.create({
    data: {
      requestId: request.id,
      eventType: 'CREATED',
      metadata: JSON.stringify(metadata)
    }
  })

  await requestQueue.add('classify', { requestId: request.id })

  // audit-trail: NEW -> QUEUED фиксируется здесь, иначе воркер логирует
  // переход QUEUED->PROCESSING из состояния, которого в БД не было
  await prisma.CustomerRequest.update({
    where: { id: request.id },
    data: { status: 'QUEUED' }
  })

  await prisma.RequestEvent.create({
    data: {
      requestId: request.id,
      eventType: 'STATUS_CHANGED',
      oldValue: 'NEW',
      newValue: 'QUEUED',
      metadata: JSON.stringify({ trigger: 'enqueued' })
    }
  })

  return { ...request, status: 'QUEUED' }
}