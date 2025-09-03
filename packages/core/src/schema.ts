export type ShortcutSource =
  | "developer_default"
  | "user_override"
  | "ai_suggested"
  | "site_native";

export interface IntentDescriptor {
  id: string;
  title: string;
  category?: string;
}

export interface KeyBinding {
  key: string; // Normalized combo, e.g., "Ctrl+K", "Meta+K", "g g"
  intent: string; // intent id
  platform?: Array<"win" | "mac" | "linux">;
  priority?: number; // higher wins within same source tier
  source?: ShortcutSource;
}

export interface ScopeConditionMap {
  [key: string]: string | number | boolean;
}

export interface ScopeConfig {
  name: string;
  routes: string[]; // glob patterns
  when?: ScopeConditionMap; // optional contextual conditions (e.g., modal open)
  bindings: KeyBinding[];
}

export interface ElementActionDescriptor {
  type: "click" | "focus" | "submit" | "custom";
  value?: string;
}

export interface ElementDescriptor {
  elementId: string;
  selector: string; // stable selector preferred (data-testid, aria attrs)
  role?: string;
  label?: string;
  actions?: ElementActionDescriptor[];
  intents?: string[]; // possible intents this element fulfills
}

export interface Artifact {
  appId: string; // domain(s) identifier, e.g., mail.google.com
  version: string; // immutable version, e.g., 2025.01.0
  intents?: IntentDescriptor[];
  scopes: ScopeConfig[];
  elements?: ElementDescriptor[];
  signature?: string; // base64 signature (optional in dev)
}

export interface UserOverrides {
  appId: string;
  overrides: KeyBinding[];
  updatedAt: string;
}

export interface ResolveContext {
  routePath: string; // current path, e.g., "/compose"
  platform: "win" | "mac" | "linux";
  when?: ScopeConditionMap;
}


