/**
 * Mirrors Flutter booking-detail cancel smoke against the live API.
 * Guest: discover → book → (optional pay) → GET detail → cancel → GET detail.
 *
 * Usage: npx tsx scripts/smoke-flutter-cancel-path.ts
 */
import "dotenv/config";
import {
  AuthProvider,
  PaymentProvider,
  PaymentStatus,
  UserRole,
} from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { issueSession } from "../src/lib/tokens";
import { isRazorpayConfigured } from "../src/lib/razorpay";
import crypto from "crypto";

const API = process.env.E2E_API_BASE ?? "http://localhost:3000";

type Json = Record<string, unknown>;

async function api(
  method: string,
  path: string,
  token: string | null,
  body?: unknown,
) {
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

async function pay(token: string, bookingId: string) {
  if (!isRazorpayConfigured()) {
    const payRes = await api("POST", `/bookings/${bookingId}/pay`, token, {
      method: "UPI",
    });
    assert(payRes.status === 200, `pay ${payRes.status}`);
    return;
  }
  const orderRes = await api(
    "POST",
    `/bookings/${bookingId}/razorpay/order`,
    token,
  );
  assert(orderRes.status === 200, `order ${orderRes.status}`);
  const orderId =
    ((orderRes.json.order as Json)?.id as string) ||
    (orderRes.json.orderId as string);
  const paymentId = `pay_e2e_${Date.now()}`;
  const signature = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  const confirm = await api(
    "POST",
    `/bookings/${bookingId}/razorpay/confirm`,
    token,
    {
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: signature,
    },
  );
  assert(confirm.status === 200, `confirm ${confirm.status}`);
  await prisma.payment.updateMany({
    where: { bookingId, status: PaymentStatus.CAPTURED },
    data: {
      provider: PaymentProvider.STUB,
      providerRef: `nyto_stub_flutter_smoke_${Date.now()}`,
    },
  });
}

async function main() {
  console.log(`\nFlutter cancel-path smoke → ${API}\n`);
  assert((await fetch(`${API}/health`)).ok, "API down");

  const catalog = await api("GET", "/tables?filter=this_week&city=Hyderabad", null);
  assert(catalog.status === 200, "catalog");
  const tables = (catalog.json.tables as Json[]) ?? [];
  const open = tables.find((t) => Number(t.seatsLeft ?? 0) > 0);
  assert(open?.id, "no open table with seats");

  const user = await prisma.user.create({
    data: {
      email: `flutter-smoke-${Date.now()}@nyto.test`,
      role: UserRole.USER,
      authProvider: AuthProvider.EMAIL,
      fullName: "Flutter Smoke",
      gender: "female",
      dateOfBirth: new Date("1998-01-15"),
      verificationStatus: "APPROVED",
    },
  });
  const token = (await issueSession(user.id)).accessToken;

  // A) Unpaid hold cancel (Flutter "Cancel hold")
  const hold = await api("POST", "/bookings", token, {
    tableId: open.id,
    bookingType: "SOLO",
    seatsBooked: 1,
  });
  assert(hold.status === 201, `hold ${hold.status} ${JSON.stringify(hold.json)}`);
  const holdId = (hold.json.booking as Json).id as string;

  const holdDetail = await api("GET", `/bookings/${holdId}`, token);
  assert(holdDetail.status === 200, "hold detail");
  assert(
    ((holdDetail.json.booking as Json).status as string) === "PENDING_PAYMENT",
    "hold should be PENDING_PAYMENT",
  );

  const holdCancel = await api("POST", `/bookings/${holdId}/cancel`, token);
  assert(holdCancel.status === 200, `hold cancel ${holdCancel.status}`);
  const holdAfter = await api("GET", `/bookings/${holdId}`, token);
  const holdBooking = holdAfter.json.booking as Json;
  assert(holdBooking.status === "CANCELLED", "hold not cancelled");
  assert(holdBooking.cancelReason === "USER", "hold cancelReason USER");
  console.log("✓ Flutter path: unpaid hold cancel → CANCELLED / USER");

  // B) Paid cancel + refund (Flutter "Cancel & request refund")
  const paid = await api("POST", "/bookings", token, {
    tableId: open.id,
    bookingType: "SOLO",
    seatsBooked: 1,
  });
  assert(paid.status === 201, `paid book ${paid.status}`);
  const paidId = (paid.json.booking as Json).id as string;
  await pay(token, paidId);

  const paidDetail = await api("GET", `/bookings/${paidId}`, token);
  assert(
    ((paidDetail.json.booking as Json).status as string) === "CONFIRMED",
    "paid should be CONFIRMED",
  );
  assert(paidDetail.json.checkInCode, "check-in code on detail");

  const paidCancel = await api("POST", `/bookings/${paidId}/cancel`, token);
  assert(
    paidCancel.status === 200,
    `paid cancel ${paidCancel.status} ${JSON.stringify(paidCancel.json)}`,
  );
  const paidAfter = await api("GET", `/bookings/${paidId}`, token);
  const paidBooking = paidAfter.json.booking as Json;
  assert(paidBooking.status === "CANCELLED", "paid not cancelled");
  assert(paidBooking.cancelReason === "USER", "paid cancelReason USER");
  const payment = await prisma.payment.findUnique({ where: { bookingId: paidId } });
  assert(payment?.status === PaymentStatus.REFUNDED, "payment not REFUNDED");
  console.log("✓ Flutter path: paid cancel → CANCELLED / USER + REFUNDED");

  await prisma.authSession.deleteMany({ where: { userId: user.id } });
  console.log("\nFLUTTER CANCEL-PATH SMOKE PASSED\n");
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("\nSMOKE FAILED:", err instanceof Error ? err.message : err);
  await prisma.$disconnect();
  process.exit(1);
});
