/**
 * Client-only gate: shows IntroSplash on the home route (精选) for a first session visit.
 * Kept separate so the splash code can be lazy-loaded after hydration.
 */
import { lazy, Suspense, useEffect, useState } from "react";
import { useLocation } from "react-router";

const IntroSplash = lazy(() => import("./IntroSplash").then((m) => ({ default: m.IntroSplash })));

export function IntroGate() {
  const { pathname } = useLocation();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready) return null;
  if (pathname !== "/") return null;
  return (
    <Suspense fallback={null}>
      <IntroSplash />
    </Suspense>
  );
}
