"use client";

import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";

import type { CheckoutSession } from "@/server/payments/types";
import { Button } from "@/ui/button";
import { Card, CardBody } from "@/ui/card";
import { Alert, Badge, Spinner } from "@/ui/feedback";
import { Field, Input } from "@/ui/form";

import { simulatedPayAction } from "../actions";

type Props = {
  slug: string;
  bookingId: string;
  token: string;
  session: CheckoutSession;
  stripePublishableKey: string | null;
  amountLabel: string;
  returnUrl: string;
  paymentDueBy: string | null;
};

export function PaymentForm(props: Props) {
  return (
    <div className="space-y-4">
      {props.paymentDueBy && <DueBy until={props.paymentDueBy} />}
      {props.session.provider === "stripe" && props.stripePublishableKey ? (
        <StripeForm {...props} publishableKey={props.stripePublishableKey} />
      ) : (
        <SimulatedForm {...props} />
      )}
    </div>
  );
}

function DueBy({ until }: { until: string }) {
  const [minutes, setMinutes] = useState(() =>
    Math.max(0, Math.ceil((Date.parse(until) - Date.now()) / 60000)),
  );
  useEffect(() => {
    const timer = setInterval(
      () =>
        setMinutes(
          Math.max(0, Math.ceil((Date.parse(until) - Date.now()) / 60000)),
        ),
      15000,
    );
    return () => clearInterval(timer);
  }, [until]);
  return (
    <p className="text-sm text-zinc-500">
      {minutes > 0
        ? `Complete payment within ${minutes} min to keep your window.`
        : "The time to pay has run out; the window may be released."}
    </p>
  );
}

// ---------------------------------------------------------------------------------------------------------
// Stripe (test mode): the Payment Element collects the card; it never reaches this app's server.

const stripePromises = new Map<string, Promise<Stripe | null>>();

function StripeForm(props: Props & { publishableKey: string }) {
  const stripePromise = useMemo(() => {
    if (!stripePromises.has(props.publishableKey)) {
      stripePromises.set(
        props.publishableKey,
        loadStripe(props.publishableKey),
      );
    }
    return stripePromises.get(props.publishableKey)!;
  }, [props.publishableKey]);

  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret: props.session.clientSecret,
        appearance: {
          theme: "stripe",
          variables: { colorPrimary: "#0f766e", borderRadius: "8px" },
        },
      }}
    >
      <StripeFields {...props} />
    </Elements>
  );
}

