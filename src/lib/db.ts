import { PrismaClient } from '@prisma/client'
import { installTruthGuards } from './strict-enforcement/truth-guards'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient() {
  const client = new PrismaClient({
    log: process.env.DEBUG_PRISMA === '1' ? ['query'] : [],
  })

  installTruthGuards(client)

  return client
}

export const db =
  globalForPrisma.prisma ??
  createPrismaClient()

export const prisma = db

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
