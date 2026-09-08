import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import {
  haveSharedEndedMeetup,
  isBlockedEitherWay,
  pairUserIds,
  peerUserId,
  serializeDirectMessage,
  serializeThread,
} from "../lib/directChat";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { validateBody } from "../middleware/validate";
import { getChatIo } from "../realtime/chatSocket";

export const directRouter = Router();
directRouter.use(requireAuth);

const userIdSchema = z.object({
  userId: z.string().min(1),
});

const sendSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  clientMessageId: z.string().trim().min(8).max(64).optional(),
});

const includeThread = {
  userLow: { select: { id: true, firstName: true, fullName: true } },
  userHigh: { select: { id: true, firstName: true, fullName: true } },
  messages: {
    take: 1,
    orderBy: { createdAt: "desc" as const },
    include: {
      sender: { select: { id: true, firstName: true, fullName: true } },
    },
  },
};

async function requireThread(threadId: string, me: string) {
  const thread = await prisma.directThread.findUnique({
    where: { id: threadId },
    include: includeThread,
  });
  if (!thread) throw new AppError("Chat not found", 404);
  if (thread.userLowId !== me && thread.userHighId !== me) {
    throw new AppError("Not a member of this chat", 403);
  }
  const peer = peerUserId(thread, me);
  if (await isBlockedEitherWay(me, peer)) {
    throw new AppError("You can't message this person", 403);
  }
  return thread;
}

/** Individual (accepted + my outgoing requests) or incoming requests. */
directRouter.get("/direct", async (req: AuthedRequest, res, next) => {
  try {
    const me = req.userId!;
    const inbox = String(req.query.inbox ?? "individual");
    const blocked = await prisma.userBlock.findMany({
      where: { OR: [{ blockerId: me }, { blockedId: me }] },
      select: { blockerId: true, blockedId: true },
    });
    const blockedIds = new Set(
      blocked.map((b) => (b.blockerId === me ? b.blockedId : b.blockerId)),
    );

    const threads = await prisma.directThread.findMany({
      where: {
        OR: [{ userLowId: me }, { userHighId: me }],
        status: { in: inbox === "requests" ? ["PENDING"] : ["PENDING", "ACTIVE"] },
      },
      include: includeThread,
      orderBy: { updatedAt: "desc" },
    });

    const visible = threads.filter((t) => {
      const peer = peerUserId(t, me);
      if (blockedIds.has(peer)) return false;
      const hasMessage = (t.messages?.length ?? 0) > 0;
      if (!hasMessage) return false;
      if (inbox === "requests") {
        return t.status === "PENDING" && t.initiatedById !== me;
      }
      // Individual: accepted, or my outgoing request.
      if (t.status === "ACTIVE") return true;
      return t.status === "PENDING" && t.initiatedById === me;
    });

    res.json({
      ok: true,
      conversations: visible.map((t) => serializeThread(t, me)),
    });
  } catch (err) {
    next(err);
  }
});

/** Open or create a DM with a table-mate. */
directRouter.post(
  "/direct/open",
  validateBody(userIdSchema),
  async (req: AuthedRequest, res, next) => {
    try {
      const me = req.userId!;
      const otherId = (req.body as z.infer<typeof userIdSchema>).userId;
      if (otherId === me) throw new AppError("You can't message yourself", 400);
      if (!(await haveSharedEndedMeetup(me, otherId))) {
        throw new AppError(
          "Private chat opens after the night, if they accept",
          403,
        );
      }
      if (await isBlockedEitherWay(me, otherId)) {
        throw new AppError("You can't message this person", 403);
      }

      const pair = pairUserIds(me, otherId);
      let thread = await prisma.directThread.findUnique({
        where: {
          userLowId_userHighId: pair,
        },
        include: includeThread,
      });

      if (!thread) {
        thread = await prisma.directThread.create({
          data: {
            ...pair,
            initiatedById: me,
            status: "PENDING",
          },
          include: includeThread,
        });
      } else if (thread.status === "DECLINED") {
        thread = await prisma.directThread.update({
          where: { id: thread.id },
          data: { status: "PENDING", initiatedById: me },
          include: includeThread,
        });
      }

      res.json({ ok: true, conversation: serializeThread(thread, me) });
    } catch (err) {
      next(err);
    }
  },
);

directRouter.get("/direct/:threadId", async (req: AuthedRequest, res, next) => {
  try {
    const thread = await requireThread(String(req.params.threadId), req.userId!);
    res.json({
      ok: true,
      conversation: serializeThread(thread, req.userId!),
    });
  } catch (err) {
    next(err);
  }
});

