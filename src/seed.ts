import {
  DietaryPreference,
  GenderPreference,
  PriceTier,
  TableStatus,
} from "@prisma/client";
import { prisma } from "./lib/prisma";

function atLocal(daysFromNow: number, hour: number, minute = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, minute, 0, 0);
  return d;
}

async function seed() {
  console.log("Seeding NYTO…");

  await prisma.chatMessage.deleteMany();
  await prisma.tableMember.deleteMany();
  await prisma.bookingGroupMember.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.supperTable.deleteMany();
  await prisma.venueMenu.deleteMany();
  await prisma.venue.deleteMany();
  await prisma.badge.deleteMany();

  const venues = await Promise.all([
    prisma.venue.create({
      data: {
        name: "Caperberry",
        address: "Lavelle Road, Central Bengaluru",
        city: "Bengaluru",
        lat: 12.9716,
        lng: 77.5946,
      },
    }),
    prisma.venue.create({
      data: {
        name: "The Table Club",
        address: "Bandra West, Mumbai",
        city: "Mumbai",
        lat: 19.0596,
        lng: 72.8295,
      },
    }),
    prisma.venue.create({
      data: {
        name: "Coast & Fire",
        address: "Colaba, Mumbai",
        city: "Mumbai",
      },
    }),
    prisma.venue.create({
      data: {
        name: "Lower Parel House",
        address: "Lower Parel, Mumbai",
        city: "Mumbai",
      },
    }),
    prisma.venue.create({
      data: {
        name: "Versova Kitchen",
        address: "Versova, Mumbai",
        city: "Mumbai",
      },
    }),
    prisma.venue.create({
      data: {
        name: "Juhu Supper",
        address: "Juhu, Mumbai",
        city: "Mumbai",
      },
    }),
    prisma.venue.create({
      data: {
        name: "Powai Garden",
        address: "Powai, Mumbai",
        city: "Mumbai",
      },
    }),
  ]);

  const menu = await prisma.venueMenu.create({
    data: {
      venueId: venues[0].id,
      name: "Caperberry tasting",
      description:
        "I FIRST — Burrata, heirloom tomato, aged balsamic.\nII SECOND — Sea bass, saffron beurre blanc, crisp fennel.\nIII THIRD — Valrhona fondant, salted caramel, praline.",
      dietaryType: DietaryPreference.NON_VEGETARIAN,
      costPerHead: 1299,
    },
  });

  const icebreakers = [
    "What’s the last meal that genuinely surprised you?",
    "If you could eat anywhere in the world tomorrow — where?",
    "One food opinion you’d defend to the bitter end.",
  ];

  const tableSpecs: Array<{
    venueId: string;
    days: number;
    hour: number;
    minute?: number;
    tier: PriceTier;
    price: number;
    womenOnly?: boolean;
    menuId?: string;
  }> = [
    { venueId: venues[1].id, days: 1, hour: 20, tier: PriceTier.EVENING, price: 899 },
    { venueId: venues[2].id, days: 2, hour: 13, tier: PriceTier.DAYTIME, price: 649 },
    {
      venueId: venues[3].id,
      days: 3,
      hour: 20,
      tier: PriceTier.EVENING,
      price: 1299,
    },
    { venueId: venues[4].id, days: 5, hour: 20, tier: PriceTier.EVENING, price: 899 },
    {
      venueId: venues[5].id,
      days: 6,
      hour: 19,
      tier: PriceTier.EVENING,
      price: 999,
      womenOnly: true,
    },
    {
      venueId: venues[6].id,
      days: 7,
      hour: 12,
      minute: 30,
      tier: PriceTier.DAYTIME,
      price: 749,
    },
    {
      venueId: venues[0].id,
      days: 2,
      hour: 20,
      minute: 30,
      tier: PriceTier.EVENING,
      price: 1299,
      menuId: menu.id,
    },
  ];

  for (const spec of tableSpecs) {
    await prisma.supperTable.create({
      data: {
        venueId: spec.venueId,
        menuId: spec.menuId,
        startsAt: atLocal(spec.days, spec.hour, spec.minute ?? 0),
        priceTier: spec.tier,
        seatPrice: spec.price,
        status: TableStatus.OPEN,
        genderPreference: spec.womenOnly
          ? GenderPreference.WOMEN_ONLY
          : GenderPreference.BALANCED,
        icebreakers,
      },
    });
  }

  await prisma.badge.createMany({
    data: [
      {
        code: "FIRST_TABLE",
        name: "First Table",
        description: "Attended your first NYTO supper.",
      },
      {
        code: "NEIGHBOURHOOD_REGULAR",
        name: "Neighbourhood Regular",
        description: "Three tables in the same neighbourhood.",
      },
      {
        code: "WOMEN_ONLY_TABLE",
        name: "Women-Only Table",
        description: "Joined a women-only table.",
      },
      {
        code: "CHEFS_PICK",
        name: "Chef's Pick",
        description: "Invited as a chef's pick guest.",
      },
    ],
  });

  console.log("Seed complete.");
}

seed()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
