import { defineModule } from "@aihot/contracts/modules";
export default defineModule({ name: "radar", pages: [{ path: "radar", file: "web/page.tsx" }], apiPaths: [/^\/api\/radar(?:\/|$)/] });
