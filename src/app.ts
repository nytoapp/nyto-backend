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
import { adminRouter } from "./routes/admin";
import { venueRouter } from "./routes/venuePortal";
import { locationsRouter } from "./routes/locations";
import { hostApplicationsRouter } from "./routes/hostApplications";
import { errorHandler } from "./middleware/errorHandler";
import { notFound } from "./middleware/notFound";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN }));
  app.use(express.json({ limit: "2mb" }));
  app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));

  // Rate limiters key on client IP, so the proxy chain must be trusted.
  app.set("trust proxy", 1);

  app.use("/health", healthRouter);
  app.use("/auth", authRouter);
  app.use("/tables", tablesRouter);
  app.use("/bookings", bookingsRouter);
  app.use("/verification", verificationRouter);
  app.use("/chat", chatRouter);
  app.use("/chat", directRouter);
  app.use("/admin", adminRouter);
  app.use("/venue", venueRouter);
  app.use("/locations", locationsRouter);
  app.use("/host-applications", hostApplicationsRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
