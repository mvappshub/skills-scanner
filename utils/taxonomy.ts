import { CategoryId, ConfidenceLevel } from '../types';

const CATEGORY_LABELS: Record<CategoryId, string> = {
  skill_dev: 'Skill Development',
  skill_docs: 'Skill Documentation',
  workflow_ops: 'Workflow Operations',
  agent_config: 'Agent Configuration',
  prompt_eng: 'Prompt Engineering',
  security: 'Security',
  ml_ops: 'MLOps / Inference',
  general: 'General',
};

const CATEGORY_ALIASES: Array<{ id: CategoryId; matches: string[] }> = [
  { id: 'skill_dev', matches: ['skill development', 'skill-dev', 'writing-skills', 'skill builder'] },
  { id: 'skill_docs', matches: ['documentation', 'docs', 'skill documentation', 'technical writing'] },
  { id: 'workflow_ops', matches: ['workflow', 'pipeline', 'execution plan', 'task execution'] },
  { id: 'agent_config', matches: ['agent config', 'agent configuration', 'rules', 'settings'] },
  { id: 'prompt_eng', matches: ['prompt', 'prompt engineering', 'meta prompt'] },
  { id: 'security', matches: ['security', 'audit', 'risk', 'threat'] },
  { id: 'ml_ops', matches: ['mlops', 'inference', 'serving', 'vllm'] },
];

export function categoryLabel(categoryId: CategoryId): string {
  return CATEGORY_LABELS[categoryId];
}

export function normalizeCategory(input: string | undefined): CategoryId {
  if (!input) return 'general';
  const normalized = input.trim().toLowerCase().replace(/[_-]+/g, ' ');

  for (const alias of CATEGORY_ALIASES) {
    if (alias.matches.some((candidate) => normalized.includes(candidate))) {
      return alias.id;
    }
  }

  return 'general';
}

export function confidenceLevel(confidence: number): ConfidenceLevel {
  if (confidence >= 0.75) return 'high';
  if (confidence >= 0.5) return 'medium';
  return 'low';
}
