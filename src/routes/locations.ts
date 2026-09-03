import { Router } from "express";
import { z } from "zod";
import {
  HYDERABAD_AREAS,
  LAUNCH_CITY,
  nearestHyderabadArea,
} from "../lib/hyderabadAreas";
import { validateBody } from "../middleware/validate";

export const locationsRouter = Router();

locationsRouter.get("/launch", (_req, res) => {
  res.json({
    ok: true,
    city: LAUNCH_CITY,
    areas: [
      { id: "ALL", name: "All areas", kind: "all" },
      ...HYDERABAD_AREAS.map((name) => ({
        id: name,
        name,
        kind: "area" as const,
      })),
    ],
  });
});

const nearestSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
});

locationsRouter.post(
  "/nearest-area",
  validateBody(nearestSchema),
  (req, res) => {
    const body = req.body as z.infer<typeof nearestSchema>;
    const area = nearestHyderabadArea(body.lat, body.lng);
    res.json({
      ok: true,
      city: LAUNCH_CITY,
      area,
    });
  },
);
