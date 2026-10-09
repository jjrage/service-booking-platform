import { expect, test, type Page } from "@playwright/test";

/**
 * The main path of the public booking page: quote → arrival window → details → deposit → confirmed, then the
 * owner sees the booking and both payment attempts. Runs against the seeded demo business. With Stripe test keys
 * the card goes into Stripe's Payment Element (locally the webhook needs `stripe listen`); without them, into
 * the built-in simulator, which follows Stripe's test cards.
 */

const stripeFrame = 'iframe[title="Secure payment input frame"]';

/** Enters a test card in whichever payment form the page shows, and submits it. */
async function payWith(page: Page, stripe: boolean, number: string) {
  if (stripe) {
    const frame = page.frameLocator(stripeFrame).first();
    await frame.locator('input[name="number"]').fill(number);
    await frame.locator('input[name="expiry"]').fill("12 / 30");
    await frame.locator('input[name="cvc"]').fill("123");
    const zip = frame.locator('input[name="postalCode"]');
    if (await zip.count()) await zip.fill("27609");
    // An earlier decline message goes away with the new number, and the form shrinks; click once it has, or the
    // button moves from under the pointer.
    await expect(frame.getByText(/declined/)).toHaveCount(0);
  } else {
    await page.getByLabel("Card number").fill(number);
  }
  await page.getByRole("button", { name: /^Pay \$/ }).click();
}

test("a guest books a cleaning, retries a declined card and pays the deposit", async ({
  page,
  browser,
}) => {
  const email = `e2e.${Date.now()}@mail.example`;

  // 1. Home details and an instant quote.
  await page.goto("/wrenfield/book");
  await page.getByLabel("ZIP code").fill("27609");
  await expect(page.getByText(/Central Raleigh/)).toBeVisible();
  await page.getByRole("button", { name: "Choose a time" }).click();

  // 2. The first free arrival window; it is held while the guest finishes.
  await expect(page.getByRole("heading", { name: "Pick an arrival window" })).toBeVisible();
  await page
    .getByRole("button", { name: /\d:\d\d/, disabled: false })
    .first()
    .click();

  // 3. Contact and address.
  await expect(page.getByRole("heading", { name: "Your details" })).toBeVisible();
  await page.getByLabel("Full name").fill("Jordan Avery");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Mobile phone").fill("919 555 0177");
  await page.getByLabel("Street address").fill("512 Maple Run Dr");
  await page.getByLabel("City").fill("Raleigh");
  await page.getByLabel("How do we get in?").fill("Code 2468 on the side door.");
  await page.getByRole("button", { name: "Continue to payment" }).click();

  // 4. The deposit: a declined test card first, then one that succeeds.
  await page.waitForURL(/\/wrenfield\/pay\//);
  await expect(page.getByRole("heading", { name: /^Pay the \$[\d.,]+ deposit$/ })).toBeVisible();
  const stripe = !(await page.getByText("Test payments · simulated").isVisible());
  await payWith(page, stripe, "4000000000000002");
  const declined = stripe
    ? page
        .frameLocator(stripeFrame)
        .first()
        .getByText(/declined/)
    : page.getByText("Your card was declined.");
  await expect(declined).toBeVisible();

  // The first attempt is over once the button is usable again; only then enter the next card.
  await expect(page.getByRole("button", { name: /^Pay \$/ })).toBeEnabled();
  await payWith(page, stripe, "4242424242424242");
  await page.waitForURL(/\/wrenfield\/bookings\/[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { name: "You're booked!" })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  const bookingId = new URL(page.url()).pathname.split("/").at(-1);

  // 5. The owner sees the confirmed booking: one deposit payment (like a Stripe PaymentIntent, the retry
  // succeeds on the same payment) and the declined attempt in the booking's history.
  const owner = await browser.newContext();
  const admin = await owner.newPage();
  await admin.goto("/login");
  await admin.getByRole("button", { name: /Owner/ }).click();
  await admin.waitForURL(/\/admin/);
  await admin.goto(`/admin/bookings/${bookingId}`);
  await expect(admin.getByText("Jordan Avery").first()).toBeVisible();
  await expect(admin.getByText("Confirmed").first()).toBeVisible();
  await expect(
    admin.locator("li", { hasText: "Deposit" }).filter({ hasText: "succeeded" }),
  ).toHaveCount(1);
  const history = admin.locator("ol li");
  await expect(history.filter({ hasText: "Booked" })).toHaveCount(1);
  // Stripe may deliver the decline's webhook after the success, and a late failure does not undo a payment.
  if (!stripe) await expect(history.filter({ hasText: "Payment failed" })).toHaveCount(1);
  await owner.close();
});
