import {
  HostApplicationStatus,
  UserRole,
  VenueStaffRole,
} from "@prisma/client";
import { prisma } from "./prisma";
import { AppError } from "../middleware/errorHandler";

/**
 * Approve a pending host application:
 * - create venue (or link existing)
 * - assign applicant as OWNER staff
 * - elevate USER → VENUE_STAFF if needed
 * Never called from client role claims.
 */
export async function approveHostApplication(opts: {
  applicationId: string;
  adminUserId: string;
  /** Optional override — otherwise create from application fields. */
  venueId?: string;
}) {
  const app = await prisma.hostApplication.findUnique({
    where: { id: opts.applicationId },
    include: { user: { select: { id: true, role: true } } },
  });
  if (!app) throw new AppError("Host application not found", 404);
  if (app.status !== HostApplicationStatus.PENDING) {
    throw new AppError(`Application is already ${app.status.toLowerCase()}`);
  }

  return prisma.$transaction(async (tx) => {
    let venueId = opts.venueId ?? app.venueId;
    if (venueId) {
      const venue = await tx.venue.findUnique({ where: { id: venueId } });
      if (!venue) throw new AppError("Venue not found", 404);
    } else {
      const venue = await tx.venue.create({
        data: {
          name: app.venueName,
          address: app.address,
          city: app.city,
          area: app.area,
          isActive: true,
        },
      });
      venueId = venue.id;
    }

    if (app.user.role === UserRole.USER) {
      await tx.user.update({
        where: { id: app.userId },
        data: { role: UserRole.VENUE_STAFF },
      });
    }

    await tx.venueStaff.upsert({
      where: {
        userId_venueId: { userId: app.userId, venueId },
      },
      create: {
        userId: app.userId,
        venueId,
        staffRole: VenueStaffRole.OWNER,
        isActive: true,
      },
      update: {
        staffRole: VenueStaffRole.OWNER,
        isActive: true,
      },
    });

    const updated = await tx.hostApplication.update({
      where: { id: app.id },
      data: {
        status: HostApplicationStatus.APPROVED,
        venueId,
        reviewedById: opts.adminUserId,
        reviewedAt: new Date(),
        rejectionReason: null,
      },
      include: {
        venue: true,
        user: {
          select: {
            id: true,
            firstName: true,
            fullName: true,
            phone: true,
            email: true,
            role: true,
          },
        },
      },
    });

    return updated;
  });
}

export async function rejectHostApplication(opts: {
  applicationId: string;
  adminUserId: string;
  reason?: string;
}) {
  const app = await prisma.hostApplication.findUnique({
    where: { id: opts.applicationId },
  });
  if (!app) throw new AppError("Host application not found", 404);
  if (app.status !== HostApplicationStatus.PENDING) {
    throw new AppError(`Application is already ${app.status.toLowerCase()}`);
  }

  return prisma.hostApplication.update({
    where: { id: app.id },
    data: {
      status: HostApplicationStatus.REJECTED,
      reviewedById: opts.adminUserId,
      reviewedAt: new Date(),
      rejectionReason: opts.reason?.trim() || null,
    },
  });
}
