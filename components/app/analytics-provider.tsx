"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { analyticsEnabled, loadAnalytics } from "@/lib/analytics/client";

/**
 * Loads PostHog (when the build has a key), ties events to the signed-in user,
 * and sends a $pageview per App Router navigation. Renders nothing.
 *
 * Identity is the `User.id` UUID plus role — never the username, which for
 * alpha testers is a real name more often than not.
 */
export function AnalyticsProvider() {
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const identifiedAs = useRef<string | null>(null);

  const userId = session?.user?.id || null;
  const role = (session?.user as { role?: string } | undefined)?.role ?? null;

  useEffect(() => {
    if (!analyticsEnabled() || status === "loading") return;
    void loadAnalytics().then((ph) => {
      if (!ph) return;
      if (userId && identifiedAs.current !== userId) {
        ph.identify(userId, { role });
        identifiedAs.current = userId;
      } else if (!userId && identifiedAs.current) {
        // Signed out: the next person on this browser must not inherit the id.
        ph.reset();
        identifiedAs.current = null;
      }
    });
  }, [userId, role, status]);

  useEffect(() => {
    if (!analyticsEnabled()) return;
    void loadAnalytics().then((ph) => ph?.capture("$pageview"));
  }, [pathname]);

  return null;
}
