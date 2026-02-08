import { WorkflowArchitectInput, WorkflowPlan } from '../types';
import { fieldTagVocabularyForPrompt, tagVocabularyForPrompt } from './tagVocabulary';
import { normalizeWorkflowPlanWithVocab, WorkflowPlanNormalizationWarning } from './workflowPlanSchema';

export const WORKFLOW_ARCHITECT_MODEL_ID = 'gemini-2.5-flash';
export const WORKFLOW_ARCHITECT_PROMPT_VERSION = 'workflow-architect-v1';

export interface WorkflowArchitectGenerationResult {
  plan: WorkflowPlan;
  warnings: WorkflowPlanNormalizationWarning[];
  rawPlan: Partial<WorkflowPlan>;
}

function cleanJson(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
}

async function loadGenAISDK() {
  const module = await import('@google/genai');
  return module;
}

function resolveApiKey(): string | undefined {
  const processEnv = typeof process !== 'undefined' ? (process as any)?.env : undefined;
  const viteEnv = (import.meta as any)?.env || {};

  return (
    processEnv?.API_KEY ||
    processEnv?.GEMINI_API_KEY ||
    viteEnv?.VITE_API_KEY ||
    viteEnv?.VITE_GEMINI_API_KEY
  );
}

async function getClient() {
  const { GoogleGenAI } = await loadGenAISDK();
  const apiKey = resolveApiKey();

  if (!apiKey) {
    throw new Error('Missing API key for workflow architect (API_KEY / GEMINI_API_KEY / VITE_GEMINI_API_KEY).');
  }

  return new GoogleGenAI({ apiKey });
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

export async function generateWorkflowPlanFromDescription(
  input: WorkflowArchitectInput,
  options: { retries?: number } = {},
): Promise<WorkflowArchitectGenerationResult> {
  const retries = Math.max(0, options.retries ?? 1);
  const { Type } = await loadGenAISDK();
  const ai = await getClient();
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await ai.models.generateContent({
        model: WORKFLOW_ARCHITECT_MODEL_ID,
        contents: createPrompt(input),
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              name: { type: Type.STRING },
              steps: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    title: { type: Type.STRING },
                    stage: { type: Type.STRING },
                    inputsTags: { type: Type.ARRAY, items: { type: Type.STRING } },
                    outputsTags: { type: Type.ARRAY, items: { type: Type.STRING } },
                    capabilitiesTags: { type: Type.ARRAY, items: { type: Type.STRING } },
                  },
                  required: ['id', 'title', 'stage', 'inputsTags', 'outputsTags', 'capabilitiesTags'],
                },
              },
            },
            required: ['steps'],
          },
        },
      });

      if (!response.text) {
        throw new Error('Workflow architect returned empty response.');
      }

      const parsed = JSON.parse(cleanJson(response.text)) as Partial<WorkflowPlan>;
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
