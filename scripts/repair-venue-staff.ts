/**
 * Ensure venue@nyto.app owns only the Ameerpet PARTNER kitchen.
 * Usage: npx tsx scripts/repair-venue-staff.ts
 */
import "dotenv/config";
import { VenueHostedBy, VenueStaffRole } from "@prisma/client";
import { prisma } from "../src/lib/prisma";

async function main() {
  const user = await prisma.user.findUnique({
    where: { email: "venue@nyto.app" },
  });
  if (!user) {
    throw new Error("venue@nyto.app missing — run npm run seed");
  }

  let partner =
    (await prisma.venue.findFirst({
      where: {
        hostedBy: VenueHostedBy.PARTNER,
        isActive: true,
        name: { contains: "Ameerpet", mode: "insensitive" },
      },
    })) ??
    (await prisma.venue.findFirst({
      where: { hostedBy: VenueHostedBy.PARTNER, isActive: true },
    }));

  if (!partner) {
    partner = await prisma.venue.create({
      data: {
        name: "Ameerpet Kitchen",
        address: "Ameerpet Cross Roads, Hyderabad",
        city: "Hyderabad",
        area: "Ameerpet",
        hostedBy: VenueHostedBy.PARTNER,
      },
    });
  }

  await prisma.venueStaff.deleteMany({ where: { userId: user.id } });
  await prisma.venueStaff.create({
    data: {
      userId: user.id,
      venueId: partner.id,
      staffRole: VenueStaffRole.OWNER,
      isActive: true,
    },
  });

  const staff = await prisma.venueStaff.findMany({
    where: { userId: user.id },
    include: { venue: true },
  });
  console.log(
    `Repaired ${user.email} →`,
    staff.map((s) => `${s.venue.name} (${s.venue.hostedBy}) ${s.staffRole}`),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
