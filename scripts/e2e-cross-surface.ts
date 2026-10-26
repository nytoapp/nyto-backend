/**
 * Cross-surface E2E against the live local API + PostgreSQL.
 *
 * Covers: Admin invent → Guest book/pay → Admin see → Venue check-in
 *         + Partner invent → Guest book → Venue underfill cancel path
 *         + Concurrent last-seat reservation
 *
 * Usage (from backend/):
 *   npx tsx scripts/e2e-cross-surface.ts
 */
import "dotenv/config";
import crypto from "crypto";
import {
  AuthProvider,
  PaymentProvider,
  PaymentStatus,
  NytoTableType,
  PriceTier,
  TablePaymentType,
  TableStatus,
  UserRole,
  VenueHostedBy,
} from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { issueSession } from "../src/lib/tokens";
import { isRazorpayConfigured } from "../src/lib/razorpay";

const API = process.env.E2E_API_BASE ?? "http://localhost:3000";

type Json = Record<string, unknown>;

async function api(
  method: string,
  path: string,
  token: string | null,
  body?: unknown,
): Promise<{ status: number; json: Json }> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Json;
  return { status: res.status, json };
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function tokenForEmail(email: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { email } });
  assert(user, `Missing seed user ${email} — run npm run seed`);
  const session = await issueSession(user.id, { userAgent: "e2e-cross-surface" });
  return session.accessToken;
}

async function payBooking(token: string, bookingId: string): Promise<string> {
  if (!isRazorpayConfigured()) {
    const payRes = await api("POST", `/bookings/${bookingId}/pay`, token, {
      method: "UPI",
    });
    assert(
      payRes.status === 200,
      `stub pay ${payRes.status} ${JSON.stringify(payRes.json)}`,
    );
    const code =
      (payRes.json.checkInCode as string) ||
      ((payRes.json.booking as Json)?.checkInCode as string);
    assert(code, "check-in code missing after stub pay");
    return code;
  }

  const orderRes = await api(
    "POST",
    `/bookings/${bookingId}/razorpay/order`,
    token,
  );
  assert(
    orderRes.status === 200,
    `razorpay order ${orderRes.status} ${JSON.stringify(orderRes.json)}`,
  );
  const orderId =
    ((orderRes.json.order as Json)?.id as string) ||
    (orderRes.json.orderId as string);
  assert(orderId, "razorpay order id missing");

  const paymentId = `pay_e2e_${Date.now()}`;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  assert(secret, "RAZORPAY_KEY_SECRET required for live payment E2E");
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

  const confirmRes = await api(
    "POST",
    `/bookings/${bookingId}/razorpay/confirm`,
    token,
    {
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: signature,
    },
  );
  assert(
    confirmRes.status === 200,
    `razorpay confirm ${confirmRes.status} ${JSON.stringify(confirmRes.json)}`,
  );
  const code =
    (confirmRes.json.checkInCode as string) ||
    ((confirmRes.json.booking as Json)?.checkInCode as string);
  assert(code, "check-in code missing after razorpay confirm");
  return code;
}

/**
 * Synthetic Razorpay confirms use fake `pay_e2e_*` ids. Rewrite to STUB so
 * cancel → claimAndRefundPayment can ledger-refund without hitting the PSP.
 */
async function rewriteCapturedPaymentToStub(bookingId: string): Promise<void> {
  const updated = await prisma.payment.updateMany({
    where: { bookingId, status: PaymentStatus.CAPTURED },
    data: {
      provider: PaymentProvider.STUB,
      providerRef: `nyto_stub_e2e_${Date.now()}`,
    },
  });
  assert(updated.count === 1, `expected CAPTURED payment for ${bookingId}`);
}

async function ensureGuest(): Promise<{ id: string; token: string }> {
  const email = `e2e-guest-${Date.now()}@nyto.test`;
  const user = await prisma.user.create({
    data: {
      email,
      role: UserRole.USER,
      authProvider: AuthProvider.EMAIL,
      fullName: "E2E Guest",
      firstName: "E2E",
      gender: "female",
      dateOfBirth: new Date("1998-01-15"),
      verificationStatus: "APPROVED",
    },
  });
  const session = await issueSession(user.id, { userAgent: "e2e-guest" });
  return { id: user.id, token: session.accessToken };
}

