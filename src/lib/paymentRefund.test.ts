import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentProvider, PaymentStatus } from "@prisma/client";

const { prismaMock, refundRazorpayPayment } = vi.hoisted(() => {
  const prismaMock = {
    payment: {
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  };
  const refundRazorpayPayment = vi.fn();
  return { prismaMock, refundRazorpayPayment };
});

vi.mock("./prisma", () => ({ prisma: prismaMock }));
vi.mock("./razorpay", () => ({
  isRazorpayConfigured: () => true,
  isSyntheticRazorpayPaymentRef: (ref: string | null | undefined) =>
    Boolean(ref?.startsWith("pay_e2e_")),
  refundRazorpayPayment,
}));

import { AppError } from "../middleware/errorHandler";
import { claimAndRefundPayment } from "./paymentRefund";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("claimAndRefundPayment", () => {
  it("skips already-refunded payments", async () => {
    const result = await claimAndRefundPayment({
      id: "pay1",
      amount: 1000,
      status: PaymentStatus.REFUNDED,
      provider: PaymentProvider.STUB,
      providerRef: "nyto_stub_x",
    });
    expect(result).toBe("skipped");
    expect(prismaMock.payment.updateMany).not.toHaveBeenCalled();
  });

  it("claims then ledger-refunds STUB captures", async () => {
    prismaMock.payment.updateMany.mockResolvedValue({ count: 1 });
    const result = await claimAndRefundPayment({
      id: "pay1",
      amount: 1000,
      status: PaymentStatus.CAPTURED,
      provider: PaymentProvider.STUB,
      providerRef: "nyto_stub_x",
    });
    expect(result).toBe("ledger_only");
    expect(prismaMock.payment.updateMany).toHaveBeenCalledWith({
      where: { id: "pay1", status: PaymentStatus.CAPTURED },
      data: {
        status: PaymentStatus.REFUNDED,
        refundedAt: expect.any(Date),
      },
    });
    expect(refundRazorpayPayment).not.toHaveBeenCalled();
  });

  it("calls Razorpay after CAS claim for live pay_ refs", async () => {
    prismaMock.payment.updateMany.mockResolvedValue({ count: 1 });
    refundRazorpayPayment.mockResolvedValue({ id: "rfnd_1" });
    const result = await claimAndRefundPayment({
      id: "pay1",
      amount: 1299,
      status: PaymentStatus.CAPTURED,
      provider: PaymentProvider.RAZORPAY,
      providerRef: "pay_live_abc",
    });
    expect(result).toBe("provider");
    expect(refundRazorpayPayment).toHaveBeenCalledWith({
      paymentId: "pay_live_abc",
      amountInr: 1299,
    });
  });

  it("ledger-only refunds synthetic pay_e2e_ refs without calling Razorpay", async () => {
    prismaMock.payment.updateMany.mockResolvedValue({ count: 1 });
    const result = await claimAndRefundPayment({
      id: "pay1",
      amount: 1299,
      status: PaymentStatus.CAPTURED,
      provider: PaymentProvider.RAZORPAY,
      providerRef: "pay_e2e_fake",
    });
    expect(result).toBe("ledger_only");
    expect(refundRazorpayPayment).not.toHaveBeenCalled();
  });

  it("treats parallel CAS miss as skipped when already REFUNDED", async () => {
    prismaMock.payment.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.payment.findUnique.mockResolvedValue({
      status: PaymentStatus.REFUNDED,
    });
    const result = await claimAndRefundPayment({
      id: "pay1",
      amount: 1000,
      status: PaymentStatus.CAPTURED,
      provider: PaymentProvider.STUB,
      providerRef: "nyto_stub_x",
    });
    expect(result).toBe("skipped");
  });

  it("reverts ledger to CAPTURED when Razorpay refund fails", async () => {
    prismaMock.payment.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.payment.update.mockResolvedValue({});
    refundRazorpayPayment.mockRejectedValue(new Error("gateway down"));

    await expect(
      claimAndRefundPayment({
        id: "pay1",
        amount: 500,
        status: PaymentStatus.CAPTURED,
        provider: PaymentProvider.RAZORPAY,
        providerRef: "pay_live_abc",
      }),
    ).rejects.toBeInstanceOf(AppError);

    expect(prismaMock.payment.update).toHaveBeenCalledWith({
      where: { id: "pay1" },
      data: {
        status: PaymentStatus.CAPTURED,
        refundedAt: null,
      },
    });
  });
});
