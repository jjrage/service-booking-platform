import { Badge } from "./feedback";

const tone = {
  pending_payment: "warning",
  confirmed: "brand",
  completed: "success",
  no_access: "danger",
  cancelled: "neutral",
  expired: "neutral",
} as const;

const label: Record<string, string> = {
  pending_payment: "Awaiting payment",
  confirmed: "Confirmed",
  completed: "Completed",
  no_access: "No access",
  cancelled: "Cancelled",
  expired: "Expired",
};

export function BookingStatus({ status }: { status: string }) {
  return (
    <Badge tone={tone[status as keyof typeof tone] ?? "neutral"}>{label[status] ?? status}</Badge>
  );
}

const purposeLabel: Record<string, string> = {
  deposit: "Deposit",
  card_setup: "Card saved",
  balance: "Visit payment",
  cancellation_fee: "Cancellation fee",
  no_access_fee: "Lockout fee",
};

export function paymentPurpose(purpose: string): string {
  return purposeLabel[purpose] ?? purpose;
}
