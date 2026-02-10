export type LlmProviderId = 'gemini' | 'claude-code';

function readEnv(key: string): string | undefined {
  const viteEnv = (import.meta as any)?.env;
  const processEnv = typeof process !== 'undefined' ? (process as any)?.env : undefined;
  return viteEnv?.[key] || processEnv?.[key];
}

function normalizeProvider(raw: string | undefined): LlmProviderId {
  if (raw === 'claude-code' || raw === 'claude-bridge') return 'claude-code';
  return 'gemini';
}

export const LLM_PROVIDER: LlmProviderId = normalizeProvider(readEnv('VITE_LLM_PROVIDER'));
export const CLAUDE_BRIDGE_URL = readEnv('VITE_CLAUDE_BRIDGE_URL') || 'http://localhost:3789';

const GEMINI_SEMANTICS_MODEL_ID =
  readEnv('VITE_GEMINI_SEMANTICS_MODEL_ID') ||
  readEnv('VITE_GEMINI_MODEL_ID') ||
  'gemini-2.5-flash';
const GEMINI_WORKFLOW_MODEL_ID =
  readEnv('VITE_GEMINI_WORKFLOW_MODEL_ID') ||
  readEnv('VITE_GEMINI_MODEL_ID') ||
  'gemini-2.5-flash';

const CLAUDE_SEMANTICS_MODEL_ID =
  readEnv('VITE_CLAUDE_CODE_SEMANTICS_MODEL_ID') ||
  readEnv('VITE_CLAUDE_CODE_MODEL_ID') ||
  readEnv('VITE_CLAUDE_SEMANTICS_MODEL_ID') ||
  readEnv('VITE_CLAUDE_MODEL_ID') ||
  'sonnet';
const CLAUDE_WORKFLOW_MODEL_ID =
  readEnv('VITE_CLAUDE_CODE_WORKFLOW_MODEL_ID') ||
  readEnv('VITE_CLAUDE_CODE_MODEL_ID') ||
  readEnv('VITE_CLAUDE_WORKFLOW_MODEL_ID') ||
  readEnv('VITE_CLAUDE_MODEL_ID') ||
  'sonnet';

export function getSemanticsModelId(providerId: LlmProviderId = LLM_PROVIDER): string {
  return providerId === 'claude-code' ? CLAUDE_SEMANTICS_MODEL_ID : GEMINI_SEMANTICS_MODEL_ID;
}

export function getWorkflowModelId(providerId: LlmProviderId = LLM_PROVIDER): string {
  return providerId === 'claude-code' ? CLAUDE_WORKFLOW_MODEL_ID : GEMINI_WORKFLOW_MODEL_ID;
}
