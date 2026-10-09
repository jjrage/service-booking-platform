"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-renders the page from the server every few seconds, e.g. while a payment webhook is on its way. */
export function AutoRefresh({
  everyMs = 2000,
  maxTimes = 30,
}: {
  everyMs?: number;
  maxTimes?: number;
}) {
  const router = useRouter();
  useEffect(() => {
    let count = 0;
    const timer = setInterval(() => {
      count += 1;
      if (count > maxTimes) clearInterval(timer);
      else router.refresh();
    }, everyMs);
    return () => clearInterval(timer);
  }, [router, everyMs, maxTimes]);
  return null;
}
