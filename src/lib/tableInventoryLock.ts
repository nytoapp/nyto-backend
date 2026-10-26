import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/**
 * Serialize seat reservation / capture for one night.
 * Call at the start of any transaction that creates a PENDING_PAYMENT
 * hold or promotes a booking to CONFIRMED.
 *
 * Uses PostgreSQL row lock on `supper_tables` (Prisma model SupperTable).
 */
export async function lockSupperTableForInventory(
  tx: Tx,
  tableId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM supper_tables WHERE id = ${tableId} FOR UPDATE
  `;
  if (!rows.length) {
    throw new Error("TABLE_LOCK_MISS");
  }
}
