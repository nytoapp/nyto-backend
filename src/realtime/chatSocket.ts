import type { Server as HttpServer } from "http";
import { Server } from "socket.io";
import { env } from "../config/env";
import { isSessionActive, verifyAccessToken } from "../lib/tokens";
import { prisma } from "../lib/prisma";

let chatIo: Server | null = null;

export function getChatIo(): Server | null {
  return chatIo;
}

export function attachChatSocket(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    path: "/socket.io",
    cors: {
      origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN,
    },
  });

  io.use(async (socket, next) => {
    try {
      const token =
        (socket.handshake.auth?.token as string | undefined) ||
        (typeof socket.handshake.headers.authorization === "string" &&
        socket.handshake.headers.authorization.startsWith("Bearer ")
          ? socket.handshake.headers.authorization.slice(7)
          : undefined);

      if (!token) return next(new Error("Unauthorized"));
      const payload = verifyAccessToken(token);
      if (!(await isSessionActive(payload.sid))) {
        return next(new Error("Unauthorized"));
      }
      socket.data.userId = payload.userId;
      return next();
    } catch {
      return next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.data.userId as string;
    void socket.join(`user:${userId}`);

    socket.on("table.join", async (raw: unknown, ack?: (res: unknown) => void) => {
      try {
        const tableId =
          typeof raw === "string"
            ? raw
            : raw && typeof raw === "object" && "tableId" in raw
              ? String((raw as { tableId: string }).tableId)
              : "";
        if (!tableId) {
          ack?.({ ok: false, error: "tableId required" });
          return;
        }

        const member = await prisma.tableMember.findUnique({
          where: { tableId_userId: { tableId, userId } },
        });
        if (!member) {
          ack?.({ ok: false, error: "Forbidden" });
          return;
        }

        await socket.join(`table:${tableId}`);
        ack?.({ ok: true, tableId });
      } catch (err) {
        ack?.({
          ok: false,
          error: err instanceof Error ? err.message : "Join failed",
        });
      }
    });

    socket.on("table.leave", (raw: unknown) => {
      const tableId =
        typeof raw === "string"
          ? raw
          : raw && typeof raw === "object" && "tableId" in raw
            ? String((raw as { tableId: string }).tableId)
            : "";
      if (tableId) void socket.leave(`table:${tableId}`);
    });

    socket.on("dm.join", async (raw: unknown, ack?: (res: unknown) => void) => {
      try {
        const threadId =
          typeof raw === "string"
            ? raw
            : raw && typeof raw === "object" && "threadId" in raw
              ? String((raw as { threadId: string }).threadId)
              : "";
        if (!threadId) {
          ack?.({ ok: false, error: "threadId required" });
          return;
        }
        const thread = await prisma.directThread.findUnique({
          where: { id: threadId },
          select: { userLowId: true, userHighId: true },
        });
        if (
          !thread ||
          (thread.userLowId !== userId && thread.userHighId !== userId)
        ) {
          ack?.({ ok: false, error: "Forbidden" });
          return;
        }
        await socket.join(`dm:${threadId}`);
        ack?.({ ok: true, threadId });
      } catch (err) {
        ack?.({
          ok: false,
          error: err instanceof Error ? err.message : "Join failed",
        });
      }
    });

    socket.on("dm.leave", (raw: unknown) => {
      const threadId =
        typeof raw === "string"
          ? raw
          : raw && typeof raw === "object" && "threadId" in raw
            ? String((raw as { threadId: string }).threadId)
            : "";
      if (threadId) void socket.leave(`dm:${threadId}`);
    });
  });

  chatIo = io;
  return io;
}
