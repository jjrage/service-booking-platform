import { z } from "zod";

import { quoteInputSchema } from "./quote";

/** Contact and address details a guest enters at checkout. Validated in the browser and again on the server. */

const trimmed = (max: number) => z.string().trim().max(max);

export const contactSchema = z.object({
  fullName: trimmed(120).min(2, "Enter your full name"),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid e-mail address")),
  phone: z
    .string()
    .trim()
    .transform((value) => value.replace(/[^\d+]/g, ""))
    .pipe(z.string().regex(/^\+?1?\d{10}$/, "Enter a 10-digit US phone number"))
    .transform(formatPhone),
});

export const addressSchema = z.object({
  line1: trimmed(160).min(3, "Enter the street address"),
  line2: trimmed(80).optional().default(""),
  city: trimmed(80).min(2, "Enter the city"),
  state: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "Two-letter state code"),
  zip: z.string().regex(/^\d{5}$/, "5-digit ZIP"),
});

export const homeNotesSchema = z.object({
  hasPets: z.boolean().default(false),
  petNotes: trimmed(500).optional().default(""),
  accessNotes: trimmed(500).optional().default(""),
  parkingNotes: trimmed(500).optional().default(""),
});

export const bookingRequestSchema = z
  .object({
    quote: quoteInputSchema,
    contact: contactSchema,
    address: addressSchema,
    notes: homeNotesSchema,
  })
  .refine((request) => request.address.zip === request.quote.zip, {
    path: ["address", "zip"],
    message: "The ZIP must match the one the price was quoted for",
  });

export type BookingRequest = z.infer<typeof bookingRequestSchema>;
export type BookingRequestInput = z.input<typeof bookingRequestSchema>;

/** Formats a stored 10-digit phone number as (919) 555-0112. */
export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return digits.length === 10
    ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
    : phone;
}
