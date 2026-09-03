import {
  AuthProvider,
  DietaryPreference,
  NytoTableType,
  PriceTier,
  TablePaymentType,
  TableStatus,
  UserRole,
  VenueStaffRole,
} from "@prisma/client";
import { prisma } from "./lib/prisma";
import { defaultBookingOpensAt } from "./lib/bookingWindow";
import { genderPreferenceForTableType } from "./lib/tableType";

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
  await prisma.payment.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.supperTable.deleteMany();
  await prisma.venueMenu.deleteMany();
  await prisma.venueStaff.deleteMany();
  await prisma.venue.deleteMany();
  await prisma.badge.deleteMany();

  const venues = await Promise.all([
    prisma.venue.create({
      data: {
        name: "SkyGarden Madhapur",
        address: "Road No. 36, Madhapur, Hyderabad",
        city: "Hyderabad",
        area: "Madhapur",
        lat: 17.4483,
        lng: 78.3915,
      },
    }),
    prisma.venue.create({
      data: {
        name: "Hitech Terrace",
        address: "Cyber Towers, Hitech City, Hyderabad",
        city: "Hyderabad",
        area: "Hitech City",
        lat: 17.4435,
        lng: 78.3772,
      },
    }),
    prisma.venue.create({
      data: {
        name: "Gachibowli House",
        address: "Financial District, Gachibowli, Hyderabad",
        city: "Hyderabad",
        area: "Gachibowli",
        lat: 17.4401,
        lng: 78.3489,
      },
    }),
    prisma.venue.create({
      data: {
        name: "Jubilee Supper Club",
        address: "Road No. 92, Jubilee Hills, Hyderabad",
        city: "Hyderabad",
        area: "Jubilee Hills",
        lat: 17.4308,
        lng: 78.407,
      },
    }),
    prisma.venue.create({
      data: {
        name: "Banjara Long Table",
        address: "Road No. 12, Banjara Hills, Hyderabad",
        city: "Hyderabad",
        area: "Banjara Hills",
        lat: 17.414,
        lng: 78.437,
      },
    }),
    prisma.venue.create({
      data: {
        name: "Ameerpet Kitchen",
        address: "Ameerpet Cross Roads, Hyderabad",
        city: "Hyderabad",
        area: "Ameerpet",
        lat: 17.4375,
        lng: 78.4482,
      },
    }),
    prisma.venue.create({
      data: {
        name: "Kondapur Garden",
        address: "Kothaguda, Kondapur, Hyderabad",
        city: "Hyderabad",
        area: "Kondapur",
        lat: 17.467,
        lng: 78.367,
      },
    }),
  ]);

  const menu = await prisma.venueMenu.create({
    data: {
      venueId: venues[0].id,
      name: "SkyGarden tasting",
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
    tableType: NytoTableType;
    paymentType?: TablePaymentType;
    inclusions?: string[];
    menuId?: string;
    forceOpensInHours?: number;
  }> = [
    {
      venueId: venues[0].id,
      days: 2,
      hour: 20,
      tier: PriceTier.EVENING,
      price: 1299,
      tableType: NytoTableType.WEEKLY,
      menuId: menu.id,
      inclusions: ["3-course dinner", "Welcome drink", "Host facilitation"],
    },
    {
      venueId: venues[1].id,
      days: 3,
      hour: 13,
      tier: PriceTier.DAYTIME,
      price: 799,
      tableType: NytoTableType.SINGLES,
      paymentType: TablePaymentType.PAY_OWN_BILL,
      inclusions: ["Shared lunch table", "Icebreaker cards"],
    },
    {
      venueId: venues[2].id,
      days: 4,
      hour: 20,
      tier: PriceTier.EVENING,
      price: 999,
      tableType: NytoTableType.WEEKLY,
      inclusions: ["Dinner", "Soft drinks"],
    },
    {
      venueId: venues[3].id,
      days: 5,
      hour: 20,
      tier: PriceTier.EVENING,
      price: 1199,
      tableType: NytoTableType.COUPLES,
      inclusions: ["Dinner for two", "Shared dessert"],
    },
    {
      venueId: venues[4].id,
      days: 6,
      hour: 19,
      tier: PriceTier.EVENING,
      price: 1099,
      tableType: NytoTableType.WOMEN_LED,
      inclusions: ["Dinner", "Welcome mocktail"],
    },
    {
      venueId: venues[5].id,
      days: 7,
      hour: 12,
      minute: 30,
      tier: PriceTier.DAYTIME,
      price: 699,
      tableType: NytoTableType.WEEKLY,
      paymentType: TablePaymentType.PAY_OWN_BILL,
    },
    {
      venueId: venues[6].id,
      days: 8,
      hour: 20,
      tier: PriceTier.EVENING,
      price: 899,
      tableType: NytoTableType.SINGLES,
      forceOpensInHours: 36,
      inclusions: ["Dinner", "Live ratio mix"],
    },
  ];

  for (const spec of tableSpecs) {
    const startsAt = atLocal(spec.days, spec.hour, spec.minute ?? 0);
    const bookingOpensAt =
      spec.forceOpensInHours != null
        ? new Date(Date.now() + spec.forceOpensInHours * 60 * 60 * 1000)
        : defaultBookingOpensAt(startsAt);

    await prisma.supperTable.create({
      data: {
        venueId: spec.venueId,
        menuId: spec.menuId,
        startsAt,
        bookingOpensAt,
        priceTier: spec.tier,
        seatPrice: spec.price,
        status: TableStatus.OPEN,
        tableType: spec.tableType,
        paymentType: spec.paymentType ?? TablePaymentType.ALL_INCLUSIVE,
        inclusions: spec.inclusions ?? [],
        genderPreference: genderPreferenceForTableType(spec.tableType),
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
        description: "Joined a women-led table.",
      },
      {
        code: "CHEFS_PICK",
        name: "Chef's Pick",
        description: "Invited as a chef's pick guest.",
      },
    ],
  });

  const admin = await prisma.user.upsert({
    where: { email: "admin@nyto.app" },
    create: {
      email: "admin@nyto.app",
      authProvider: AuthProvider.EMAIL,
      role: UserRole.ADMIN,
      firstName: "NYTO",
      fullName: "NYTO Admin",
    },
    update: { role: UserRole.ADMIN },
  });

  const venueOwner = await prisma.user.upsert({
    where: { email: "venue@nyto.app" },
    create: {
      email: "venue@nyto.app",
      authProvider: AuthProvider.EMAIL,
      role: UserRole.VENUE_STAFF,
      firstName: "SkyGarden",
      fullName: "SkyGarden Staff",
    },
    update: { role: UserRole.VENUE_STAFF },
  });

  await prisma.venueStaff.create({
    data: {
      userId: venueOwner.id,
      venueId: venues[0].id,
      staffRole: VenueStaffRole.OWNER,
    },
  });

  console.log("Seed complete (Hyderabad + 4 table types).");
  console.log(`  admin:  ${admin.email} (${admin.role})`);
  console.log(
    `  venue:  ${venueOwner.email} (${venueOwner.role}) → ${venues[0].name}`,
  );
}

seed()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