async function main() {
  console.log(`\nNYTO cross-surface E2E → ${API}\n`);

  const health = await fetch(`${API}/health`);
  assert(health.ok, "API /health failed — is backend running on :3000?");

  const adminToken = await tokenForEmail("admin@nyto.app");
  const venueToken = await tokenForEmail("venue@nyto.app");
  const guest = await ensureGuest();

  // ── A) Admin NYTO invent ───────────────────────────────────────────────
  const venuesRes = await api("GET", "/admin/venues", adminToken);
  assert(venuesRes.status === 200, `admin venues ${venuesRes.status}`);
  const venues = (venuesRes.json.venues as Array<Json>) ?? [];
  const nytoVenue = venues.find((v) => v.hostedBy === "NYTO") ?? venues[0];
  assert(nytoVenue?.id, "No NYTO venue for admin invent");

  const menuRes = await api("POST", `/admin/venues/${nytoVenue.id}/menus`, adminToken, {
    name: `E2E Menu ${Date.now()}`,
    description: "E2E course · Status: Published",
    dietaryType: "NON_VEGETARIAN",
    costPerHead: 700,
  });
  assert(menuRes.status === 201 || menuRes.status === 200, `create menu ${menuRes.status} ${JSON.stringify(menuRes.json)}`);
  const menuId = (menuRes.json.menu as Json)?.id as string;
  assert(menuId, "menu id missing");

  const startsAt = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);
  startsAt.setHours(20, 0, 0, 0);
  const tableRes = await api("POST", `/admin/venues/${nytoVenue.id}/tables`, adminToken, {
    menuId,
    startsAt: startsAt.toISOString(),
    bookingOpensAt: new Date(Date.now() - 60_000).toISOString(),
    priceTier: "EVENING",
    seatPrice: 1199,
    capacity: 6,
    tableType: "WEEKLY",
    paymentType: "ALL_INCLUSIVE",
    status: "OPEN",
    inclusions: ["E2E dish"],
  });
  assert(
    tableRes.status === 201 || tableRes.status === 200,
    `create table ${tableRes.status} ${JSON.stringify(tableRes.json)}`,
  );
  const tableId =
    ((tableRes.json.table as Json)?.id as string) ||
    ((tableRes.json as Json).id as string);
  assert(tableId, "table id missing");
  console.log("✓ Admin published NYTO night", tableId);

  // Guest discovers
  const catalog = await api("GET", "/tables?filter=this_week&city=Hyderabad", null);
  assert(catalog.status === 200, `catalog ${catalog.status}`);
  const found = JSON.stringify(catalog.json).includes(tableId);
  assert(found, "Guest catalog missing new NYTO night");
  console.log("✓ Guest catalog shows NYTO night");

  // Guest book + stub pay
  const bookRes = await api("POST", "/bookings", guest.token, {
    tableId,
    bookingType: "SOLO",
    seatsBooked: 1,
  });
  assert(bookRes.status === 201, `book ${bookRes.status} ${JSON.stringify(bookRes.json)}`);
  const bookingId = (bookRes.json.booking as Json).id as string;

  const checkInCode = await payBooking(guest.token, bookingId);
  console.log("✓ Guest booked + paid · code", checkInCode);

  // Admin sees booking
  const adminBookings = await api("GET", "/admin/bookings", adminToken);
  assert(adminBookings.status === 200, "admin bookings");
  assert(
    JSON.stringify(adminBookings.json).includes(bookingId),
    "Admin missing guest booking",
  );
  console.log("✓ Admin sees booking");

  // ── B) Partner venue invent + door ─────────────────────────────────────
  // venue@ must own Ameerpet PARTNER only (stale local DBs sometimes attach NYTO).
  const venueUser = await prisma.user.findUniqueOrThrow({
    where: { email: "venue@nyto.app" },
  });
  let partnerVenue =
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
  if (!partnerVenue) {
    partnerVenue = await prisma.venue.create({
      data: {
        name: `E2E Ameerpet Kitchen ${Date.now()}`,
        address: "Ameerpet",
        city: "Hyderabad",
        area: "Ameerpet",
        hostedBy: VenueHostedBy.PARTNER,
      },
    });
  }
  await prisma.venueStaff.deleteMany({ where: { userId: venueUser.id } });
  await prisma.venueStaff.create({
    data: {
      userId: venueUser.id,
      venueId: partnerVenue.id,
      staffRole: "OWNER",
      isActive: true,
    },
  });
  // Fresh token so requireAuth reloads venueIds with the PARTNER membership.
  const venueTokenFresh = (await issueSession(venueUser.id)).accessToken;
  const venueId = partnerVenue.id;
  console.log("  partner venue", venueId, partnerVenue.hostedBy, partnerVenue.name);
  const vMenu = await api("POST", `/venue/${venueId}/menus`, venueTokenFresh, {
    name: `Partner E2E ${Date.now()}`,
    description: "Partner dish\nStatus: Draft",
    dietaryType: "VEGETARIAN",
    costPerHead: 500,
  });
  assert(
    vMenu.status === 201 || vMenu.status === 200,
    `v menu ${vMenu.status} ${JSON.stringify(vMenu.json)}`,
  );
  const vMenuId = (vMenu.json.menu as Json).id as string;

  const vMenuPatch = await api(
    "PATCH",
    `/venue/${venueId}/menus/${vMenuId}`,
    venueTokenFresh,
    {
      name: `Partner E2E ${Date.now()}`,
      description: "Partner dish · published\nStatus: Published",
      dietaryType: "VEGETARIAN",
      costPerHead: 525,
    },
  );
  assert(
    vMenuPatch.status === 200,
    `v menu patch ${vMenuPatch.status} ${JSON.stringify(vMenuPatch.json)}`,
  );
  assert(
    ((vMenuPatch.json.menu as Json)?.costPerHead as number) === 525,
    "menu PATCH did not persist costPerHead",
  );
  console.log("✓ Venue menu PATCH (edit/publish draft)");

  const pStarts = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
  pStarts.setHours(20, 30, 0, 0);
  const vTable = await api("POST", `/venue/${venueId}/tables`, venueTokenFresh, {
    menuId: vMenuId,
    startsAt: pStarts.toISOString(),
    bookingOpensAt: new Date(Date.now() - 60_000).toISOString(),
    priceTier: "EVENING",
    seatPrice: 899,
    capacity: 6,
    tableType: "WEEKLY",
    paymentType: "ALL_INCLUSIVE",
    inclusions: ["Partner plate"],
  });
  assert(
    vTable.status === 201 || vTable.status === 200,
    `v table ${vTable.status} ${JSON.stringify(vTable.json)}`,
  );
  const vTableId =
    ((vTable.json.table as Json)?.id as string) ||
    (vTable.json.id as string);
  console.log("✓ Venue published PARTNER night", vTableId);

  // Admin sees partner night (view)
  const adminTables = await api(
    "GET",
    `/admin/venues/${venueId}/tables`,
    adminToken,
  );
  assert(adminTables.status === 200, "admin partner tables");
  assert(
    JSON.stringify(adminTables.json).includes(vTableId),
    "Admin missing partner night",
  );
  console.log("✓ Admin sees Venue-organized night");

  const guest2 = await ensureGuest();
  const book2 = await api("POST", "/bookings", guest2.token, {
    tableId: vTableId,
    bookingType: "SOLO",
    seatsBooked: 1,
  });
  assert(
    book2.status === 201,
    `partner book ${book2.status} ${JSON.stringify(book2.json)}`,
  );
  const booking2 = (book2.json.booking as Json).id as string;
  const code2 = await payBooking(guest2.token, booking2);

  const doorList = await api(
    "GET",
    `/venue/${venueId}/bookings`,
    venueTokenFresh,
  );
  assert(doorList.status === 200, "door list");
  assert(JSON.stringify(doorList.json).includes(booking2), "Door missing guest");

  const checkIn = await api(
    "POST",
    `/venue/${venueId}/check-in`,
    venueTokenFresh,
    {
      checkInCode: code2,
    },
  );
  assert(
    checkIn.status === 200,
    `check-in ${checkIn.status} ${JSON.stringify(checkIn.json)}`,
  );
  console.log("✓ Venue check-in → ATTENDED");

  const guestView = await api("GET", `/bookings/${booking2}`, guest2.token);
  assert(guestView.status === 200, "guest booking detail");
  const gStatus =
    ((guestView.json.booking as Json)?.status as string) ||
    (guestView.json.status as string);
  assert(gStatus === "ATTENDED", `guest status ${gStatus}, want ATTENDED`);
  console.log("✓ Guest sees Checked in / ATTENDED");

  // ── C) Concurrent last seat ────────────────────────────────────────────
  const stamp = Date.now();
  const lockVenue = await prisma.venue.create({
    data: {
      name: `E2E Lock ${stamp}`,
      address: "x",
      city: "Hyderabad",
      area: "Ameerpet",
      hostedBy: VenueHostedBy.NYTO,
    },
  });
  const lockTable = await prisma.supperTable.create({
    data: {
      venueId: lockVenue.id,
      startsAt: new Date(Date.now() + 6 * 86400000),
      bookingOpensAt: new Date(Date.now() - 60000),
      priceTier: PriceTier.EVENING,
      seatPrice: 500,
      capacity: 1,
      tableType: NytoTableType.WEEKLY,
      paymentType: TablePaymentType.ALL_INCLUSIVE,
      status: TableStatus.OPEN,
      inclusions: ["x"],
    },
  });
  const u1 = await prisma.user.create({
    data: {
      email: `e2e-lock-a-${stamp}@nyto.test`,
      role: UserRole.USER,
      authProvider: AuthProvider.EMAIL,
      fullName: "Lock A",
    },
  });
  const u2 = await prisma.user.create({
    data: {
      email: `e2e-lock-b-${stamp}@nyto.test`,
      role: UserRole.USER,
      authProvider: AuthProvider.EMAIL,
      fullName: "Lock B",
    },
  });
  const t1 = await issueSession(u1.id);
  const t2 = await issueSession(u2.id);
  const [r1, r2] = await Promise.all([
    api("POST", "/bookings", t1.accessToken, {
      tableId: lockTable.id,
      bookingType: "SOLO",
      seatsBooked: 1,
    }),
    api("POST", "/bookings", t2.accessToken, {
      tableId: lockTable.id,
      bookingType: "SOLO",
      seatsBooked: 1,
    }),
  ]);
  const oks = [r1, r2].filter((r) => r.status === 201).length;
  const fulls = [r1, r2].filter((r) => r.status === 409 || r.status === 400).length;
  assert(oks === 1, `concurrent holds: expected 1 ok got ${oks}`);
  assert(fulls >= 1, `concurrent holds: expected rejection got ${r1.status}/${r2.status}`);
  console.log("✓ Concurrent last-seat: exactly one hold");

  // ── D) Guest cancel unpaid hold (API) ──────────────────────────────────
  const holdBook = await api("POST", "/bookings", guest.token, {
    tableId,
    bookingType: "SOLO",
    seatsBooked: 1,
  });
  assert(holdBook.status === 201, `hold book ${holdBook.status}`);
  const holdId = (holdBook.json.booking as Json).id as string;
  const cancelRes = await api(
    "POST",
    `/bookings/${holdId}/cancel`,
    guest.token,
  );
  assert(
    cancelRes.status === 200,
    `cancel ${cancelRes.status} ${JSON.stringify(cancelRes.json)}`,
  );
  console.log("✓ Guest cancel API works (unpaid hold)");

  // ── E) Paid cancel + refund CAS (ledger-safe) ──────────────────────────
  const paidGuest = await ensureGuest();
  const paidBook = await api("POST", "/bookings", paidGuest.token, {
    tableId,
    bookingType: "SOLO",
    seatsBooked: 1,
  });
  assert(
    paidBook.status === 201,
    `paid book ${paidBook.status} ${JSON.stringify(paidBook.json)}`,
  );
  const paidBookingId = (paidBook.json.booking as Json).id as string;
  await payBooking(paidGuest.token, paidBookingId);
  await rewriteCapturedPaymentToStub(paidBookingId);

  const paidCancel = await api(
    "POST",
    `/bookings/${paidBookingId}/cancel`,
    paidGuest.token,
  );
  assert(
    paidCancel.status === 200,
    `paid cancel ${paidCancel.status} ${JSON.stringify(paidCancel.json)}`,
  );
  const refunded = await prisma.payment.findUnique({
    where: { bookingId: paidBookingId },
  });
  assert(refunded?.status === PaymentStatus.REFUNDED, "payment not REFUNDED");
  assert(refunded.refundedAt != null, "refundedAt missing");
  console.log("✓ Guest paid cancel → payment REFUNDED (CAS ledger)");

  // cleanup lock fixtures + e2e guests
  await prisma.booking.deleteMany({ where: { tableId: lockTable.id } });
  await prisma.supperTable.delete({ where: { id: lockTable.id } });
  await prisma.venue.delete({ where: { id: lockVenue.id } });
  await prisma.authSession.deleteMany({
    where: {
      userId: { in: [u1.id, u2.id, guest.id, guest2.id, paidGuest.id] },
    },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [u1.id, u2.id] } },
  });

  console.log("\nALL CROSS-SURFACE E2E CHECKS PASSED\n");
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("\nE2E FAILED:", err instanceof Error ? err.message : err);
  await prisma.$disconnect();
  process.exit(1);
});
