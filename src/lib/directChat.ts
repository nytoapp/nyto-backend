import { prisma } from "./prisma";
import { publicUserBrief, getTableChatWindow } from "./tableChat";

export function pairUserIds(a: string, b: string) {
  return a < b
    ? { userLowId: a, userHighId: b }
    : { userLowId: b, userHighId: a };
}

export function peerUserId(
  thread: { userLowId: string; userHighId: string },
  me: string,
) {
  return thread.userLowId === me ? thread.userHighId : thread.userLowId;
}

export async function haveSharedTable(userId: string, otherId: string) {
  const hit = await prisma.tableMember.findFirst({
    where: {
      userId,
      table: { members: { some: { userId: otherId } } },
    },
    select: { id: true },
  });
  return Boolean(hit);
}

/** Private DMs only after a shared meetup has ended — not during the table chat. */
export async function haveSharedEndedMeetup(
  userId: string,
  otherId: string,
  now = new Date(),
) {
  const memberships = await prisma.tableMember.findMany({
    where: {
      userId,
      table: {
        status: { not: "CANCELLED" },
        members: { some: { userId: otherId } },
      },
    },
    select: {
      table: { select: { startsAt: true, status: true } },
    },
  });
  return memberships.some((row) => {
    const window = getTableChatWindow(row.table, now);
    return now.getTime() >= new Date(window.eventEndsAt).getTime();
  });
}

export async function isBlockedEitherWay(a: string, b: string) {
  const row = await prisma.userBlock.findFirst({
    where: {
      OR: [
        { blockerId: a, blockedId: b },
        { blockerId: b, blockedId: a },
      ],
    },
    select: { id: true },
  });
  return Boolean(row);
}

export function serializeDirectMessage(msg: {
  id: string;
  threadId: string;
  senderId: string;
  body: string;
  clientMessageId: string | null;
  createdAt: Date;
  sender: { id: string; firstName: string | null; fullName: string };
}) {
  return {
    id: msg.id,
    threadId: msg.threadId,
    body: msg.body,
    clientMessageId: msg.clientMessageId,
    createdAt: msg.createdAt.toISOString(),
    sender: publicUserBrief(msg.sender),
  };
}

export function serializeThread(
  thread: {
    id: string;
    initiatedById: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
    userLowId: string;
    userHighId: string;
    userLow: { id: string; firstName: string | null; fullName: string };
    userHigh: { id: string; firstName: string | null; fullName: string };
    messages?: Array<{
      id: string;
      body: string;
      createdAt: Date;
      sender: { id: string; firstName: string | null; fullName: string };
    }>;
  },
  me: string,
) {
    const peer = thread.userLowId === me ? thread.userHigh : thread.userLow;
  const last = thread.messages?.[0];
  return {
    type: "DIRECT",
    threadId: thread.id,
    status: thread.status,
    initiatedByMe: thread.initiatedById === me,
    peer: publicUserBrief(peer),
    lastMessage: last
      ? {
          id: last.id,
          body: last.body,
          createdAt: last.createdAt.toISOString(),
          senderName: publicUserBrief(last.sender).firstName,
        }
      : null,
    updatedAt: thread.updatedAt.toISOString(),
  };
}