directRouter.get(
  "/direct/:threadId/messages",
  async (req: AuthedRequest, res, next) => {
    try {
      const threadId = String(req.params.threadId);
      await requireThread(threadId, req.userId!);

      const limit = Math.min(Number(req.query.limit ?? 50) || 50, 100);
      const cursor =
        typeof req.query.cursor === "string" && req.query.cursor.length > 0
          ? req.query.cursor
          : undefined;

      const rows = await prisma.directMessage.findMany({
        where: { threadId },
        orderBy: { createdAt: "desc" },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: {
          sender: { select: { id: true, firstName: true, fullName: true } },
        },
      });

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;

      res.json({
        ok: true,
        messages: page.map(serializeDirectMessage).reverse(),
        nextCursor: hasMore ? page[page.length - 1]?.id : null,
      });
    } catch (err) {
      next(err);
    }
  },
);

directRouter.post(
  "/direct/:threadId/messages",
  validateBody(sendSchema),
  async (req: AuthedRequest, res, next) => {
    try {
      const me = req.userId!;
      const threadId = String(req.params.threadId);
      const thread = await requireThread(threadId, me);

      if (thread.status === "DECLINED") {
        throw new AppError("This chat was declined", 403);
      }
      if (thread.status === "PENDING" && thread.initiatedById !== me) {
        throw new AppError("Accept the request before you reply", 403);
      }
      if (thread.status === "PENDING" && thread.initiatedById === me) {
        const already = await prisma.directMessage.findFirst({
          where: { threadId, senderId: me },
          select: { id: true },
        });
        if (already) {
          throw new AppError("Waiting for them to accept", 403);
        }
      }

      const body = req.body as z.infer<typeof sendSchema>;

      if (body.clientMessageId) {
        const existing = await prisma.directMessage.findFirst({
          where: { threadId, clientMessageId: body.clientMessageId },
          include: {
            sender: { select: { id: true, firstName: true, fullName: true } },
          },
        });
        if (existing) {
          res.json({
            ok: true,
            message: serializeDirectMessage(existing),
            duplicate: true,
          });
          return;
        }
      }

      const created = await prisma.$transaction(async (tx) => {
        const msg = await tx.directMessage.create({
          data: {
            threadId,
            senderId: me,
            body: body.body,
            clientMessageId: body.clientMessageId,
          },
          include: {
            sender: { select: { id: true, firstName: true, fullName: true } },
          },
        });
        await tx.directThread.update({
          where: { id: threadId },
          data: { updatedAt: new Date() },
        });
        return msg;
      });

      const payload = serializeDirectMessage(created);
      const io = getChatIo();
      io?.to(`dm:${threadId}`).emit("message.created", {
        eventId: created.id,
        eventType: "message.created",
        conversationId: threadId,
        messageId: created.id,
        serverTimestamp: created.createdAt.toISOString(),
        payload: { message: payload, kind: "DIRECT" },
      });
      const peer = peerUserId(thread, me);
      io?.to(`user:${peer}`).emit("direct.updated", {
        threadId,
        status: thread.status,
      });

      res.status(201).json({ ok: true, message: payload });
    } catch (err) {
      next(err);
    }
  },
);

directRouter.post(
  "/direct/:threadId/accept",
  async (req: AuthedRequest, res, next) => {
    try {
      const me = req.userId!;
      const thread = await requireThread(String(req.params.threadId), me);
      if (thread.status !== "PENDING") {
        res.json({ ok: true, conversation: serializeThread(thread, me) });
        return;
      }
      if (thread.initiatedById === me) {
        throw new AppError("Waiting for them to accept", 400);
      }
      const updated = await prisma.directThread.update({
        where: { id: thread.id },
        data: { status: "ACTIVE" },
        include: includeThread,
      });
      res.json({ ok: true, conversation: serializeThread(updated, me) });
    } catch (err) {
      next(err);
    }
  },
);

directRouter.post(
  "/direct/:threadId/decline",
  async (req: AuthedRequest, res, next) => {
    try {
      const me = req.userId!;
      const thread = await requireThread(String(req.params.threadId), me);
      if (thread.initiatedById === me) {
        throw new AppError("You can't decline your own request", 400);
      }
      const updated = await prisma.directThread.update({
        where: { id: thread.id },
        data: { status: "DECLINED" },
        include: includeThread,
      });
      res.json({ ok: true, conversation: serializeThread(updated, me) });
    } catch (err) {
      next(err);
    }
  },
);

directRouter.post(
  "/direct/:userId/block",
  async (req: AuthedRequest, res, next) => {
    try {
      const me = req.userId!;
      const otherId = String(req.params.userId);
      if (otherId === me) throw new AppError("You can't block yourself", 400);
      await prisma.userBlock.upsert({
        where: {
          blockerId_blockedId: { blockerId: me, blockedId: otherId },
        },
        create: { blockerId: me, blockedId: otherId },
        update: {},
      });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);