function StripeFields({ session, amountLabel, returnUrl }: Props) {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!stripe || !elements) return;
    setPending(true);
    setError(null);
    const absoluteReturn = new URL(
      returnUrl,
      window.location.origin,
    ).toString();
    const result =
      session.mode === "setup"
        ? await stripe.confirmSetup({
            elements,
            confirmParams: { return_url: absoluteReturn },
            redirect: "if_required",
          })
        : await stripe.confirmPayment({
            elements,
            confirmParams: { return_url: absoluteReturn },
            redirect: "if_required",
          });
    if (result.error) {
      setError(result.error.message ?? "The payment did not go through.");
      setPending(false);
      return;
    }
    // The webhook confirms the booking; the booking page waits for it.
    router.push(returnUrl);
  }

  return (
    <Card>
      <CardBody>
        <form onSubmit={submit} className="space-y-4">
          <PaymentElement />
          {error && <Alert tone="danger">{error}</Alert>}
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={!stripe || pending}
          >
            {pending && <Spinner />}
            {amountLabel}
          </Button>
          <p className="text-center text-xs text-zinc-500">
            Stripe test mode. Use 4242 4242 4242 4242, any future date and any
            CVC.
          </p>
        </form>
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------------------
// The simulator: used when Stripe keys are not configured. It accepts only Stripe's published test card
// numbers and sends the server the test card's name, never the number.

const testCards = [
  { name: "visa", number: "4242 4242 4242 4242", behavior: "Succeeds" },
  { name: "mastercard", number: "5555 5555 5555 4444", behavior: "Succeeds" },
  {
    name: "authenticate",
    number: "4000 0027 6000 3184",
    behavior: "Asks for 3-D Secure",
  },
  { name: "declined", number: "4000 0000 0000 0002", behavior: "Declined" },
  {
    name: "insufficient_funds",
    number: "4000 0000 0000 9995",
    behavior: "Insufficient funds",
  },
  {
    name: "fails_later",
    number: "4000 0000 0000 0341",
    behavior: "Saves; later charges fail",
  },
] as const;

type TestCardName = (typeof testCards)[number]["name"];

function SimulatedForm({ slug, bookingId, token, amountLabel }: Props) {
  const router = useRouter();
  const [number, setNumber] = useState("");
  const [expiry, setExpiry] = useState("12 / 30");
  const [cvc, setCvc] = useState("123");
  const [error, setError] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<TestCardName | null>(null);
  const [pending, startTransition] = useTransition();

  const digits = number.replace(/\D/g, "");
  const card = testCards.find((c) => c.number.replace(/\D/g, "") === digits);

  function pay(name: TestCardName, authenticated?: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await simulatedPayAction({
        slug,
        bookingId,
        token,
        card: name,
        authenticated,
      });
      if (result.ok) {
        router.push(result.url);
      } else if (result.status === "requires_action") {
        setChallenge(name);
      } else {
        setChallenge(null);
        setError(result.message);
      }
    });
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!card) {
      setError(
        "Test mode: use one of the test card numbers below. Real cards are never accepted.",
      );
      return;
    }
    pay(card.name);
  }

  return (
    <Card>
      <CardBody className="space-y-5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-zinc-800">Card</span>
          <Badge tone="info">Test payments · simulated</Badge>
        </div>

        <form onSubmit={submit} className="space-y-4" autoComplete="off">
          <Field label="Card number" htmlFor="card-number">
            <Input
              id="card-number"
              inputMode="numeric"
              placeholder="4242 4242 4242 4242"
              value={number}
              onChange={(e) =>
                setNumber(
                  e.target.value
                    .replace(/\D/g, "")
                    .slice(0, 16)
                    .replace(/(\d{4})(?=\d)/g, "$1 "),
                )
              }
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Expiry" htmlFor="card-expiry">
              <Input
                id="card-expiry"
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
              />
            </Field>
            <Field label="CVC" htmlFor="card-cvc">
              <Input
                id="card-cvc"
                value={cvc}
                onChange={(e) => setCvc(e.target.value)}
              />
            </Field>
          </div>
          {error && <Alert tone="danger">{error}</Alert>}
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={pending || challenge !== null}
          >
            {pending && <Spinner />}
            {amountLabel}
          </Button>
        </form>

        {challenge && (
          <div className="rounded-xl bg-zinc-900 p-5 text-white">
            <p className="text-xs uppercase tracking-wide text-zinc-400">
              Your bank · 3-D Secure (test)
            </p>
            <p className="mt-2 font-medium">Confirm this payment?</p>
            <p className="mt-1 text-sm text-zinc-300">
              A real bank would open its app or send a code here.
            </p>
            <div className="mt-4 flex gap-2">
              <Button
                variant="primary"
                size="sm"
                disabled={pending}
                onClick={() => pay(challenge, true)}
              >
                Complete authentication
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={pending}
                onClick={() => pay(challenge, false)}
              >
                Fail authentication
              </Button>
            </div>
          </div>
        )}

        <div className="rounded-lg bg-zinc-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Stripe test cards (click to fill)
          </p>
          <ul className="mt-2 space-y-1">
            {testCards.map((c) => (
              <li key={c.name}>
                <button
                  type="button"
                  className="flex w-full justify-between gap-3 rounded px-1 py-0.5 text-left text-sm hover:bg-white"
                  onClick={() => setNumber(c.number)}
                >
                  <span className="tabular font-mono text-zinc-800">
                    {c.number}
                  </span>
                  <span className="text-zinc-500">{c.behavior}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-zinc-500">
            Payments run in a built-in simulator because no Stripe keys are
            configured. It follows Stripe&apos;s test-mode behavior; with keys,
            the Stripe Payment Element replaces this form.
          </p>
        </div>
      </CardBody>
    </Card>
  );
}
