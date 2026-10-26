// What the site's modules add to the web pages (site/modules/index.ts).
import type { WebModule } from "@aihot/web/modules";
import ask from "@aihot/ask/web";
import radar from "@aihot/radar/web";

export const WEB_MODULES: readonly WebModule[] = [ask, radar];
