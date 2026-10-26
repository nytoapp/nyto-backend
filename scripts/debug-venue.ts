import "dotenv/config";
import { prisma } from "../src/lib/prisma";

async function main() {
  const u = await prisma.user.findUnique({
    where: { email: "venue@nyto.app" },
    include: { venueStaff: { include: { venue: true } } },
  });
  console.log(
    JSON.stringify(
      u?.venueStaff?.map((s) => ({
        role: s.staffRole,
        venue: s.venue.name,
        hostedBy: s.venue.hostedBy,
        id: s.venueId,
      })),
      null,
      2,
    ),
  );
  await prisma.$disconnect();
}

main();
