/**
 * Insight prompt templates (Block 12 — AI insights layer). Pure, versioned.
 *
 * The LLM is the INTERPRETER, never the forecaster: every number it may state is
 * handed to it as a validated structured fact, and the system prompt forbids
 * inventing or recomputing any figure. Prompts interpolate ONLY typed
 * numbers/enums/known names — never free user text — so there is no prompt-
 * injection surface (FEATURES Codex checklist).
 *
 * `PROMPT_VERSION` is the cache + idempotency key dimension: bump it whenever a
 * template changes so stale cached insights are regenerated instead of served.
 */

export const PROMPT_VERSION = 'v1';

export type InsightKind = 'reorder' | 'forecast' | 'weekly_change';

export interface ReorderFacts {
  sku: string;
  supplierName: string;
  orderedQty: number;
  /** Units on hand at the time the order was cut. */
  position: number | null;
  reorderPoint: number | null;
  daysOfSupply: number | null;
  stockoutRiskPct: number | null;
}

export interface ForecastFacts {
  sku: string;
  /** Mean forecast over the horizon (units/period). */
  meanForecast: number | null;
  horizonDays: number | null;
  /** Lower/upper 80% band, if available. */
  low: number | null;
  high: number | null;
  /** Skill vs the seasonal-naive baseline: < 1 beats it. */
  rmsse: number | null;
}

export interface WeeklyChangeFacts {
  /** New alerts raised in the trailing week. */
  alertsRaised: number;
  /** New reorder recommendations flagged in the trailing week. */
  reordersFlagged: number;
  /** Purchase-order receipts logged in the trailing week. */
  receiptsLogged: number;
  /** Sync conflicts currently awaiting review. */
  conflictsPending: number;
}

export interface PromptParts {
  system: string;
  prompt: string;
}

const SYSTEM = [
  'You are an inventory operations colleague leaving a short note for the planner.',
  'Write at most TWO short sentences, plain English, an operator-to-operator tone.',
  'Use ONLY the numbers given to you. Never invent, estimate, or recompute a figure;',
  'if a number is missing, speak qualitatively instead of guessing.',
  'No emoji, no bullet points, no greeting, no sign-off, no chatbot warmth.',
  'You explain WHY the numbers are what they are. You do not give the numbers themselves a new value.',
].join(' ');

const n = (v: number | null, unit = ''): string => (v == null ? 'unknown' : `${v}${unit}`);

/**
 * Neutralize a tenant-controlled label (SKU, supplier name) before it enters the
 * prompt: collapse all whitespace (newlines are the injection lever), strip
 * control + markup-ish characters, and cap the length. These fields come from
 * QBO / user input, so they are NOT trusted instruction text.
 */
function safeLabel(s: string): string {
  return (
    s
      // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control chars IS the intent
      .replace(/[\x00-\x1f\x7f]/g, ' ') // control chars (incl. newlines/tabs) — the injection lever
      .replace(/[<>{}`]/g, '') // markup-ish framing
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80)
  );
}

export function buildReorderPrompt(f: ReorderFacts): PromptParts {
  const sku = safeLabel(f.sku);
  const supplierName = safeLabel(f.supplierName);
  const prompt = [
    `Explain in two sentences why ordering ${f.orderedQty} units of ${sku} from ${supplierName} makes sense right now.`,
    `Facts: on hand ${n(f.position)} units; reorder point ${n(f.reorderPoint)} units;`,
    `days of supply ${n(f.daysOfSupply)}; stockout risk ${n(f.stockoutRiskPct, '%')}.`,
    'Frame it as the operator memo: what the position is, why it triggers a reorder, what the order restores.',
  ].join(' ');
  return { system: SYSTEM, prompt };
}

/**
 * The "What changed this week" digest. Every fact is a typed count (no free text),
 * so there is no injection surface at all — the model only orders and narrates
 * numbers it was given. A quiet week is stated plainly, not padded.
 */
export function buildWeeklyChangePrompt(f: WeeklyChangeFacts): PromptParts {
  const prompt = [
    'Summarize in two sentences what changed in this inventory operation over the past week.',
    `Facts: ${f.alertsRaised} new alerts raised; ${f.reordersFlagged} new reorder flags;`,
    `${f.receiptsLogged} purchase-order receipts logged; ${f.conflictsPending} sync conflicts awaiting review.`,
    'Lead with what needs the operator’s attention; if the week was quiet, say so plainly rather than inflating it.',
  ].join(' ');
  return { system: SYSTEM, prompt };
}

export function buildForecastPrompt(f: ForecastFacts): PromptParts {
  const sku = safeLabel(f.sku);
  const prompt = [
    `Explain in two sentences what the demand forecast for ${sku} says and how much to trust it.`,
    `Facts: mean forecast ${n(f.meanForecast)} units over ${n(f.horizonDays)} days;`,
    `80% band ${n(f.low)} to ${n(f.high)} units; RMSSE ${n(f.rmsse)} (below 1.0 beats the seasonal-naive baseline).`,
    'Say what the demand looks like and whether the band is tight or wide; do not restate every number.',
  ].join(' ');
  return { system: SYSTEM, prompt };
}
