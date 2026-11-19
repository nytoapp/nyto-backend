import { TableStatus } from "@prisma/client";

/**
 * Statuses that can still take a seat. REVEALED is included so the 24h
 * mate-unlock does not pull a night off Home while seats remain.
 */
export function isOpenForNewSeats(status: TableStatus): boolean {
  return (
    status === TableStatus.OPEN ||
    status === TableStatus.MATCHING ||
    status === TableStatus.REVEALED
  );
}

export const OPEN_FOR_SEATS: TableStatus[] = [
  TableStatus.OPEN,
  TableStatus.MATCHING,
  TableStatus.REVEALED,
];
