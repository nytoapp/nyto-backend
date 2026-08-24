import type { SupperTable, TableStatus } from "@prisma/client";
import { env } from "../config/env";

export type TableChatLifecycle =
  | "ACTIVE"
  | "GRACE_PERIOD"
  | "DISABLED";

export type TableChatWindow = {
  state: TableChatLifecycle;
  canSend: boolean;
  eventEndsAt: string;
  chatClosesAt: string;
  gracePeriodHours: number;
  eventDurationHours: number;
};

type TableLike = Pick<SupperTable, "startsAt" | "status">;

export function getTableChatWindow(table: TableLike, now = new Date()): TableChatWindow {
  const eventDurationHours = env.TABLE_EVENT_DURATION_HOURS;
  const gracePeriodHours = env.TABLE_CHAT_GRACE_PERIOD_HOURS;

  const startsAt = new Date(table.startsAt);
  const eventEndsAt = new Date(
    startsAt.getTime() + eventDurationHours * 60 * 60 * 1000,
  );
  const chatClosesAt = new Date(
    eventEndsAt.getTime() + gracePeriodHours * 60 * 60 * 1000,
  );

  // Cancelled tables are always disabled for messaging.
  if (table.status === ("CANCELLED" as TableStatus)) {
    return {
      state: "DISABLED",
      canSend: false,
      eventEndsAt: eventEndsAt.toISOString(),
      chatClosesAt: chatClosesAt.toISOString(),
      gracePeriodHours,
      eventDurationHours,
    };
  }

  if (now.getTime() < eventEndsAt.getTime()) {
    return {
      state: "ACTIVE",
      canSend: true,
      eventEndsAt: eventEndsAt.toISOString(),
      chatClosesAt: chatClosesAt.toISOString(),
      gracePeriodHours,
      eventDurationHours,
    };
  }

  if (now.getTime() < chatClosesAt.getTime()) {
    return {
      state: "GRACE_PERIOD",
      canSend: true,
      eventEndsAt: eventEndsAt.toISOString(),
      chatClosesAt: chatClosesAt.toISOString(),
      gracePeriodHours,
      eventDurationHours,
    };
  }

  return {
    state: "DISABLED",
    canSend: false,
    eventEndsAt: eventEndsAt.toISOString(),
    chatClosesAt: chatClosesAt.toISOString(),
    gracePeriodHours,
    eventDurationHours,
  };
}

export function publicUserBrief(user: {
  id: string;
  firstName: string | null;
  fullName: string;
}) {
  const name =
    (user.firstName && user.firstName.trim()) ||
    (user.fullName && user.fullName.trim()) ||
    "Guest";
  return {
    id: user.id,
    firstName: name,
    initial: name[0]?.toUpperCase() ?? "?",
  };
}
