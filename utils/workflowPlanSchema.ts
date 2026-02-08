import { Stage, WorkflowPlan, WorkflowPlanStep } from '../types';
import { sanitizeMachineTags } from './tagVocabulary';

export const WORKFLOW_STAGES: Stage[] = ['intake', 'plan', 'implement', 'verify', 'refactor', 'security', 'docs', 'release', 'other'];

export interface WorkflowPlanNormalizationWarning {
  stepId: string;
  field: 'inputsTags' | 'outputsTags' | 'capabilitiesTags';
  rawTag: string;
  mappedTag?: string;
  reason: string;
}

export interface WorkflowPlanNormalizationResult {
  plan: WorkflowPlan;
  warnings: WorkflowPlanNormalizationWarning[];
  rawPlan: Partial<WorkflowPlan>;
}

function slugifyStepId(value: string, fallbackIndex: number): string {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

  return normalized || `step-${fallbackIndex + 1}`;
}

export function uniqueTags(tags: string[]): string[] {
  return Array.from(new Set(tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean)));
}

export function tagsToCsv(tags: string[]): string {
  return uniqueTags(tags).join(', ');
}

export function parseTagsInput(value: string): string[] {
  return uniqueTags(String(value || '').split(','));
}

export function createDefaultWorkflowStep(index: number): WorkflowPlanStep {
  return {
    id: `step-${index + 1}`,
    title: `Step ${index + 1}`,
    stage: 'implement',
    inputsTags: [],
    outputsTags: [],
    capabilitiesTags: [],
  };
}

function normalizeStage(value: unknown, index: number): Stage {
  const stage = String(value || '').trim() as Stage;
  if (!WORKFLOW_STAGES.includes(stage)) {
    throw new Error(`Step ${index + 1} has invalid stage "${String(value)}".`);
  }
  return stage;
}

function toTagArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return uniqueTags(value.map((entry) => String(entry)));
  }
  if (typeof value === 'string') {
    return parseTagsInput(value);
  }
  return [];
}

export function normalizeWorkflowPlan(input: Partial<WorkflowPlan>): WorkflowPlan {
  return normalizeWorkflowPlanWithVocab(input).plan;
}

export function normalizeWorkflowPlanWithVocab(input: Partial<WorkflowPlan>): WorkflowPlanNormalizationResult {
  if (!input || !Array.isArray(input.steps) || input.steps.length === 0) {
    throw new Error('workflowPlan must contain non-empty "steps" array.');
  }

  const warnings: WorkflowPlanNormalizationWarning[] = [];
  const steps = input.steps.map((rawStep, index) => {
    const stage = normalizeStage(rawStep.stage, index);
    const title = String(rawStep.title || `Step ${index + 1}`).trim() || `Step ${index + 1}`;
    const stepId = slugifyStepId(String(rawStep.id || title || `step-${index + 1}`), index);
    const rawInputs = toTagArray(rawStep.inputsTags);
    const rawOutputs = toTagArray(rawStep.outputsTags);
    const rawCapabilities = toTagArray(rawStep.capabilitiesTags);
    const sanitized = sanitizeMachineTags({
      inputsTags: rawInputs,
      artifactsTags: rawOutputs,
      capabilitiesTags: rawCapabilities,
    });

    for (const issue of sanitized.invalidTagIssues) {
      warnings.push({
        stepId,
        field: issue.field === 'artifactsTags' ? 'outputsTags' : issue.field,
        rawTag: issue.rawTag,
        mappedTag: issue.mappedTo,
        reason: issue.reason || 'normalized',
      });
    }

    return {
      id: stepId,
      title,
      stage,
      inputsTags: sanitized.machineTags.inputsTags,
      outputsTags: sanitized.machineTags.artifactsTags,
      capabilitiesTags: sanitized.machineTags.capabilitiesTags,
    } satisfies WorkflowPlanStep;
  });

  return {
    plan: {
      id: input.id ? String(input.id) : undefined,
      name: input.name ? String(input.name) : undefined,
      steps,
    },
    warnings,
    rawPlan: input,
  };
}

export function parseWorkflowPlanJson(rawText: string): WorkflowPlan {
  const parsed = JSON.parse(rawText) as Partial<WorkflowPlan>;
  return normalizeWorkflowPlanWithVocab(parsed).plan;
}

export function parseWorkflowPlanJsonWithVocab(rawText: string): WorkflowPlanNormalizationResult {
  const parsed = JSON.parse(rawText) as Partial<WorkflowPlan>;
  return normalizeWorkflowPlanWithVocab(parsed);
}

export function workflowPlanToJson(plan: WorkflowPlan): string {
  return JSON.stringify(plan, null, 2);
}
