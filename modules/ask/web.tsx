import { defineWebModule } from "@aihot/web/modules";
import { IconMessage } from "../../apps/web/app/components/icons";

export default defineWebModule({
  name: "ask",
  sidebar: {
    section: "助手",
    items: [{ to: "/ask", label: "AI 问答", icon: IconMessage }],
  },
  tools: [
    { to: "/ask", label: "AI 问答", icon: <IconMessage size={20} /> },
  ],
  agent: () => import("./web/agent-part.tsx"),
});
