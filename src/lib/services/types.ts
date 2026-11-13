import type { Prisma } from "@prisma/client";
import { db } from "../db";

export type ServiceStore = Prisma.TransactionClient;

export type ServiceActor = {
  environmentId: string;
  organizationId: string;
  actorId: string | null;
  actorName: string;
  ip?: string | null;
};

export function storeOf(store?: ServiceStore): Prisma.TransactionClient {
  return store ?? (db as unknown as Prisma.TransactionClient);
}
