import {
  PaymentProvider,
  PaymentStatus,
  type Payment,
} from "@prisma/client";
import { AppError } from "../middleware/errorHandler";
import { prisma } from "./prisma";
import {
  isRazorpayConfigured,
  isSyntheticRazorpayPaymentRef,
  refundRazorpayPayment,
} from "./razorpay";

type PaymentRefundSlice = Pick<
  Payment,
  "id" | "amount" | "status" | "provider" | "providerRef"
>;

/**
 * Atomically claim a CAPTURED payment for refund, then call the PSP.
 * Prevents parallel cancel/refund from double-hitting Razorpay.
 * On PSP failure (except already-refunded), reverts ledger to CAPTURED.
 */
export async function claimAndRefundPayment(
  payment: PaymentRefundSlice,
): Promise<"skipped" | "provider" | "ledger_only"> {
  if (payment.status === PaymentStatus.REFUNDED) return "skipped";
  if (payment.status !== PaymentStatus.CAPTURED) {
    throw new AppError("Only captured payments can be refunded", 409);
  }

  const claimed = await prisma.payment.updateMany({
    where: { id: payment.id, status: PaymentStatus.CAPTURED },
    data: {
      status: PaymentStatus.REFUNDED,
      refundedAt: new Date(),
    },
  });

  if (claimed.count === 0) {
    const current = await prisma.payment.findUnique({
      where: { id: payment.id },
      select: { status: true },
    });
    if (current?.status === PaymentStatus.REFUNDED) return "skipped";
    throw new AppError("Payment is not refundable", 409);
  }

  try {
    return await executeProviderRefund(payment);
  } catch (err) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.CAPTURED,
        refundedAt: null,
      },
    });
    throw err;
  }
}

/**
 * Push a refund to the PSP when configured. Stub / missing-ref payments are
 * ledger-only. Prefer {@link claimAndRefundPayment} for cancel flows.
 */
export async function issueProviderRefund(
  payment: PaymentRefundSlice,
): Promise<"skipped" | "provider" | "ledger_only"> {
  if (payment.status === PaymentStatus.REFUNDED) return "skipped";
  if (payment.status !== PaymentStatus.CAPTURED) {
    throw new AppError("Only captured payments can be refunded", 409);
  }
  return executeProviderRefund(payment);
}

async function executeProviderRefund(
  payment: PaymentRefundSlice,
): Promise<"provider" | "ledger_only"> {
  if (
    payment.provider === PaymentProvider.RAZORPAY &&
    payment.providerRef?.startsWith("pay_")
  ) {
    // Fake HMAC E2E ids are not real captures — never call the PSP.
    if (isSyntheticRazorpayPaymentRef(payment.providerRef)) {
      return "ledger_only";
    }
    if (!isRazorpayConfigured()) {
      throw new AppError(
        "Razorpay is not configured — cannot refund live payment",
        503,
      );
    }
    try {
      await refundRazorpayPayment({
        paymentId: payment.providerRef,
        amountInr: payment.amount,
      });
      return "provider";
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : typeof err === "object" && err != null
            ? JSON.stringify(err)
            : String(err);
      // Already fully refunded at Razorpay — treat as success for idempotency.
      if (/already.*refund|fully refunded/i.test(message)) {
        return "provider";
      }
      throw new AppError(`Razorpay refund failed: ${message}`, 502);
    }
  }

  return "ledger_only";
}
