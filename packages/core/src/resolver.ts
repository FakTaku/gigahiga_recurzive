import type { Artifact, KeyBinding, ResolveContext, ScopeConfig } from "./schema";

function routeMatches(routePattern: string, routePath: string): boolean {
  // Very small glob matcher supporting * wildcards.
  // "/*" matches any, "/u/*/compose/*" supports multi segments.
  const escaped = routePattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  const re = new RegExp(`^${escaped}$`);
  return re.test(routePath);
}

function scopeApplies(scope: ScopeConfig, ctx: ResolveContext): boolean {
  const routeOk = scope.routes.some((p) => routeMatches(p, ctx.routePath));
  if (!routeOk) return false;
  if (!scope.when) return true;
  if (!ctx.when) return false;
  for (const key of Object.keys(scope.when)) {
    if (ctx.when[key] !== scope.when[key]) return false;
  }
  return true;
}

function byPrecedence(a: KeyBinding, b: KeyBinding): number {
  const precedence = (src?: string) =>
    src === "user_override"
      ? 3
      : src === "developer_default"
      ? 2
      : src === "site_native"
      ? 1
      : 0; // ai_suggested or undefined
  const pa = precedence(a.source);
  const pb = precedence(b.source);
  if (pa !== pb) return pb - pa;
  const prioA = a.priority ?? 0;
  const prioB = b.priority ?? 0;
  return prioB - prioA;
}

export interface EffectiveBinding extends KeyBinding {
  scopeName: string;
}

export function collectEffectiveBindings(
  artifact: Artifact,
  ctx: ResolveContext
): EffectiveBinding[] {
  const applicableScopes = artifact.scopes.filter((s) => scopeApplies(s, ctx));
  const bindings: EffectiveBinding[] = [];
  for (const scope of applicableScopes) {
    for (const b of scope.bindings) {
      if (b.platform && !b.platform.includes(ctx.platform)) continue;
      bindings.push({ ...b, scopeName: scope.name });
    }
  }
  // Sort by precedence + priority, deeper scopes later will naturally override when duplicates exist at resolution time.
  bindings.sort(byPrecedence);
  return bindings;
}

export function resolveCombo(
  combo: string,
  artifact: Artifact,
  ctx: ResolveContext
): EffectiveBinding | null {
  const all = collectEffectiveBindings(artifact, ctx);
  const candidates = all.filter((b) => normalizeKey(b.key) === normalizeKey(combo));
  if (candidates.length === 0) return null;
  candidates.sort(byPrecedence);
  return candidates[0] ?? null;
}

export function normalizeKey(k: string): string {
  return k.trim().replace(/\s+/g, " ").toLowerCase();
}


