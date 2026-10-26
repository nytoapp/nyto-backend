import type { EmailDeliveryMode, EmailDeliveryResult } from "./email";

/** Shared API shape so clients never assume mail went out. */
export type NotificationDelivery = {
  emailDelivered: boolean;
  deliveryMode: EmailDeliveryMode | "none";
  /** Human-readable next step — always present, never claims a fake send. */
  nextStep: string;
};

export function notificationFromEmail(
  delivery: EmailDeliveryResult | null,
  nextStepWhenDelivered: string,
  nextStepWhenNot: string,
): NotificationDelivery {
  if (!delivery) {
    return {
      emailDelivered: false,
      deliveryMode: "none",
      nextStep: nextStepWhenNot,
    };
  }
  return {
    emailDelivered: delivery.delivered,
    deliveryMode: delivery.mode,
    nextStep: delivery.delivered ? nextStepWhenDelivered : nextStepWhenNot,
  };
}
