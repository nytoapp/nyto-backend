/**
 * One-shot: lift Status/Categories out of venue_menus.description into columns.
 * Usage: npx tsx scripts/backfill-menu-meta.ts
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { parseLegacyMenuDescription } from "../src/lib/menuMeta";

async function main() {
  const menus = await prisma.venueMenu.findMany();
  let updated = 0;
  for (const menu of menus) {
    const parsed = parseLegacyMenuDescription(menu.description);
    const needsBody =
      parsed.body !== (menu.description ?? "") &&
      /Status:|Categories:/i.test(menu.description ?? "");
    const needsStatus =
      menu.publishStatus === "DRAFT" &&
      parsed.publishStatus === "PUBLISHED" &&
      /Status:\s*Published/i.test(menu.description ?? "");
    const needsCats =
      menu.categories.length === 0 && parsed.categories.length > 0;

    if (!needsBody && !needsStatus && !needsCats) continue;

    await prisma.venueMenu.update({
      where: { id: menu.id },
      data: {
        description: needsBody ? parsed.body || null : undefined,
        publishStatus: needsStatus || needsCats ? parsed.publishStatus : undefined,
        categories:
          needsCats || needsStatus ? parsed.categories : undefined,
      },
    });
    updated += 1;
  }
  console.log(`Backfilled ${updated} / ${menus.length} menus`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
