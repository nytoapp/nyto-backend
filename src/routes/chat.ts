import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { getTableChatWindow, publicUserBrief } from "../lib/tableChat";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { validateBody } from "../middleware/validate";
import { getChatIo } from "../realtime/chatSocket";

export const chatRouter = Router();
chatRouter.use(requireAuth);

const sendSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  clientMessageId: z.string().trim().min(8).max(64).optional(),
});

async function requireTableMember(tableId: string, userId: string) {
  const member = await prisma.tableMember.findUnique({
    where: { tableId_userId: { tableId, userId } },
  });
  if (!member) throw new AppError("Not a member of this table chat", 403);
  return member;
}

function serializeMessage(msg: {
  id: string;
  tableId: string;
  senderId: string;
  body: string;
  clientMessageId: string | null;
  createdAt: Date;
  sender: { id: string; firstName: string | null; fullName: string };
}) {
  return {
    id: msg.id,
    tableId: msg.tableId,
    body: msg.body,
    clientMessageId: msg.clientMessageId,
    createdAt: msg.createdAt.toISOString(),
    sender: publicUserBrief(msg.sender),
  };
}

/** List table chats for the signed-in user (from TableMember). */
chatRouter.get("/conversations", async (req: AuthedRequest, res, next) => {
  try {
    const memberships = await prisma.tableMember.findMany({
      where: { userId: req.userId },
      include: {
        table: {
          include: {
            venue: true,
            messages: {
              orderBy: { createdAt: "desc" },
              take: 1,
              include: {
                sender: {
                  select: { id: true, firstName: true, fullName: true },
                },
              },
            },
            _count: { select: { members: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const conversations = memberships.map((m) => {
      const table = m.table;
      const window = getTableChatWindow(table);
      const last = table.messages[0] ?? null;
      return {
        type: "TABLE_GROUP" as const,
        tableId: table.id,
        venueName: table.venue.name,
        city: table.venue.city,
        startsAt: table.startsAt.toISOString(),
        capacity: table.capacity,
        memberCount: table._count.members,
        chat: window,
        lastMessage: last
          ? {
              body: last.body,
              createdAt: last.createdAt.toISOString(),
              senderName: publicUserBrief(last.sender).firstName,
            }
          : null,
      };
    });

    res.json({ ok: true, conversations });
  } catch (err) {
    next(err);
  }
});

/** Table chat meta + members. */
chatRouter.get("/tables/:tableId", async (req: AuthedRequest, res, next) => {
  try {
    const tableId = String(req.params.tableId);
    await requireTableMember(tableId, req.userId!);

    const table = await prisma.supperTable.findUnique({
      where: { id: tableId },
      include: {
        venue: true,
        members: {
          include: {
            user: { select: { id: true, firstName: true, fullName: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!table) throw new AppError("Table not found", 404);

    const window = getTableChatWindow(table);
    res.json({
      ok: true,
      conversation: {
        type: "TABLE_GROUP",
        tableId: table.id,
        venueName: table.venue.name,
        city: table.venue.city,
        startsAt: table.startsAt.toISOString(),
        capacity: table.capacity,
        status: table.status,
        chat: window,
        members: table.members.map((m) => ({
          ...publicUserBrief(m.user),
          isYou: m.userId === req.userId,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

/** Cursor-paginated messages (newest page first; client can reverse). */
chatRouter.get(
  "/tables/:tableId/messages",
  async (req: AuthedRequest, res, next) => {
    try {
      const tableId = String(req.params.tableId);
      await requireTableMember(tableId, req.userId!);

      const limit = Math.min(
        Number(req.query.limit ?? 50) || 50,
        100,
      );
      const cursor =
        typeof req.query.cursor === "string" && req.query.cursor.length > 0
          ? req.query.cursor
          : undefined;

      const rows = await prisma.chatMessage.findMany({
        where: { tableId },
        orderBy: { createdAt: "desc" },
        take: limit + 1,
        ...(cursor
          ? {
              cursor: { id: cursor },
              skip: 1,
            }
          : {}),
        include: {
          sender: { select: { id: true, firstName: true, fullName: true } },
        },
      });

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore ? page[page.length - 1]?.id : null;

      res.json({
        ok: true,
        messages: page.map(serializeMessage).reverse(),
        nextCursor,
      });
    } catch (err) {
      next(err);
    }
  },
);

chatRouter.post(
  "/tables/:tableId/messages",
  validateBody(sendSchema),
  async (req: AuthedRequest, res, next) => {
    try {
      const tableId = String(req.params.tableId);
      const userId = req.userId!;
      await requireTableMember(tableId, userId);

      const table = await prisma.supperTable.findUnique({
        where: { id: tableId },
      });
      if (!table) throw new AppError("Table not found", 404);

      const window = getTableChatWindow(table);
      if (!window.canSend) {
        throw new AppError(
          "This table chat has ended. You can still message participants individually.",
          403,
        );
      }

      const body = req.body as z.infer<typeof sendSchema>;

      if (body.clientMessageId) {
        const existing = await prisma.chatMessage.findFirst({
          where: {
            tableId,
            clientMessageId: body.clientMessageId,
          },
          include: {
            sender: { select: { id: true, firstName: true, fullName: true } },
          },
        });
        if (existing) {
          res.json({ ok: true, message: serializeMessage(existing), duplicate: true });
          return;
        }
      }

      const created = await prisma.chatMessage.create({
        data: {
          tableId,
          senderId: userId,
          body: body.body,
          clientMessageId: body.clientMessageId,
        },
        include: {
          sender: { select: { id: true, firstName: true, fullName: true } },
        },
      });

      const payload = serializeMessage(created);
      const io = getChatIo();
      io?.to(`table:${tableId}`).emit("message.created", {
        eventId: created.id,
        eventType: "message.created",
        conversationId: tableId,
        messageId: created.id,
        serverTimestamp: created.createdAt.toISOString(),
        payload: { message: payload },
      });

      res.status(201).json({ ok: true, message: payload });
    } catch (err) {
      next(err);
    }
  },
);
