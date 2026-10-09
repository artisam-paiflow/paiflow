"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { resumeWalletConnections, setWalletTrackingSubject } from "@/lib/wallet-tracking";
import {
  analyticsEnabled,
  loadAnalytics,
  setAnalyticsContext,
  setAnalyticsSubject,
  synchronizeAnalytics,
  trackException,
} from "@/lib/analytics/client";

/**
 * Loads PostHog (when the build has a key), ties events to the signed-in user,
 * and sends a $pageview per App Router navigation. Renders nothing.
 *
 * Identity is the `User.id` UUID plus role — never the username, which for
 * alpha testers is a real name more often than not. The signing wallet's
 * public address is a person property too, set by `lib/wallet-tracking.ts`
 * once a wallet connects; identity synchronization has to run first for it to land.
 */
export function AnalyticsProvider() {
  const pathname = usePathname();
  const { data: session, status } = useSession();

  const userId = session?.user?.id || null;
  const role = (session?.user as { role?: string } | undefined)?.role ?? null;

  useEffect(() => {
    if (status === "loading") {
      setAnalyticsSubject(undefined);
      setWalletTrackingSubject(undefined);
      return;
    }
    let cancelled = false;
    setAnalyticsContext(null);
    setAnalyticsSubject(userId);
    setWalletTrackingSubject(userId);
    void resumeWalletConnections();
    void fetch("/api/audit/analytics-context")
      .then(async (response) => {
        if (!response.ok) return;
        const body = await response.json();
        if (cancelled || body.data?.subject_id !== userId) return;
        await synchronizeAnalytics(userId, { role }, body.data, () => !cancelled);
        if (analyticsEnabled())
          void loadAnalytics().then((ph) => {
            if (!cancelled) ph?.capture("$pageview");
          });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId, role, status, pathname]);

  useEffect(() => {
    if (!analyticsEnabled()) return;
    const onError = (e: ErrorEvent) => trackException(e.error, "runtime");
    const onRejection = (e: PromiseRejectionEvent) =>
      trackException(e.reason, "unhandled_rejection");
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
