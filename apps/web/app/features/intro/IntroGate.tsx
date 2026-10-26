/** Only the home route mounts the splash; session eligibility is checked inside it. */
import { useLocation } from "react-router";
import { IntroSplash } from "./IntroSplash";

export function IntroGate() {
  const { pathname } = useLocation();
  if (pathname !== "/") return null;
  return <IntroSplash />;
}
