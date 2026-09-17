"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  analyticsEnabled,
  identifyUser,
  loadAnalytics,
  resetIdentity,
} from "@/lib/analytics/client";

/**
 * Loads PostHog (when the build has a key), ties events to the signed-in user,
 * and sends a $pageview per App Router navigation. Renders nothing.
 *
 * Identity is the `User.id` UUID plus role — never the username, which for
 * alpha testers is a real name more often than not. The signing wallet's
 * public address is a person property too, set by `lib/wallet-tracking.ts`
 * once a wallet connects; `identifyUser` has to run first for it to land.
 */
export function AnalyticsProvider() {
  const pathname = usePathname();
  const { data: session, status } = useSession();

  const userId = session?.user?.id || null;
  const role = (session?.user as { role?: string } | undefined)?.role ?? null;

  useEffect(() => {
    if (!analyticsEnabled() || status === "loading") return;
    if (userId) identifyUser(userId, { role });
    else resetIdentity();
  }, [userId, role, status]);

  useEffect(() => {
    if (!analyticsEnabled()) return;
    void loadAnalytics().then((ph) => ph?.capture("$pageview"));
  }, [pathname]);

  return null;
}
