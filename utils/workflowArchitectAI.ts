import { WorkflowArchitectInput, WorkflowPlan } from '../types';
import { getLlmClient } from './llm/client';
import { getWorkflowModelId } from './llm/config';
import { fieldTagVocabularyForPrompt, tagVocabularyForPrompt } from './tagVocabulary';
import { normalizeWorkflowPlanWithVocab, WorkflowPlanNormalizationWarning } from './workflowPlanSchema';

export const WORKFLOW_ARCHITECT_MODEL_ID = getWorkflowModelId();
export const WORKFLOW_ARCHITECT_PROMPT_VERSION = 'workflow-architect-v1';

export interface WorkflowArchitectGenerationResult {
  plan: WorkflowPlan;
  warnings: WorkflowPlanNormalizationWarning[];
  rawPlan: Partial<WorkflowPlan>;
}

function createPrompt(input: WorkflowArchitectInput): string {
  return [
    'You are a Workflow Architect for AI agent skill orchestration.',
    'Produce a practical workflow plan with 3-12 steps.',
    'Return strict JSON only.',
    '',
    `User description: ${input.description || '(empty)'}`,
    `Workflow type: ${input.workflowType || '(not specified)'}`,
    `Stack: ${input.stack || '(not specified)'}`,
    `Constraints: ${input.constraints || '(none)'}`,
    '',
    'Rules:',
    '- Include meaningful ordered steps.',
    '- Use concrete tags that can match skills.',
    '- stage must be one of intake, plan, implement, verify, refactor, security, docs, release, other.',
    '- Each step requires: id, title, stage, inputsTags, outputsTags, capabilitiesTags.',
    '- Keep tags concise and canonical (lowercase, short tokens).',
    `- Use tags only from global vocab: ${tagVocabularyForPrompt()}`,
    `- inputsTags allowed vocab: ${fieldTagVocabularyForPrompt('inputsTags')}`,
    `- outputsTags allowed vocab: ${fieldTagVocabularyForPrompt('artifactsTags')}`,
    `- capabilitiesTags allowed vocab: ${fieldTagVocabularyForPrompt('capabilitiesTags')}`,
    '- Avoid duplicate step IDs.',
    '',
    'Output shape:',
    '{',
    '  "id": "workflow-id",',
    '  "name": "Workflow Name",',
    '  "steps": [',
    '    {',
    '      "id": "step-id",',
    '      "title": "Step title",',
    '      "stage": "implement",',
    '      "inputsTags": ["requirements"],',
    '      "outputsTags": ["code"],',
    '      "capabilitiesTags": ["backend"]',
    '    }',
    '  ]',
    '}',
  ].join('\n');
}

export const WORKFLOW_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          stage: { type: 'string' },
          inputsTags: { type: 'array', items: { type: 'string' } },
          outputsTags: { type: 'array', items: { type: 'string' } },
          capabilitiesTags: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'title', 'stage', 'inputsTags', 'outputsTags', 'capabilitiesTags'],
      },
    },
  },
  required: ['steps'],
};

export async function generateWorkflowPlanFromDescription(
  input: WorkflowArchitectInput,
  options: { retries?: number } = {},
): Promise<WorkflowArchitectGenerationResult> {
  const retries = Math.max(0, options.retries ?? 1);
  const llm = getLlmClient();
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const parsed = (await llm.generateWorkflowPlan(createPrompt(input), WORKFLOW_JSON_SCHEMA)) as Partial<WorkflowPlan>;
      const normalized = normalizeWorkflowPlanWithVocab(parsed);
      return {
        plan: normalized.plan,
        warnings: normalized.warnings,
        rawPlan: normalized.rawPlan,
      };
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new Error('Workflow architect failed with unknown error.');
}
