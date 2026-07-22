import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env";
import { healthRouter } from "./routes/health";
import { errorHandler } from "./middleware/errorHandler";
import { notFound } from "./middleware/notFound";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN }));
  app.use(express.json({ limit: "2mb" }));
  app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));

  app.use("/health", healthRouter);

  // Feature routes land here one by one:
  // app.use("/auth", authRouter);
  // app.use("/verification", verificationRouter);
  // app.use("/profile", profileRouter);
  // app.use("/tables", tablesRouter);
  // app.use("/bookings", bookingsRouter);
  // app.use("/matches", matchesRouter);
  // app.use("/chat", chatRouter);
  // app.use("/venues", venuesRouter);
  // app.use("/operator", operatorRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
