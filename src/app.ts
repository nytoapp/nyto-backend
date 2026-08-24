import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env";
import { healthRouter } from "./routes/health";
import { authRouter } from "./routes/auth";
import { tablesRouter } from "./routes/tables";
import { bookingsRouter } from "./routes/bookings";
import { verificationRouter } from "./routes/verification";
import { chatRouter } from "./routes/chat";
import { directRouter } from "./routes/direct";
import { errorHandler } from "./middleware/errorHandler";
import { notFound } from "./middleware/notFound";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN }));
  app.use(express.json({ limit: "2mb" }));
  app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));

  app.use("/health", healthRouter);
  app.use("/auth", authRouter);
  app.use("/tables", tablesRouter);
  app.use("/bookings", bookingsRouter);
  app.use("/verification", verificationRouter);
  app.use("/chat", chatRouter);
  app.use("/chat", directRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
