"use client";

import { useTransition } from "react";

import { Button } from "@/ui/button";

import { resolveAlertAction } from "../actions";

export function ResolveButton({ alertId }: { alertId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={pending}
      onClick={() => startTransition(async () => void (await resolveAlertAction(alertId)))}
    >
      Mark resolved
    </Button>
  );
}
