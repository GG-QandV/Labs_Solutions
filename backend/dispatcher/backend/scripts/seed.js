/** Idempotent, non-interactive seed. Runs on every container start.
 *  Upstream version prompted on stdin (readline) — that would hang the
 *  container in the Dockerfile CMD, so it is env-driven here.
 *  Creates: one admin user + a few sample requests so the dashboard
 *  renders with content on first open (AUDIT.md §3.3). */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();
const prisma = new PrismaClient();

const SAMPLES = [
  {
    customerName: 'Marta Kowalska',
    customerEmail: 'm.kowalska@example.com',
    message: 'Invoice #4471 was charged twice this month. Please refund the duplicate.',
    source: 'EMAIL',
    category: 'support', priority: 'HIGH',
    summary: 'Duplicate charge on invoice #4471, refund requested.',
    reason: 'Billing issue with financial impact, customer expects action.',
    confidence: 0.94
  },
  {
    customerName: 'Andrii Tkachenko',
    customerEmail: 'a.tkachenko@example.com',
    message: 'We are a logistics company with 40 trucks. Can your platform handle route intake by API?',
    source: 'WEB',
    category: 'sales', priority: 'MEDIUM',
    summary: 'Logistics prospect asking about API intake capacity.',
    reason: 'Pre-sales enquiry with clear qualification signals.',
    confidence: 0.88
  },
  {
    customerName: 'Telegram user',
    customerEmail: null,
    message: 'production is down, nothing loads since 10 minutes',
    source: 'TELEGRAM',
    category: 'urgent', priority: 'HIGH',
    summary: 'Reported full outage, ongoing for ~10 minutes.',
    reason: 'Service unavailability reported by a customer.',
    confidence: 0.97
  }
];

async function seedAdmin() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    console.log('seed: SEED_ADMIN_EMAIL/PASSWORD not set, skipping admin');
    return;
  }
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`seed: admin ${email} already exists`);
    return;
  }
  const user = await prisma.user.create({
    data: {
      name: process.env.SEED_ADMIN_NAME || 'Demo Admin',
      email,
      password: await bcrypt.hash(password, 10),
      role: 'ADMIN'
    }
  });
  console.log(`seed: created ADMIN ${user.email}`);
}

async function seedSamples() {
  const count = await prisma.customerRequest.count();
  if (count > 0) {
    console.log(`seed: ${count} requests already present, skipping samples`);
    return;
  }
  for (const s of SAMPLES) {
    const req = await prisma.customerRequest.create({
      data: {
        message: s.message,
        customerName: s.customerName,
        customerEmail: s.customerEmail,
        source: s.source,
        status: 'CLASSIFIED',
        categorySnapshot: s.category,
        prioritySnapshot: s.priority,
        idempotencyKey: `seed:${s.customerName}:${s.category}`
      }
    });
    await prisma.aiClassification.create({
      data: {
        requestId: req.id,
        provider: 'seed',
        category: s.category,
        priority: s.priority,
        summary: s.summary,
        confidence: s.confidence,
        reason: s.reason,
        rawOutput: JSON.stringify({ seeded: true })
      }
    });
    await prisma.requestEvent.create({
      data: {
        requestId: req.id,
        eventType: 'CREATED',
        metadata: JSON.stringify({ seeded: true })
      }
    });
    await prisma.requestEvent.create({
      data: {
        requestId: req.id,
        eventType: 'CLASSIFIED',
        newValue: 'CLASSIFIED',
        metadata: JSON.stringify({ seeded: true, category: s.category })
      }
    });
  }
  console.log(`seed: inserted ${SAMPLES.length} sample requests`);
}

async function main() {
  await seedAdmin();
  await seedSamples();
}

main()
  .catch((e) => { console.error('seed failed:', e.message); process.exitCode = 0; })
  .finally(() => prisma.$disconnect());
