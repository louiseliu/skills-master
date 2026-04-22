import type { ComponentType, SVGProps } from "react";

import {
  ClaudeCode,
  Cursor,
  Windsurf,
  GithubCopilot,
  Codex,
  Gemini,
  Cline,
  Trae,
  OpenCode,
  OpenClaw,
  Antigravity,
} from "@lobehub/icons";

// Fallback SVGs for icons not available in @lobehub/icons
import factorySvg from "@/assets/agents/factory.svg";
import kiroSvg from "@/assets/agents/kiro.svg";
import warpSvg from "@/assets/agents/warp.svg";
import qoderSvg from "@/assets/agents/qoder.svg";
import codebuddySvg from "@/assets/agents/codebuddy.svg";
import qclawSvg from "@/assets/agents/qclaw.svg";
import autoclawSvg from "@/assets/agents/autoclaw.svg";
import defaultSvg from "@/assets/agents/default.svg";

// OpenClaw family (webp icons from easyclaw)
import lobsteraiIcon from "@/assets/agents/lobsterai.webp";
import dumateIcon from "@/assets/agents/dumate.webp";
import wukongIcon from "@/assets/agents/wukong.webp";
import claw360Icon from "@/assets/agents/360claw.webp";
import workbuddyIcon from "@/assets/agents/workbuddy.webp";
import stepbuddyIcon from "@/assets/agents/stepbuddy.webp";
import qoderworkIcon from "@/assets/agents/qoderwork.webp";
import copawIcon from "@/assets/agents/copaw.webp";
import nexuIcon from "@/assets/agents/nexu.webp";
import manusIcon from "@/assets/agents/manus.webp";
import niumaaiIcon from "@/assets/agents/niumaai.webp";
import mulerunIcon from "@/assets/agents/mulerun.webp";
import lobehubIcon from "@/assets/agents/lobehub.webp";
import poorclawIcon from "@/assets/agents/poorclaw.webp";
import linkfoxclawIcon from "@/assets/agents/linkfoxclaw.webp";
import loomyIcon from "@/assets/agents/loomy.webp";
import tabbitIcon from "@/assets/agents/tabbit.webp";
import jvsclawIcon from "@/assets/agents/jvsclaw.webp";

type IconComponent = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

// Use Color variant when available, otherwise Mono (default export)
const AGENT_ICONS: Record<string, IconComponent> = {
  "claude-code": ClaudeCode.Color,
  "cursor": Cursor,
  "windsurf": Windsurf,
  "copilot-cli": GithubCopilot,
  "codex": Codex.Color,
  "gemini-cli": Gemini.Color,
  "cline": Cline,
  "trae": Trae.Color,
  "opencode": OpenCode,
  "openclaw": OpenClaw.Color,
  "antigravity": Antigravity.Color,
};

// Static SVG fallback icons (img src)
// monochrome: true means the icon is single-color black and needs dark:invert
const AGENT_FALLBACK_ICONS: Record<string, { src: string; monochrome?: boolean }> = {
  "factory": { src: factorySvg, monochrome: true },
  "kiro": { src: kiroSvg },
  "warp": { src: warpSvg, monochrome: true },
  "qoder": { src: qoderSvg },
  "codebuddy": { src: codebuddySvg },
  "qclaw": { src: qclawSvg },
  "autoclaw": { src: autoclawSvg },
  "lobsterai": { src: lobsteraiIcon },
  "dumate": { src: dumateIcon },
  "wukong": { src: wukongIcon },
  "360claw": { src: claw360Icon },
  "workbuddy": { src: workbuddyIcon },
  "stepbuddy": { src: stepbuddyIcon },
  "qoderwork": { src: qoderworkIcon },
  "copaw": { src: copawIcon },
  "nexu": { src: nexuIcon },
  "manus": { src: manusIcon },
  "niumaai": { src: niumaaiIcon },
  "mulerun": { src: mulerunIcon },
  "lobehub": { src: lobehubIcon },
  "poorclaw": { src: poorclawIcon },
  "linkfoxclaw": { src: linkfoxclawIcon },
  "loomy": { src: loomyIcon },
  "tabbit": { src: tabbitIcon },
  "jvsclaw": { src: jvsclawIcon },
};

export function getAgentIcon(slug: string): { type: "component"; Component: IconComponent } | { type: "img"; src: string; monochrome?: boolean } {
  const component = AGENT_ICONS[slug];
  if (component) return { type: "component", Component: component };

  const fallback = AGENT_FALLBACK_ICONS[slug];
  if (fallback) return { type: "img", ...fallback };

  return { type: "img", src: defaultSvg };
}
