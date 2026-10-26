import { defineWebModule } from "@aihot/web/modules";
import { IconChart } from "../../apps/web/app/components/icons";
export default defineWebModule({ name: "radar", sidebar: { section: "内容", items: [{ to: "/radar", label: "游戏异动", icon: IconChart }] }, tools: [{ to: "/radar", label: "游戏异动", icon: <IconChart size={20}/> }] });
