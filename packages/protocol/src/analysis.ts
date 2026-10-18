import { z } from 'zod';

/**
 * Deterministic repository assessment. Every value here is computed by rules from
 * files and git history, so the same repository always gets the same verdict; the
 * language model only writes recommendation prose from it (see `recommendations`).
 */
export const maturities = [
  'empty',
  'prototype',
  'developing',
  'established',
  'production',
] as const;
export type Maturity = (typeof maturities)[number];

/** How recently the repository changed; separate from maturity on purpose. */
export const activityLevels = ['active', 'recent', 'quiet', 'dormant'] as const;
export type ActivityLevel = (typeof activityLevels)[number];

export const checkAreas = [
  'documentation',
  'testing',
  'quality',
  'automation',
  'delivery',
  'maintenance',
] as const;
export type CheckArea = (typeof checkAreas)[number];

export const checkStatuses = ['pass', 'partial', 'missing'] as const;
export type CheckStatus = (typeof checkStatuses)[number];

export const checkSchema = z.object({
  id: z.string(),
  label: z.string(),
  area: z.enum(checkAreas),
  status: z.enum(checkStatuses),
  /** Contribution to the score; 0.5 for nice-to-haves. */
  weight: z.number().nonnegative(),
  /** What was found (paths, script names), or what is missing. */
  evidence: z.string(),
});
export type Check = z.infer<typeof checkSchema>;

export const repoAnalysisSchema = z.object({
  maturity: z.enum(maturities),
  activity: z.enum(activityLevels),
  /** Weighted share of passed checks, 0–100. */
  score: z.number().int().min(0).max(100),
  /** 1 (a handful of files) to 5 (very large). */
  sizeBand: z.number().int().min(1).max(5),
  trackedBytes: z.number().int().nonnegative(),
  fileCount: z.number().int().nonnegative(),
  languages: z.array(z.object({ name: z.string(), share: z.number() })),
  frameworks: z.array(z.string()),
  packageManagers: z.array(z.string()),
  scripts: z.array(z.string()),
  dependencies: z.object({
    runtime: z.number().int().nonnegative(),
    dev: z.number().int().nonnegative(),
  }),
  folders: z.array(z.object({ name: z.string(), files: z.number().int() })),
  commits: z.object({
    total: z.number().int().nonnegative(),
    last30Days: z.number().int().nonnegative(),
    last90Days: z.number().int().nonnegative(),
    authors90Days: z.number().int().nonnegative(),
    lastCommitAt: z.number().optional(),
    firstCommitAt: z.number().optional(),
  }),
  todos: z.object({
    todo: z.number().int().nonnegative(),
    fixme: z.number().int().nonnegative(),
  }),
  checks: z.array(checkSchema),
});
export type RepoAnalysis = z.infer<typeof repoAnalysisSchema>;

export const maturityNames: Record<Maturity, string> = {
  empty: 'Empty plot',
  prototype: 'Prototype',
  developing: 'Developing',
  established: 'Established',
  production: 'Production-ready',
};

/** Written by a local model from the analysis; advisory text only, never a verdict. */
export const recommendationsSchema = z.object({
  strengths: z.array(z.string().max(200)).max(6),
  recommendedImprovements: z
    .array(
      z.object({
        priority: z.enum(['high', 'medium', 'low']),
        area: z.string().max(40),
        reason: z.string().max(400),
        suggestion: z.string().max(400),
      }),
    )
    .max(5),
  /**
   * A ready-to-paste task for a coding agent that fixes the high-priority items
   * (medium when there are none); absent when nothing is high or medium.
   */
  agentPrompt: z.string().min(1).max(6000).optional(),
});
export type Recommendations = z.infer<typeof recommendationsSchema>;

export type RecommendationsResult =
  | { state: 'pending' }
  | {
      state: 'ready';
      recommendations: Recommendations;
      model: string;
      generatedAt: number;
      cached: boolean;
    }
  | { state: 'unavailable'; message: string };
