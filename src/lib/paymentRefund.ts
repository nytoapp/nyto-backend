import {
  PaymentProvider,
  PaymentStatus,
  type Payment,
} from "@prisma/client";
import { AppError } from "../middleware/errorHandler";
import {
  isRazorpayConfigured,
  refundRazorpayPayment,
} from "./razorpay";

/**
 * Push a refund to the PSP when configured. Stub / missing-ref payments are
 * ledger-only. Idempotent if the payment is already REFUNDED.
 */
export async function issueProviderRefund(
  payment: Pick<
    Payment,
    "id" | "amount" | "status" | "provider" | "providerRef"
  >,
): Promise<"skipped" | "provider" | "ledger_only"> {
  if (payment.status === PaymentStatus.REFUNDED) return "skipped";
  if (payment.status !== PaymentStatus.CAPTURED) {
    throw new AppError("Only captured payments can be refunded", 409);
  }

  if (
    payment.provider === PaymentProvider.RAZORPAY &&
    payment.providerRef?.startsWith("pay_")
  ) {
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
      const message = err instanceof Error ? err.message : String(err);
      // Already fully refunded at Razorpay — treat as success for idempotency.
      if (/already.*refund|fully refunded/i.test(message)) {
        return "provider";
      }
      throw new AppError(
        `Razorpay refund failed: ${message}`,
        502,
      );
    }
  }

  return "ledger_only";
}
