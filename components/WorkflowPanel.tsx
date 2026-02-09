import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Download,
  FilePlus2,
  FolderOpen,
  GitBranch,
  ThumbsDown,
  ThumbsUp,
  Loader2,
  Lock,
  Package,
  Plus,
  Save,
  Sparkles,
  Trash2,
  Unlock,
  Upload,
  X,
} from 'lucide-react';
import {
  AnalyzeProgress,
  PendingReason,
  SkillGraph,
  SkillRecord,
  Stage,
  WorkflowArchitectInput,
  WorkflowFeedbackCandidateType,
  WorkflowFeedbackRecord,
  WorkflowPlan,
  WorkflowSkillCandidate,
  SkillWorkflowAssembly,
  WorkflowTemplateRecord,
} from '../types';
import { buildSkillGraph } from '../utils/graphBuilder';
import { assembleWorkflow } from '../utils/workflowAssembler';
import { generateWorkflowPlanFromDescription } from '../utils/workflowArchitectAI';
import {
  createDefaultWorkflowStep,
  parseTagsInput,
  parseWorkflowPlanJson,
  parseWorkflowPlanJsonWithVocab,
  normalizeWorkflowPlanWithVocab,
  tagsToCsv,
  type WorkflowPlanNormalizationWarning,
  WORKFLOW_STAGES,
  workflowPlanToJson,
} from '../utils/workflowPlanSchema';
import { computeSemanticsFingerprint, sha256Hex } from '../utils/fingerprints';
import { getLlmClient } from '../utils/llm/client';
import { getSemanticsModelId } from '../utils/llm/config';
import {
  addWorkflowFeedback,
  deleteWorkflowTemplate,
  exportWorkflowTemplatesSnapshot,
  importWorkflowTemplatesSnapshot,
  listWorkflowFeedback,
  listWorkflowTemplates,
  saveWorkflowTemplate,
} from '../utils/cacheDb';
import { SEMANTICS_LOGIC_VERSION, SEMANTICS_PROMPT_VERSION } from '../utils/semanticsAI';
import { TAG_VOCAB_VERSION } from '../utils/tagVocabulary';

interface WorkflowPanelProps {
  skills: SkillRecord[];
  graph: SkillGraph;
  analysisProgress?: AnalyzeProgress | null;
  onAnalyzeSkillIds: (
    skillIds: string[],
    phase: 'pass1' | 'pass2',
    options?: { batchSize?: number },
  ) => Promise<{ processed: number; succeeded: number; failed: number; updated: SkillRecord[] }>;
}

interface SkillSuggestion {
  name: string;
  description: string;
  stage: Stage;
  tags: string[];
}

interface SkillDraftPreview {
  slug: string;
  stepId: string;
  stepTitle: string;
  missingTag: string;
  planName?: string;
  createdAtIso: string;
  inputsTags: string[];
  artifactsTags: string[];
  capabilitiesTags: string[];
  prerequisites: string[];
  constraints: string[];
  skillMd: string;
}

type WorkflowRunStepStatus = 'todo' | 'done' | 'failed';

interface WorkflowRunStepState {
  status: WorkflowRunStepStatus;
  note: string;
}

type WorkflowRunStateByStepId = Record<string, WorkflowRunStepState>;

type DangerExportAction = 'markdown' | 'json';

const PRESETS: Array<{ id: string; label: string; plan: WorkflowPlan }> = [
  {
    id: 'nextjs-ecommerce',
    label: 'Next.js ecommerce',
    plan: {
      id: 'nextjs-ecommerce',
      name: 'Next.js ecommerce',
      steps: [
        {
          id: 'plan',
          title: 'Plan architecture and requirements',
          stage: 'plan',
          inputsTags: ['requirements', 'repo'],
          outputsTags: ['plan', 'spec', 'schema'],
          capabilitiesTags: ['architecture', 'planning'],
        },
        {
          id: 'implement-api',
          title: 'Implement APIs and data layer',
          stage: 'implement',
          inputsTags: ['spec', 'schema'],
          outputsTags: ['code', 'patch', 'config'],
          capabilitiesTags: ['api', 'database', 'backend'],
        },
        {
          id: 'implement-ui',
          title: 'Implement storefront UI',
          stage: 'implement',
          inputsTags: ['spec', 'code'],
          outputsTags: ['code', 'patch', 'docs'],
          capabilitiesTags: ['frontend', 'react', 'nextjs'],
        },
        {
          id: 'verify',
          title: 'Verify with tests and quality checks',
          stage: 'verify',
          inputsTags: ['code', 'config'],
          outputsTags: ['tests', 'report'],
          capabilitiesTags: ['tests', 'validation', 'quality'],
        },
      ],
    },
  },
  {
    id: 'skill-dev-cycle',
    label: 'Skill development cycle',
    plan: {
      id: 'skill-dev-cycle',
      name: 'Skill development cycle',
      steps: [
        {
          id: 'plan',
          title: 'Define skill spec',
          stage: 'plan',
          inputsTags: ['requirements'],
          outputsTags: ['plan', 'spec'],
          capabilitiesTags: ['planning'],
        },
        {
          id: 'implement',
          title: 'Create SKILL.md and scripts',
          stage: 'implement',
          inputsTags: ['plan', 'spec'],
          outputsTags: ['docs', 'scripts', 'config'],
          capabilitiesTags: ['skill_dev', 'tooling'],
        },
        {
          id: 'verify',
          title: 'Validate and review',
          stage: 'verify',
          inputsTags: ['docs', 'scripts'],
          outputsTags: ['tests', 'report'],
          capabilitiesTags: ['validation', 'quality'],
        },
      ],
    },
  },
];

const DEFAULT_WORKFLOW_PLAN: WorkflowPlan = parseWorkflowPlanJson(JSON.stringify(PRESETS[0].plan));

function uniqueTags(tags: string[]): string[] {
  return Array.from(new Set(tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean)));
}

function buildSuggestion(step: SkillWorkflowAssembly['steps'][number]): SkillSuggestion {
  const keyTag = step.missingCapabilities[0] || step.stage;
  const safeKey = keyTag.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'custom';
  return {
    name: `${step.stage}-${safeKey}-skill`,
    description: `Cover missing capabilities for "${step.title}" (${step.missingCapabilities.join(', ')}).`,
    stage: step.stage,
    tags: step.missingCapabilities.slice(0, 8),
  };
}

function buildSuggestionForTag(step: SkillWorkflowAssembly['steps'][number], missingTag: string): SkillSuggestion {
  const safeTag = missingTag.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'custom';
  return {
    name: `${step.stage}-${safeTag}-skill`,
    description: `Cover missing capability "${missingTag}" for "${step.title}".`,
    stage: step.stage,
    tags: uniqueTags([missingTag, ...step.missingCapabilities]).slice(0, 8),
  };
}

function confidenceClass(confidence: number): string {
  if (confidence >= 0.75) return 'text-emerald-700';
  if (confidence >= 0.5) return 'text-amber-700';
  return 'text-red-700';
}

function exportJson(filename: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadText(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function slugifySkillName(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'generated-skill';
}

function shortHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0).toString(16);
}

function ensureUniqueSlug(baseSlug: string, existingSlugs: Set<string>, dedupeSeed: string): string {
  if (!existingSlugs.has(baseSlug)) return baseSlug;

  const v2 = `${baseSlug}-v2`;
  if (!existingSlugs.has(v2)) return v2;

  const hash = shortHash(dedupeSeed).slice(0, 6);
  let candidate = `${baseSlug}-${hash}`;
  let counter = 2;
  while (existingSlugs.has(candidate)) {
    candidate = `${baseSlug}-${hash}-${counter}`;
    counter += 1;
  }
  return candidate;
}

const TAG_TO_FILE_HINTS: Record<string, string[]> = {
  repo: ['md', 'json', 'yaml', 'ts', 'js'],
  files: ['md', 'json', 'yaml', 'csv'],
  api: ['http', 'json', 'yaml'],
  rest: ['http', 'json'],
  graphql: ['graphql', 'json'],
  webhook: ['json'],
  schema: ['sql', 'prisma', 'json'],
  database: ['sql', 'json'],
  db: ['sql'],
  sql: ['sql'],
  code: ['ts', 'tsx', 'js'],
  patch: ['diff', 'patch'],
  tests: ['test.ts', 'spec.ts'],
  docs: ['md'],
  readme: ['md'],
  config: ['json', 'yaml', 'toml', '.env'],
  report: ['md', 'json', 'csv'],
  csv: ['csv'],
  json: ['json'],
  yaml: ['yaml', 'yml'],
  markdown: ['md'],
  pdf: ['pdf'],
  docx: ['docx'],
  pptx: ['pptx'],
};

function expectedFileTypes(tags: string[]): string[] {
  const hints = new Set<string>();
  for (const tag of tags) {
    const mapped = TAG_TO_FILE_HINTS[tag];
    if (!mapped) continue;
    for (const hint of mapped) {
      hints.add(hint);
    }
  }
  if (hints.size === 0) {
    hints.add('md');
    hints.add('json');
  }
  return Array.from(hints).slice(0, 10);
}

function escapeYamlSingleLine(value: string): string {
  return value.replace(/"/g, '\\"').replace(/\s+/g, ' ').trim();
}

function makeConcreteDescription(
  stepTitle: string,
  inputsTags: string[],
  artifactsTags: string[],
): string {
  const inputLead = inputsTags.slice(0, 2).join(', ') || 'workflow inputs';
  const outputLead = artifactsTags.slice(0, 2).join(', ') || 'documented outputs';
  return `Create ${outputLead} from ${inputLead} for ${stepTitle.toLowerCase()}.`;
}

function toList(items: string[], fallback: string): string {
  if (items.length === 0) return `- ${fallback}`;
  return items.map((item) => `- ${item}`).join('\n');
}

function generateSkillMarkdown(params: {
  slug: string;
  description: string;
  stepId: string;
  stepTitle: string;
  stage: Stage;
  planName?: string;
  createdAtIso: string;
  missingTag: string;
  inputsTags: string[];
  artifactsTags: string[];
  capabilitiesTags: string[];
  prerequisites: string[];
  constraints: string[];
}): string {
  const inputFileTypes = expectedFileTypes(params.inputsTags);
  const outputs = params.artifactsTags.length ? params.artifactsTags : ['docs'];
  const capabilities = params.capabilitiesTags.length ? params.capabilitiesTags : [params.missingTag];

  return [
    '---',
    `name: ${params.slug}`,
    `description: "${escapeYamlSingleLine(params.description)}"`,
    '---',
    '',
    '## When to use',
    `- Use during \`${params.stage}\` stage when "${params.stepTitle}" has gaps in capability \`${params.missingTag}\`.`,
    '- Use when existing skills do not provide the required tag overlap for this step.',
    '',
    '## Inputs',
    toList(params.inputsTags, 'No explicit tag inputs yet.'),
    `- expected_file_types: ${inputFileTypes.join(', ')}`,
    '',
    '## Outputs / Artifacts',
    toList(outputs, 'docs'),
    '',
    '## Capabilities',
    toList(capabilities, params.missingTag),
    '',
    '## Prereqs/Constraints',
    '- prerequisites:',
    toList(params.prerequisites, 'none'),
    '- constraints:',
    toList(params.constraints, 'none'),
    '',
    '## Guardrails',
    '- Must NOT run destructive commands or modify files outside the target skill folder.',
    '- Must NOT fabricate evidence, tags, or outputs not grounded in source materials.',
    '- Must ask for explicit confirmation before any network, secret, or production-impact action.',
    '',
    '## Origin',
    `- workflowTemplate: ${params.planName || 'custom'}`,
    `- stepId: ${params.stepId}`,
    `- stepTitle: ${params.stepTitle}`,
    `- missingCapability: ${params.missingTag}`,
    `- generatedAt: ${params.createdAtIso}`,
  ].join('\n');
}

function scriptsPlaceholder(slug: string): string {
  return [
    `# ${slug}/scripts`,
    '',
    'Place executable helper scripts for this skill here.',
    'Keep scripts deterministic and document expected inputs/outputs.',
  ].join('\n');
}

function referencesPlaceholder(slug: string): string {
  return [
    `# ${slug}/references`,
    '',
    'Place reference docs, examples, or specs used by this skill.',
    'Prefer concise, source-grounded artifacts.',
  ].join('\n');
}

const LAZY_ANALYZE_LIMIT = 18;

function scorePendingSkill(plan: WorkflowPlan, skill: SkillRecord): number {
  const corpus = [
    skill.name,
    skill.oneLiner,
    skill.facts.frontmatter.description || '',
    skill.facts.frontmatter.name || '',
    skill.rawSkillContent.slice(0, 2000),
  ]
    .join('\n')
    .toLowerCase();

  let score = 0;
  for (const step of plan.steps) {
    if (step.stage === skill.stage || skill.stage === 'other') {
      score += 0.3;
    }

    const tags = uniqueTags([...(step.inputsTags || []), ...(step.outputsTags || []), ...(step.capabilitiesTags || [])]);
    for (const tag of tags) {
      if (corpus.includes(tag.toLowerCase())) {
        score += 1;
      }
    }
  }

  if (skill.facts.requires.mcp) score += 0.2;
  if (skill.facts.requires.scripts) score += 0.2;

  return score;
}

function pickLazyCandidates(plan: WorkflowPlan, pendingSkills: SkillRecord[], limit: number): string[] {
  const scored = pendingSkills
    .map((skill) => ({
      id: skill.id,
      score: scorePendingSkill(plan, skill),
    }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  const meaningful = scored.filter((entry) => entry.score > 0).slice(0, limit);
  if (meaningful.length > 0) {
    return meaningful.map((entry) => entry.id);
  }

  return scored.slice(0, limit).map((entry) => entry.id);
}

function mergeSkills(baseSkills: SkillRecord[], updates: SkillRecord[]): SkillRecord[] {
  if (updates.length === 0) return baseSkills;
  const byId = new Map(updates.map((skill) => [skill.id, skill]));
  return baseSkills.map((skill) => byId.get(skill.id) ?? skill);
}

function defaultRunStepState(): WorkflowRunStepState {
  return { status: 'todo', note: '' };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeRunStateForPlan(
  plan: WorkflowPlan,
  rawState: unknown,
): WorkflowRunStateByStepId {
  const normalized: WorkflowRunStateByStepId = {};
  const source = isObjectRecord(rawState) ? rawState : {};

  for (const [index, step] of plan.steps.entries()) {
    const stepId = planStepId(step, index);
    const rawEntry = source[stepId];
    if (!isObjectRecord(rawEntry)) {
      normalized[stepId] = defaultRunStepState();
      continue;
    }

    const rawStatus = rawEntry.status;
    const status: WorkflowRunStepStatus =
      rawStatus === 'done' || rawStatus === 'failed' ? rawStatus : 'todo';
    const note = typeof rawEntry.note === 'string' ? rawEntry.note : '';
    normalized[stepId] = { status, note };
  }

  return normalized;
}

interface StaleSkillCandidate {
  skillId: string;
  reason: PendingReason;
}

async function detectStaleSkills(skills: SkillRecord[]): Promise<StaleSkillCandidate[]> {
  const staleBySkillId = new Map<string, PendingReason>();
  const llm = getLlmClient();
  const expectedProviderId = llm.providerId;
  const expectedModelId = getSemanticsModelId(expectedProviderId);

  for (const skill of skills) {
    if (skill.semanticsStatus !== 'ok') continue;

    try {
      if ((skill.semanticsMeta.providerId || 'gemini') !== expectedProviderId) {
        staleBySkillId.set(skill.id, 'model_changed');
        continue;
      }

      if (skill.semanticsMeta.modelId !== expectedModelId) {
        staleBySkillId.set(skill.id, 'model_changed');
        continue;
      }

      if (skill.semanticsMeta.promptVersion !== SEMANTICS_PROMPT_VERSION) {
        staleBySkillId.set(skill.id, 'prompt_changed');
        continue;
      }

      if (skill.semanticsMeta.vocabVersion !== TAG_VOCAB_VERSION) {
        staleBySkillId.set(skill.id, 'vocab_changed');
        continue;
      }

      if (skill.semanticsMeta.logicVersion !== SEMANTICS_LOGIC_VERSION) {
        staleBySkillId.set(skill.id, 'logic_changed');
        continue;
      }

      const expectedSemanticsFingerprint = await computeSemanticsFingerprint(skill.semanticsMeta);
      if (expectedSemanticsFingerprint !== skill.semanticsFingerprint) {
        staleBySkillId.set(skill.id, 'skill_changed');
        continue;
      }

      if (skill.rawSkillContent) {
        const currentSkillHash = await sha256Hex(skill.rawSkillContent);
        if (currentSkillHash !== skill.semanticsMeta.skillMdHash) {
          staleBySkillId.set(skill.id, 'skill_changed');
        }
      }
    } catch {
      staleBySkillId.set(skill.id, 'skill_changed');
    }
  }

  return Array.from(staleBySkillId.entries()).map(([skillId, reason]) => ({ skillId, reason }));
}

function planStepId(step: WorkflowPlan['steps'][number], index: number): string {
  return step.id || `step-${index + 1}`;
}

function findPlanStep(plan: WorkflowPlan | null, stepId: string, stepTitle: string): WorkflowPlan['steps'][number] | null {
  if (!plan) return null;
  return (
    plan.steps.find((step, index) => planStepId(step, index) === stepId) ||
    plan.steps.find((step) => step.title === stepTitle) ||
    null
  );
}

function expectedTagsForStep(plan: WorkflowPlan | null, step: SkillWorkflowAssembly['steps'][number]): string[] {
  const planStep = findPlanStep(plan, step.stepId, step.title);
  if (!planStep) return uniqueTags([...step.overlapTags, ...step.missingCapabilities]);
  return uniqueTags([...(planStep.inputsTags || []), ...(planStep.outputsTags || []), ...(planStep.capabilitiesTags || [])]);
}

function markdownSafe(value: string): string {
  return String(value || '')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
}

function markdownFilenameSeed(value: string): string {
  return String(value || 'workflow')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'workflow';
}

function buildWorkflowChecklistMarkdown(args: {
  plan: WorkflowPlan | null;
  assembly: SkillWorkflowAssembly;
  tagOnlyMode: boolean;
  skillsById: Map<string, SkillRecord>;
  runStateByStepId: WorkflowRunStateByStepId;
}): string {
  const now = new Date().toISOString();
  const title = args.plan?.name || args.plan?.id || 'Workflow checklist';
  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`Generated: ${now}`);
  lines.push(`Mode: ${args.tagOnlyMode ? 'tag-only' : 'graph+tags'}`);
  lines.push('');
  lines.push('## Steps');
  lines.push('');

  for (const [index, step] of args.assembly.steps.entries()) {
    const planStep = findPlanStep(args.plan, step.stepId, step.title);
    const artifactsToProduce = uniqueTags([
      ...(planStep?.outputsTags || []),
      ...(args.skillsById.get(step.selected?.skillId || '')?.artifactsTags || []),
    ]);
    const alternatives = step.alternatives.slice(0, 3);
    const overlap = step.overlapTags.length > 0 ? step.overlapTags.join(', ') : '-';
    const missing = step.missingCapabilities.length > 0 ? step.missingCapabilities.join(', ') : '-';
    const selected = step.selected;
    const runState = args.runStateByStepId[step.stepId] || defaultRunStepState();

    lines.push(`### ${index + 1}. [ ] ${markdownSafe(step.title)} (\`${step.stage}\`)`);
    lines.push('');
    lines.push(`- Run status: ${runState.status}${runState.note ? ` (${markdownSafe(runState.note)})` : ''}`);
    if (selected) {
      lines.push(`- Selected skill: \`${markdownSafe(selected.name)}\` (\`${selected.skillId}\`)`);
      lines.push(`- Score/confidence: ${selected.score.toFixed(2)} / ${Math.round(selected.confidence * 100)}%`);
      lines.push(`- Why: ${markdownSafe(selected.reasoning)}`);
    } else {
      lines.push('- Selected skill: _(none)_');
    }
    lines.push(`- Overlap tags: ${markdownSafe(overlap)}`);
    lines.push(`- Missing tags: ${markdownSafe(missing)}`);
    lines.push(`- Artifacts to produce: ${artifactsToProduce.length > 0 ? artifactsToProduce.join(', ') : '-'}`);
    if (alternatives.length > 0) {
      lines.push('- Alternatives:');
      for (const candidate of alternatives) {
        lines.push(
          `  - \`${markdownSafe(candidate.name)}\` (${candidate.score.toFixed(2)}, ${Math.round(candidate.confidence * 100)}%, stage: ${candidate.stage})`,
        );
      }
    } else {
      lines.push('- Alternatives: -');
    }
    lines.push('');
  }

  lines.push('## Global Missing Tags');
  lines.push('');
  if (args.assembly.missingCapabilities.length > 0) {
    for (const missing of args.assembly.missingCapabilities) {
      lines.push(`- ${markdownSafe(missing)}`);
    }
  } else {
    lines.push('- none');
  }

  return lines.join('\n');
}

function makeFeedbackActionKey(
  stepId: string,
  skillId: string,
  rating: 1 | -1,
  candidateType: WorkflowFeedbackCandidateType,
): string {
  return `${stepId}:${skillId}:${rating}:${candidateType}`;
}

const WorkflowPanel: React.FC<WorkflowPanelProps> = ({ skills, graph, analysisProgress, onAnalyzeSkillIds }) => {
  const [planDraft, setPlanDraft] = useState<WorkflowPlan>(DEFAULT_WORKFLOW_PLAN);
  const [planText, setPlanText] = useState(() => workflowPlanToJson(DEFAULT_WORKFLOW_PLAN));
  const [planValidationError, setPlanValidationError] = useState<string | null>(null);
  const [assembly, setAssembly] = useState<SkillWorkflowAssembly | null>(null);
  const [activePlan, setActivePlan] = useState<WorkflowPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [lockedSkillByStepId, setLockedSkillByStepId] = useState<Record<string, string>>({});
  const [tagOnlyMode, setTagOnlyMode] = useState(false);
  const [draftPreview, setDraftPreview] = useState<SkillDraftPreview | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [isDownloadingZip, setIsDownloadingZip] = useState(false);
  const [generatedDraftSlugs, setGeneratedDraftSlugs] = useState<string[]>([]);
  const [lazyAnalyzedCount, setLazyAnalyzedCount] = useState(0);
  const [lazyAnalyzePlanned, setLazyAnalyzePlanned] = useState(0);
  const [lazyAnalyzeFailed, setLazyAnalyzeFailed] = useState(0);
  const [staleRevalidationPlanned, setStaleRevalidationPlanned] = useState(0);
  const [staleRevalidatedCount, setStaleRevalidatedCount] = useState(0);
  const [staleRevalidationFailed, setStaleRevalidationFailed] = useState(0);
  const [isAssembling, setIsAssembling] = useState(false);
  const [graphOverride, setGraphOverride] = useState<SkillGraph | null>(null);
  const [architectInput, setArchitectInput] = useState<WorkflowArchitectInput>({
    description: '',
    workflowType: '',
    stack: '',
    constraints: '',
  });
  const [architectError, setArchitectError] = useState<string | null>(null);
  const [architectWarnings, setArchitectWarnings] = useState<WorkflowPlanNormalizationWarning[]>([]);
  const [architectRawPlan, setArchitectRawPlan] = useState<Partial<WorkflowPlan> | null>(null);
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [templates, setTemplates] = useState<WorkflowTemplateRecord[]>([]);
  const [templateName, setTemplateName] = useState('');
  const [templateDescription, setTemplateDescription] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [feedbackEntries, setFeedbackEntries] = useState<WorkflowFeedbackRecord[]>([]);
  const [feedbackBusyKey, setFeedbackBusyKey] = useState<string | null>(null);
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);
  const [runStateByStepId, setRunStateByStepId] = useState<WorkflowRunStateByStepId>(
    () => normalizeRunStateForPlan(DEFAULT_WORKFLOW_PLAN, {}),
  );
  const [workflowRunImportError, setWorkflowRunImportError] = useState<string | null>(null);
  const [dangerGateAccepted, setDangerGateAccepted] = useState(false);
  const [pendingDangerExport, setPendingDangerExport] = useState<DangerExportAction | null>(null);
  const templateImportInputRef = useRef<HTMLInputElement>(null);
  const workflowRunImportInputRef = useRef<HTMLInputElement>(null);

  const analyzedSkills = useMemo(() => skills.filter((skill) => skill.semanticsStatus === 'ok'), [skills]);
  const pendingSkills = useMemo(() => skills.filter((skill) => skill.semanticsStatus !== 'ok'), [skills]);
  const warmCacheCoverage = skills.length > 0 ? analyzedSkills.length / skills.length : 0;
  const effectiveGraph = graphOverride ?? graph;
  const graphHasStructure = effectiveGraph.metrics.candidateCount > 0 || effectiveGraph.edges.length > 0;
  const graphAvailable = analyzedSkills.length > 0;
  const skillsById = useMemo(() => new Map(skills.map((skill) => [skill.id, skill])), [skills]);
  const existingSkillSlugs = useMemo(() => {
    const set = new Set<string>();
    for (const skill of skills) {
      set.add(slugifySkillName(skill.name));
      set.add(slugifySkillName(skill.facts.canonicalName));
      const idTail = skill.id.split(':').pop();
      if (idTail) {
        set.add(slugifySkillName(idTail));
      }
    }
    return set;
  }, [skills]);

  const selectedStep = useMemo(
    () => assembly?.steps.find((step) => step.stepId === selectedStepId) ?? assembly?.steps[0] ?? null,
    [assembly, selectedStepId],
  );
  const selectedStepLockedSkillId = selectedStep ? lockedSkillByStepId[selectedStep.stepId] || null : null;
  const selectedStepRunState = selectedStep ? runStateByStepId[selectedStep.stepId] ?? defaultRunStepState() : null;
  const hasDangerSelection = useMemo(
    () =>
      Boolean(
        assembly?.steps.some((step) => {
          const skillId = step.selected?.skillId;
          if (!skillId) return false;
          return skillsById.get(skillId)?.riskLevel === 'danger';
        }),
      ),
    [assembly, skillsById],
  );
  const runStateSummary = useMemo(() => {
    const entries = Object.values(runStateByStepId);
    let todo = 0;
    let done = 0;
    let failed = 0;
    for (const entry of entries) {
      if (entry.status === 'done') done += 1;
      else if (entry.status === 'failed') failed += 1;
      else todo += 1;
    }
    return { todo, done, failed };
  }, [runStateByStepId]);

  const selectedCandidate = useMemo(() => {
    if (!selectedStep) return null;
    if (selectedSkillId) {
      const alternativeHit = selectedStep.alternatives.find((candidate) => candidate.skillId === selectedSkillId);
      if (alternativeHit) return alternativeHit;
      if (selectedStep.selected?.skillId === selectedSkillId) return selectedStep.selected;
    }
    return selectedStep.selected ?? selectedStep.alternatives[0] ?? null;
  }, [selectedStep, selectedSkillId]);

  const selectedSkill = selectedCandidate ? skillsById.get(selectedCandidate.skillId) ?? null : null;
  const feedbackTallies = useMemo(() => {
    const tallyByStage = new Map<string, { up: number; down: number }>();
    const tallyGlobal = new Map<string, { up: number; down: number }>();

    for (const entry of feedbackEntries) {
      const stageKey = `${entry.skillId}::${entry.stepStage}`;
      const stageTally = tallyByStage.get(stageKey) || { up: 0, down: 0 };
      if (entry.rating > 0) {
        stageTally.up += 1;
      } else {
        stageTally.down += 1;
      }
      tallyByStage.set(stageKey, stageTally);

      const globalTally = tallyGlobal.get(entry.skillId) || { up: 0, down: 0 };
      if (entry.rating > 0) {
        globalTally.up += 1;
      } else {
        globalTally.down += 1;
      }
      tallyGlobal.set(entry.skillId, globalTally);
    }

    return { tallyByStage, tallyGlobal };
  }, [feedbackEntries]);

  const getFeedbackTally = (skillId: string, stepStage: Stage): { up: number; down: number } => {
    return (
      feedbackTallies.tallyByStage.get(`${skillId}::${stepStage}`) ||
      feedbackTallies.tallyGlobal.get(skillId) ||
      { up: 0, down: 0 }
    );
  };

  const syncPlan = (
    nextPlan: WorkflowPlan,
    options?: { warnings?: WorkflowPlanNormalizationWarning[]; rawPlan?: Partial<WorkflowPlan> | null },
  ) => {
    setPlanDraft(nextPlan);
    setPlanText(workflowPlanToJson(nextPlan));
    setPlanValidationError(null);
    setArchitectWarnings(options?.warnings ?? []);
    setArchitectRawPlan(options?.rawPlan ?? null);
    setError(null);
    setAssembly(null);
    setActivePlan(null);
    setSelectedStepId(null);
    setSelectedSkillId(null);
  };

  const applyPlanText = (nextText: string) => {
    setPlanText(nextText);
    try {
      const parsed = parseWorkflowPlanJsonWithVocab(nextText);
      setPlanDraft(parsed.plan);
      setArchitectWarnings(parsed.warnings);
      setArchitectRawPlan(parsed.rawPlan);
      setPlanValidationError(null);
    } catch (parseError) {
      setPlanValidationError(parseError instanceof Error ? parseError.message : 'Invalid workflow JSON');
      setArchitectWarnings([]);
      setArchitectRawPlan(null);
    }
  };

  const refreshTemplates = async () => {
    const nextTemplates = await listWorkflowTemplates();
    setTemplates(nextTemplates);
  };

  const refreshFeedback = async () => {
    const nextFeedback = await listWorkflowFeedback();
    setFeedbackEntries(nextFeedback);
  };

  useEffect(() => {
    void Promise.all([refreshTemplates(), refreshFeedback()]);
  }, []);

  useEffect(() => {
    const validStepIds = new Set(planDraft.steps.map((step, index) => step.id || `step-${index + 1}`));
    setLockedSkillByStepId((prev) =>
      Object.fromEntries(Object.entries(prev).filter(([stepId]) => validStepIds.has(stepId))),
    );
  }, [planDraft.steps]);

  useEffect(() => {
    setRunStateByStepId((prev) => {
      const next = normalizeRunStateForPlan(planDraft, prev);
      return next;
    });
  }, [planDraft]);

  useEffect(() => {
    setDangerGateAccepted(false);
    setPendingDangerExport(null);
  }, [assembly]);

  const setArchitectField = (field: keyof WorkflowArchitectInput, value: string) => {
    setArchitectInput((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleGeneratePlan = async () => {
    const description = architectInput.description.trim();
    if (!description) {
      setArchitectError('Describe workflow first.');
      return;
    }

    setIsGeneratingPlan(true);
    setArchitectError(null);
    try {
      const generated = await generateWorkflowPlanFromDescription(architectInput, { retries: 1 });
      syncPlan(generated.plan, {
        warnings: generated.warnings,
        rawPlan: generated.rawPlan,
      });
      setTemplateName(generated.plan.name || '');
    } catch (generationError) {
      setArchitectError(generationError instanceof Error ? generationError.message : 'Plan generation failed.');
    } finally {
      setIsGeneratingPlan(false);
    }
  };

  const makeTemplateId = () => {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }
    return `template-${Date.now()}-${Math.random().toString(16).slice(2, 9)}`;
  };

  const handleSaveTemplate = async () => {
    const name = (templateName || planDraft.name || '').trim();
    if (!name) {
      setArchitectError('Template name is required.');
      return;
    }

    const existing = templates.find((entry) => entry.templateId === selectedTemplateId) || null;
    const now = new Date().toISOString();
    const template: WorkflowTemplateRecord = {
      templateId: existing?.templateId || makeTemplateId(),
      name,
      description: templateDescription.trim(),
      workflowType: architectInput.workflowType.trim(),
      stack: architectInput.stack.trim(),
      constraints: architectInput.constraints.trim(),
      plan: planDraft,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    await saveWorkflowTemplate(template);
    await refreshTemplates();
    setSelectedTemplateId(template.templateId);
  };

  const handleLoadTemplate = () => {
    const selected = templates.find((entry) => entry.templateId === selectedTemplateId);
    if (!selected) return;
    syncPlan(selected.plan);
    setTemplateName(selected.name);
    setTemplateDescription(selected.description);
    setArchitectInput((prev) => ({
      ...prev,
      workflowType: selected.workflowType,
      stack: selected.stack,
      constraints: selected.constraints,
    }));
  };

  const handleDeleteTemplate = async () => {
    if (!selectedTemplateId) return;
    await deleteWorkflowTemplate(selectedTemplateId);
    setSelectedTemplateId('');
    await refreshTemplates();
  };

  const handleExportTemplates = async () => {
    const payload = await exportWorkflowTemplatesSnapshot();
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    exportJson(`workflow-templates-${stamp}.json`, payload);
  };

  const handleImportTemplates = async (file: File) => {
    const text = await file.text();
    const payload = JSON.parse(text) as unknown;
    const result = await importWorkflowTemplatesSnapshot(payload);
    await refreshTemplates();
    setArchitectError(null);
    alert(`Imported ${result.importedTemplates} workflow templates.`);
  };

  const updatePlanStep = (stepId: string, updater: (step: WorkflowPlan['steps'][number]) => WorkflowPlan['steps'][number]) => {
    const nextPlan = {
      ...planDraft,
      steps: planDraft.steps.map((step, index) => {
        const id = step.id || `step-${index + 1}`;
        return id === stepId ? updater(step) : step;
      }),
    };
    syncPlan(nextPlan);
  };

  const moveStep = (stepId: string, direction: -1 | 1) => {
    const currentIndex = planDraft.steps.findIndex((step, index) => (step.id || `step-${index + 1}`) === stepId);
    if (currentIndex === -1) return;
    const targetIndex = currentIndex + direction;
    if (targetIndex < 0 || targetIndex >= planDraft.steps.length) return;

    const nextSteps = [...planDraft.steps];
    const [item] = nextSteps.splice(currentIndex, 1);
    nextSteps.splice(targetIndex, 0, item);
    syncPlan({ ...planDraft, steps: nextSteps });
  };

  const addStep = () => {
    const nextStep = createDefaultWorkflowStep(planDraft.steps.length);
    syncPlan({
      ...planDraft,
      steps: [...planDraft.steps, nextStep],
    });
  };

  const removeStep = (stepId: string) => {
    const nextSteps = planDraft.steps.filter((step, index) => (step.id || `step-${index + 1}`) !== stepId);
    if (nextSteps.length === 0) return;
    setLockedSkillByStepId((prev) => {
      const copy = { ...prev };
      delete copy[stepId];
      return copy;
    });
    syncPlan({ ...planDraft, steps: nextSteps });
  };

  const toggleStepLock = (stepId: string, skillId: string | null) => {
    if (!skillId) return;
    setLockedSkillByStepId((prev) => {
      if (prev[stepId] === skillId) {
        const copy = { ...prev };
        delete copy[stepId];
        return copy;
      }
      return {
        ...prev,
        [stepId]: skillId,
      };
    });
  };

  const runAssembler = async () => {
    if (planValidationError) {
      setError(`Plan JSON is invalid: ${planValidationError}`);
      return;
    }

    setError(null);
    setIsAssembling(true);
    setLazyAnalyzedCount(0);
    setLazyAnalyzePlanned(0);
    setLazyAnalyzeFailed(0);
    setStaleRevalidationPlanned(0);
    setStaleRevalidatedCount(0);
    setStaleRevalidationFailed(0);
    setWorkflowRunImportError(null);

    try {
      const plan = planDraft;
      let workingSkills = skills;
      let workingAnalyzed = workingSkills.filter((skill) => skill.semanticsStatus === 'ok');
      let workingGraph = effectiveGraph;
      let graphReady = workingAnalyzed.length > 0;

      const staleSkills = await detectStaleSkills(workingSkills);
      if (staleSkills.length > 0) {
        const staleReasonBySkillId = new Map(staleSkills.map((entry) => [entry.skillId, entry.reason]));
        const staleSet = new Set(staleSkills.map((entry) => entry.skillId));
        workingSkills = workingSkills.map((skill) =>
          staleSet.has(skill.id)
            ? {
                ...skill,
                semanticsStatus: 'pending',
                pendingReason: staleReasonBySkillId.get(skill.id) || 'skill_changed',
              }
            : skill,
        );
        setStaleRevalidationPlanned(staleSkills.length);
        setFeedbackNotice(
          `Detected ${staleSkills.length} stale skill fingerprint(s). Revalidating with Pass2 before assemble...`,
        );

        const staleResult = await onAnalyzeSkillIds(
          staleSkills.map((entry) => entry.skillId),
          'pass2',
          { batchSize: 8 },
        );
        setStaleRevalidatedCount(staleResult.succeeded);
        setStaleRevalidationFailed(staleResult.failed);

        workingSkills = mergeSkills(workingSkills, staleResult.updated);
        workingAnalyzed = workingSkills.filter((skill) => skill.semanticsStatus === 'ok');
        workingGraph = buildSkillGraph(workingAnalyzed);
        graphReady = workingAnalyzed.length > 0;
        setGraphOverride(workingGraph);
      }

      if (workingAnalyzed.length === 0 || (pendingSkills.length > 0 && warmCacheCoverage < 0.8)) {
        const lazyCandidates = pickLazyCandidates(plan, pendingSkills, LAZY_ANALYZE_LIMIT);
        if (lazyCandidates.length > 0) {
          setLazyAnalyzePlanned(lazyCandidates.length);
          const lazyResult = await onAnalyzeSkillIds(lazyCandidates, 'pass1', { batchSize: 12 });
          setLazyAnalyzedCount(lazyResult.succeeded);
          setLazyAnalyzeFailed(lazyResult.failed);

          workingSkills = mergeSkills(workingSkills, lazyResult.updated);
          workingAnalyzed = workingSkills.filter((skill) => skill.semanticsStatus === 'ok');
          workingGraph = buildSkillGraph(workingAnalyzed);
          graphReady = workingAnalyzed.length > 0;
          setGraphOverride(workingGraph);
        }
      }

      const assemblySkills = graphReady ? workingAnalyzed : workingSkills;
      const lockSubset: Record<string, string> = {};
      for (const [stepId, skillId] of Object.entries(lockedSkillByStepId) as Array<[string, string]>) {
        if (assemblySkills.some((skill) => skill.id === skillId)) {
          lockSubset[stepId] = skillId;
        }
      }

      const workflow = assembleWorkflow(plan, assemblySkills, {
        graph: graphReady ? workingGraph : null,
        alternativesLimit: 3,
        lockedSkillByStepId: lockSubset,
        feedbackEntries,
      });

      setActivePlan(plan);
      setAssembly(workflow);
      const firstStep = workflow.steps[0] ?? null;
      setSelectedStepId(firstStep?.stepId ?? null);
      setSelectedSkillId(firstStep?.selected?.skillId ?? firstStep?.alternatives[0]?.skillId ?? null);
      setTagOnlyMode(!graphReady);
    } catch (assembleError) {
      console.error('Workflow assemble failed:', assembleError);
      setAssembly(null);
      setActivePlan(null);
      setSelectedStepId(null);
      setSelectedSkillId(null);
      setError(assembleError instanceof Error ? assembleError.message : 'Failed to parse/assemble workflow plan.');
    } finally {
      setIsAssembling(false);
    }
  };

  const selectPreset = (presetId: string) => {
    const preset = PRESETS.find((entry) => entry.id === presetId);
    if (!preset) return;
    syncPlan(parseWorkflowPlanJson(JSON.stringify(preset.plan)));
    setError(null);
  };

  const createSkillDraft = (step: SkillWorkflowAssembly['steps'][number], missingTag: string) => {
    const planStep =
      activePlan?.steps.find((entry) => entry.id === step.stepId) ??
      activePlan?.steps.find((entry) => entry.title === step.title) ??
      null;
    const suggestion = buildSuggestionForTag(step, missingTag);
    const baseSlug = slugifySkillName(suggestion.name);
    const existing = new Set([...existingSkillSlugs, ...generatedDraftSlugs]);
    const dedupeSeed = `${step.stepId}|${step.title}|${missingTag}|${activePlan?.name || activePlan?.id || 'custom'}`;
    const slug = ensureUniqueSlug(baseSlug, existing, dedupeSeed);
    const selectedForStep = step.selected ? skillsById.get(step.selected.skillId) ?? null : null;

    const inputsTags = uniqueTags([...(planStep?.inputsTags || []), missingTag]).slice(0, 8);
    const artifactsTags = uniqueTags([
      ...(planStep?.outputsTags || []),
      ...(step.missingCapabilities.includes(missingTag) ? [missingTag] : []),
    ]).slice(0, 8);
    const capabilitiesTags = uniqueTags([...(planStep?.capabilitiesTags || []), ...step.missingCapabilities]).slice(0, 8);
    const createdAtIso = new Date().toISOString();
    const description = makeConcreteDescription(step.title, inputsTags, artifactsTags);
    const markdown = generateSkillMarkdown({
      slug,
      description,
      stepId: step.stepId,
      stepTitle: step.title,
      stage: step.stage,
      planName: activePlan?.name || activePlan?.id,
      createdAtIso,
      missingTag,
      inputsTags,
      artifactsTags,
      capabilitiesTags,
      prerequisites: selectedForStep?.prerequisites ?? [],
      constraints: selectedForStep?.constraints ?? [],
    });

    setGeneratedDraftSlugs((prev) => Array.from(new Set([...prev, slug])));
    setDraftError(null);
    setDraftPreview({
      slug,
      stepId: step.stepId,
      stepTitle: step.title,
      missingTag,
      planName: activePlan?.name || activePlan?.id,
      createdAtIso,
      inputsTags,
      artifactsTags,
      capabilitiesTags,
      prerequisites: selectedForStep?.prerequisites ?? [],
      constraints: selectedForStep?.constraints ?? [],
      skillMd: markdown,
    });
  };

  const downloadDraftSkillMd = () => {
    if (!draftPreview) return;
    downloadText(`${draftPreview.slug}-SKILL.md`, draftPreview.skillMd);
  };

  const downloadDraftZip = async () => {
    if (!draftPreview || isDownloadingZip) return;
    setIsDownloadingZip(true);
    setDraftError(null);
    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      zip.file(`${draftPreview.slug}/SKILL.md`, draftPreview.skillMd);
      zip.file(`${draftPreview.slug}/scripts/README.md`, scriptsPlaceholder(draftPreview.slug));
      zip.file(`${draftPreview.slug}/references/README.md`, referencesPlaceholder(draftPreview.slug));
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${draftPreview.slug}-draft.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (zipError) {
      console.error('ZIP generation failed:', zipError);
      setDraftError('Failed to generate ZIP draft. SKILL.md download is still available.');
    } finally {
      setIsDownloadingZip(false);
    }
  };

  const onSelectStep = (stepId: string) => {
    setSelectedStepId(stepId);
    const step = assembly?.steps.find((entry) => entry.stepId === stepId);
    if (!step) return;
    setSelectedSkillId(step.selected?.skillId ?? step.alternatives[0]?.skillId ?? null);
  };

  const handleCandidateFeedback = async (
    step: SkillWorkflowAssembly['steps'][number],
    candidate: WorkflowSkillCandidate,
    rating: 1 | -1,
    candidateType: WorkflowFeedbackCandidateType,
  ) => {
    const actionKey = makeFeedbackActionKey(step.stepId, candidate.skillId, rating, candidateType);
    setFeedbackBusyKey(actionKey);
    setFeedbackNotice(null);
    try {
      const expectedTags = expectedTagsForStep(activePlan, step);
      const saved = await addWorkflowFeedback({
        skillId: candidate.skillId,
        stepId: step.stepId,
        stepStage: step.stage,
        expectedTags,
        matchedTags: uniqueTags(candidate.matchedTags),
        rating,
        candidateType,
      });

      setFeedbackEntries((prev) => [saved, ...prev].slice(0, 5000));
      const label = rating > 0 ? 'upvote' : 'downvote';
      setFeedbackNotice(`Saved ${label} for ${candidate.name}. Re-run Assemble to apply updated preference bias.`);
    } catch (feedbackError) {
      const message = feedbackError instanceof Error ? feedbackError.message : 'Failed to save feedback.';
      setFeedbackNotice(message);
    } finally {
      setFeedbackBusyKey(null);
    }
  };

  const handleExportWorkflowMarkdown = () => {
    if (!assembly) return;
    const markdown = buildWorkflowChecklistMarkdown({
      plan: activePlan,
      assembly,
      tagOnlyMode,
      skillsById,
      runStateByStepId,
    });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const seed = markdownFilenameSeed(activePlan?.name || activePlan?.id || 'workflow');
    downloadText(`${seed}-checklist-${stamp}.md`, markdown);
  };

  const handleExportWorkflowRunJson = () => {
    if (!assembly) return;
    exportJson(`assembled-workflow-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`, {
      workflowPlan: activePlan || planDraft,
      skillWorkflow: assembly,
      lockedSkillByStepId,
      runStateByStepId,
      mode: tagOnlyMode ? 'tag-only' : 'graph+tags',
    });
  };

  const withDangerGate = (action: DangerExportAction, callback: () => void) => {
    if (!hasDangerSelection || dangerGateAccepted) {
      callback();
      return;
    }

    setPendingDangerExport(action);
  };

  const executeDangerExportAction = (action: DangerExportAction | null) => {
    if (!action) return;
    if (action === 'markdown') {
      handleExportWorkflowMarkdown();
      return;
    }
    handleExportWorkflowRunJson();
  };

  const handleDangerGateCancel = () => {
    setPendingDangerExport(null);
  };

  const handleDangerGateContinue = () => {
    setDangerGateAccepted(true);
    executeDangerExportAction(pendingDangerExport);
    setPendingDangerExport(null);
  };

  const updateRunStepStatus = (stepId: string, status: WorkflowRunStepStatus) => {
    setRunStateByStepId((prev) => ({
      ...prev,
      [stepId]: {
        ...(prev[stepId] || defaultRunStepState()),
        status,
      },
    }));
  };

  const updateRunStepNote = (stepId: string, note: string) => {
    setRunStateByStepId((prev) => ({
      ...prev,
      [stepId]: {
        ...(prev[stepId] || defaultRunStepState()),
        note,
      },
    }));
  };

  const handleImportWorkflowRun = async (file: File) => {
    const text = await file.text();
    const payload = JSON.parse(text) as unknown;
    if (!isObjectRecord(payload) || !payload.workflowPlan) {
      throw new Error('Invalid workflow run JSON: missing workflowPlan');
    }

    const normalizedPlan = normalizeWorkflowPlanWithVocab(payload.workflowPlan as Partial<WorkflowPlan>);
    syncPlan(normalizedPlan.plan, {
      warnings: normalizedPlan.warnings,
      rawPlan: normalizedPlan.rawPlan,
    });

    const importedLocks = isObjectRecord(payload.lockedSkillByStepId) ? payload.lockedSkillByStepId : {};
    const nextLocks: Record<string, string> = {};
    for (const [stepId, skillId] of Object.entries(importedLocks)) {
      if (typeof skillId === 'string' && skillId.trim()) {
        nextLocks[stepId] = skillId.trim();
      }
    }

    setLockedSkillByStepId(nextLocks);
    setRunStateByStepId(normalizeRunStateForPlan(normalizedPlan.plan, payload.runStateByStepId));
    if (isObjectRecord(payload.skillWorkflow) && Array.isArray(payload.skillWorkflow.steps)) {
      const importedAssembly = payload.skillWorkflow as SkillWorkflowAssembly;
      setAssembly(importedAssembly);
      const firstStep = importedAssembly.steps[0] ?? null;
      setSelectedStepId(firstStep?.stepId ?? null);
      setSelectedSkillId(firstStep?.selected?.skillId ?? firstStep?.alternatives[0]?.skillId ?? null);
      const importedMode = payload.mode === 'tag-only';
      setTagOnlyMode(importedMode);
      setActivePlan(normalizedPlan.plan);
    } else {
      setAssembly(null);
      setActivePlan(null);
      setSelectedStepId(null);
      setSelectedSkillId(null);
    }
    setWorkflowRunImportError(null);
    setFeedbackNotice('Workflow run imported. You can continue from saved run state and locked steps.');
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-8 max-w-[1600px] mx-auto space-y-6">
        <div className="flex items-end justify-between border-b border-claude-border pb-4">
          <div>
            <h2 className="font-serif text-3xl text-gray-900 mb-1">Workflow Assembler</h2>
            <p className="text-sm text-claude-subtext">
              Build workflow mappings from current analyzed skills dataset. Missing capabilities are highlighted per step.
            </p>
          </div>
          {assembly ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => withDangerGate('markdown', handleExportWorkflowMarkdown)}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-[#D9D6CE] bg-white text-gray-800 text-sm hover:bg-[#F7F5EF]"
              >
                <Download size={14} />
                Export Markdown checklist
              </button>
              <button
                onClick={() => withDangerGate('json', handleExportWorkflowRunJson)}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-gray-900 text-white text-sm hover:bg-gray-800"
              >
                <Download size={14} />
                Export Workflow Run JSON
              </button>
            </div>
          ) : null}
        </div>

        <div className="bg-white rounded-xl border border-claude-border p-5 space-y-5">
          <div className="space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">Workflow Architect (LLM)</div>
            <textarea
              value={architectInput.description}
              onChange={(event) => setArchitectField('description', event.target.value)}
              placeholder="Describe workflow in plain language..."
              className="w-full min-h-[92px] rounded-lg border border-[#E6E4DD] bg-[#FDFCF9] text-sm text-gray-700 p-3 focus:outline-none focus:ring-2 focus:ring-claude-accent/30"
            />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <input
                value={architectInput.workflowType}
                onChange={(event) => setArchitectField('workflowType', event.target.value)}
                placeholder="Type (e.g. backend feature)"
                className="rounded-md border border-[#E6E4DD] bg-white text-xs p-2"
              />
              <input
                value={architectInput.stack}
                onChange={(event) => setArchitectField('stack', event.target.value)}
                placeholder="Stack (React, Node, Prisma...)"
                className="rounded-md border border-[#E6E4DD] bg-white text-xs p-2"
              />
              <input
                value={architectInput.constraints}
                onChange={(event) => setArchitectField('constraints', event.target.value)}
                placeholder="Constraints (no backend, strict security...)"
                className="rounded-md border border-[#E6E4DD] bg-white text-xs p-2"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void handleGeneratePlan()}
                disabled={isGeneratingPlan}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-gray-900 text-white text-xs disabled:opacity-50"
              >
                {isGeneratingPlan ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                {isGeneratingPlan ? 'Generating...' : 'Generate Plan'}
              </button>
              {architectError ? (
                <span className="text-xs text-red-700">Generation failed. Retry: {architectError}</span>
              ) : null}
            </div>
            {architectWarnings.length > 0 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-amber-800">
                  Tag normalization applied ({architectWarnings.length})
                </div>
                <div className="max-h-36 overflow-auto space-y-1">
                  {architectWarnings.slice(0, 14).map((warning, index) => (
                    <div key={`${warning.stepId}-${warning.field}-${warning.rawTag}-${index}`} className="text-xs text-amber-900">
                      <span className="font-semibold">{warning.stepId}</span> · {warning.field} · "{warning.rawTag}"
                      {warning.mappedTag ? ` -> "${warning.mappedTag}"` : ' -> dropped'} ({warning.reason})
                    </div>
                  ))}
                </div>
                <details className="text-xs text-amber-900">
                  <summary className="cursor-pointer font-medium">Debug: original architect JSON</summary>
                  <pre className="mt-2 whitespace-pre-wrap rounded border border-amber-200 bg-white p-2 text-[11px]">
                    {JSON.stringify(architectRawPlan, null, 2)}
                  </pre>
                </details>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Presets</span>
            {PRESETS.map((preset) => (
              <button
                key={preset.id}
                onClick={() => selectPreset(preset.id)}
                className="px-3 py-1.5 rounded-md border border-[#ECEAE4] bg-[#F9F8F5] text-xs text-gray-700 hover:bg-[#EFEDE8]"
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">Template Library</div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={templateName}
                onChange={(event) => setTemplateName(event.target.value)}
                placeholder="Template name"
                className="min-w-[180px] rounded-md border border-[#E6E4DD] bg-white text-xs p-2"
              />
              <input
                value={templateDescription}
                onChange={(event) => setTemplateDescription(event.target.value)}
                placeholder="Template description"
                className="min-w-[240px] rounded-md border border-[#E6E4DD] bg-white text-xs p-2"
              />
              <button
                onClick={() => void handleSaveTemplate()}
                className="inline-flex items-center gap-1 px-2.5 py-2 rounded-md bg-claude-accent text-white text-xs"
              >
                <Save size={12} />
                Save template
              </button>
              <button
                onClick={() => void handleExportTemplates()}
                className="inline-flex items-center gap-1 px-2.5 py-2 rounded-md border border-[#D9D6CE] bg-white text-xs text-gray-700"
              >
                <Download size={12} />
                Export templates
              </button>
              <button
                onClick={() => templateImportInputRef.current?.click()}
                className="inline-flex items-center gap-1 px-2.5 py-2 rounded-md border border-[#D9D6CE] bg-white text-xs text-gray-700"
              >
                <Upload size={12} />
                Import templates
              </button>
              <button
                onClick={() => workflowRunImportInputRef.current?.click()}
                className="inline-flex items-center gap-1 px-2.5 py-2 rounded-md border border-[#D9D6CE] bg-white text-xs text-gray-700"
              >
                <Upload size={12} />
                Import run JSON
              </button>
              <input
                ref={templateImportInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  void handleImportTemplates(file);
                  event.currentTarget.value = '';
                }}
              />
              <input
                ref={workflowRunImportInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  void handleImportWorkflowRun(file).catch((importError) => {
                    setWorkflowRunImportError(importError instanceof Error ? importError.message : 'Import failed.');
                  });
                  event.currentTarget.value = '';
                }}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedTemplateId}
                onChange={(event) => setSelectedTemplateId(event.target.value)}
                className="min-w-[260px] rounded-md border border-[#E6E4DD] bg-white text-xs p-2"
              >
                <option value="">Load template...</option>
                {templates.map((template) => (
                  <option key={template.templateId} value={template.templateId}>
                    {template.name}
                  </option>
                ))}
              </select>
              <button
                onClick={handleLoadTemplate}
                disabled={!selectedTemplateId}
                className="inline-flex items-center gap-1 px-2.5 py-2 rounded-md border border-[#D9D6CE] bg-white text-xs text-gray-700 disabled:opacity-50"
              >
                <FolderOpen size={12} />
                Load template
              </button>
              <button
                onClick={() => void handleDeleteTemplate()}
                disabled={!selectedTemplateId}
                className="inline-flex items-center gap-1 px-2.5 py-2 rounded-md border border-red-200 bg-red-50 text-xs text-red-700 disabled:opacity-50"
              >
                <Trash2 size={12} />
                Delete
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_1fr] gap-4">
            <div className="rounded-lg border border-[#ECEAE4] bg-[#FCFBF9] p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">Plan Editor</div>
                <button
                  onClick={addStep}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[#E6E4DD] bg-white text-xs text-gray-700"
                >
                  <Plus size={12} />
                  Add step
                </button>
              </div>
              <div className="space-y-2 max-h-[260px] overflow-auto">
                {planDraft.steps.map((step, index) => {
                  const stepId = step.id || `step-${index + 1}`;
                  return (
                    <div key={stepId} className="border border-[#E6E4DD] rounded-md bg-white p-2 space-y-2">
                      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-center">
                        <input
                          value={step.title || ''}
                          onChange={(event) => updatePlanStep(stepId, (current) => ({ ...current, title: event.target.value }))}
                          placeholder="Step title"
                          className="rounded border border-[#E6E4DD] bg-white text-xs p-1.5"
                        />
                        <select
                          value={step.stage}
                          onChange={(event) => updatePlanStep(stepId, (current) => ({ ...current, stage: event.target.value as Stage }))}
                          className="rounded border border-[#E6E4DD] bg-white text-xs p-1.5"
                        >
                          {WORKFLOW_STAGES.map((stage) => (
                            <option key={stage} value={stage}>
                              {stage}
                            </option>
                          ))}
                        </select>
                        <button onClick={() => moveStep(stepId, -1)} className="p-1.5 rounded border border-[#E6E4DD]">
                          <ArrowUp size={12} />
                        </button>
                        <button onClick={() => moveStep(stepId, 1)} className="p-1.5 rounded border border-[#E6E4DD]">
                          <ArrowDown size={12} />
                        </button>
                      </div>
                      <input
                        value={tagsToCsv(step.inputsTags)}
                        onChange={(event) => updatePlanStep(stepId, (current) => ({ ...current, inputsTags: parseTagsInput(event.target.value) }))}
                        placeholder="inputs tags (csv)"
                        className="w-full rounded border border-[#E6E4DD] bg-white text-xs p-1.5"
                      />
                      <input
                        value={tagsToCsv(step.outputsTags)}
                        onChange={(event) => updatePlanStep(stepId, (current) => ({ ...current, outputsTags: parseTagsInput(event.target.value) }))}
                        placeholder="outputs tags (csv)"
                        className="w-full rounded border border-[#E6E4DD] bg-white text-xs p-1.5"
                      />
                      <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
                        <input
                          value={tagsToCsv(step.capabilitiesTags || [])}
                          onChange={(event) =>
                            updatePlanStep(stepId, (current) => ({ ...current, capabilitiesTags: parseTagsInput(event.target.value) }))
                          }
                          placeholder="capabilities tags (csv)"
                          className="w-full rounded border border-[#E6E4DD] bg-white text-xs p-1.5"
                        />
                        <button
                          onClick={() => removeStep(stepId)}
                          disabled={planDraft.steps.length <= 1}
                          className="inline-flex items-center gap-1 px-2 py-1.5 rounded border border-red-200 bg-red-50 text-xs text-red-700 disabled:opacity-40"
                        >
                          <Trash2 size={12} />
                          Remove
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">Plan JSON</div>
              <textarea
                value={planText}
                onChange={(event) => applyPlanText(event.target.value)}
                className="w-full min-h-[260px] rounded-lg border border-[#E6E4DD] bg-[#FDFCF9] font-mono text-xs text-gray-700 p-3 focus:outline-none focus:ring-2 focus:ring-claude-accent/30"
              />
              {planValidationError ? (
                <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">{planValidationError}</div>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => void runAssembler()}
              disabled={skills.length === 0 || isAssembling || Boolean(planValidationError)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-claude-accent text-white text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isAssembling ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {isAssembling ? 'Assembling...' : 'Assemble'}
            </button>
            {skills.length === 0 ? (
              <span className="text-xs text-amber-700">Scan a folder first.</span>
            ) : null}
            {tagOnlyMode ? (
              <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                <AlertCircle size={12} />
                Graph unavailable, using tag-only fallback mode.
              </span>
            ) : null}
            {!graphHasStructure && graphAvailable ? (
              <button
                onClick={() => {
                  const rebuilt = buildSkillGraph(analyzedSkills);
                  setGraphOverride(rebuilt);
                  setTagOnlyMode(false);
                }}
                className="inline-flex items-center gap-1 text-xs text-claude-accent bg-[#FFF6F1] border border-[#F4D6C8] rounded px-2 py-1"
              >
                <Sparkles size={12} />
                Build graph from cached semantics
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600">
            <span>
              Warm-cache coverage: {Math.round(warmCacheCoverage * 100)}% ({analyzedSkills.length}/{skills.length || 0})
            </span>
            <span>
              Run state: {runStateSummary.done} done / {runStateSummary.failed} failed / {runStateSummary.todo} todo
            </span>
            {staleRevalidationPlanned > 0 ? (
              <span>
                Stale revalidated: {staleRevalidatedCount}/{staleRevalidationPlanned}
                {staleRevalidationFailed > 0 ? ` (${staleRevalidationFailed} failed)` : ''}
              </span>
            ) : null}
            {lazyAnalyzePlanned > 0 ? (
              <span>
                Lazy analyzed: {lazyAnalyzedCount}/{lazyAnalyzePlanned}
                {lazyAnalyzeFailed > 0 ? ` (${lazyAnalyzeFailed} failed)` : ''}
              </span>
            ) : null}
            {analysisProgress ? (
              <span>
                Progress: {analysisProgress.current}/{analysisProgress.total} ({analysisProgress.phase})
              </span>
            ) : null}
          </div>
          {error ? <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div> : null}
          {workflowRunImportError ? (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{workflowRunImportError}</div>
          ) : null}
          {feedbackNotice ? (
            <div className="text-sm text-gray-700 bg-[#F6F5F2] border border-[#E5E2DA] rounded px-3 py-2">{feedbackNotice}</div>
          ) : null}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[280px_1fr_420px] gap-4 min-h-[560px]">
          <section className="bg-white rounded-xl border border-claude-border p-3 overflow-y-auto">
            <h3 className="font-medium text-sm text-gray-800 px-2 pb-2">Workflow Steps</h3>
            {!assembly ? (
              <p className="text-xs text-gray-500 px-2 py-4">Assemble a plan to see step mapping.</p>
            ) : (
              <div className="space-y-2">
                {assembly.steps.map((step, index) => {
                  const isActive = step.stepId === (selectedStep?.stepId ?? selectedStepId);
                  const hasMissing = step.missingCapabilities.length > 0;
                  const runState = runStateByStepId[step.stepId] || defaultRunStepState();
                  return (
                    <button
                      key={step.stepId}
                      onClick={() => onSelectStep(step.stepId)}
                      className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${
                        isActive ? 'border-claude-accent bg-[#FFF6F1]' : 'border-[#ECEAE4] bg-[#F9F8F5] hover:bg-[#F2F1EC]'
                      }`}
                    >
                      <div className="text-xs text-gray-500 mb-1">
                        {index + 1}. {step.stage}
                      </div>
                      <div className="text-sm text-gray-800 font-medium leading-tight">{step.title}</div>
                      <div className="text-xs mt-2 flex items-center gap-2">
                        {step.selected ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700">
                            <CheckCircle2 size={12} /> matched
                          </span>
                        ) : (
                          <span className="text-amber-700">no match</span>
                        )}
                        {hasMissing ? (
                          <span className="text-amber-700">{step.missingCapabilities.length} missing</span>
                        ) : (
                          <span className="text-gray-500">complete</span>
                        )}
                        {step.locked ? (
                          <span className="inline-flex items-center gap-1 text-indigo-700">
                            <Lock size={11} />
                            locked
                          </span>
                        ) : null}
                        <span
                          className={`${
                            runState.status === 'done'
                              ? 'text-emerald-700'
                              : runState.status === 'failed'
                                ? 'text-red-700'
                                : 'text-gray-500'
                          }`}
                        >
                          {runState.status}
                        </span>
                      </div>
                      <div className="mt-2 space-y-1">
                        <div className="text-[11px] text-gray-600">
                          overlap: {step.overlapTags.length > 0 ? step.overlapTags.slice(0, 4).join(', ') : '-'}
                        </div>
                        <div className="text-[11px] text-amber-700">
                          missing: {step.missingCapabilities.length > 0 ? step.missingCapabilities.slice(0, 4).join(', ') : '-'}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <section className="bg-white rounded-xl border border-claude-border p-4 overflow-y-auto">
            {!selectedStep ? (
              <p className="text-sm text-gray-500">Select a step after assembling to inspect selected skill and alternatives.</p>
            ) : (
              <div className="space-y-4">
                <div className="border-b border-[#ECEAE4] pb-3">
                  <div className="text-xs text-gray-500 uppercase tracking-wide">{selectedStep.stage}</div>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-lg font-serif text-gray-900">{selectedStep.title}</h3>
                    <button
                      onClick={() => toggleStepLock(selectedStep.stepId, selectedStep.selected?.skillId || null)}
                      disabled={!selectedStep.selected}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[#E6E4DD] bg-[#F9F8F5] text-xs text-gray-700 disabled:opacity-50"
                    >
                      {selectedStepLockedSkillId ? <Unlock size={12} /> : <Lock size={12} />}
                      {selectedStepLockedSkillId ? 'Unlock step' : 'Lock selected'}
                    </button>
                  </div>
                  <div className="text-[11px] text-gray-600 mt-1">
                    overlap: {selectedStep.overlapTags.length > 0 ? selectedStep.overlapTags.join(', ') : '-'}
                  </div>
                  <div className="text-[11px] text-amber-700 mt-0.5">
                    missing: {selectedStep.missingCapabilities.length > 0 ? selectedStep.missingCapabilities.join(', ') : '-'}
                  </div>
                  {selectedStepRunState ? (
                    <div className="mt-2 grid grid-cols-1 md:grid-cols-[130px_1fr] gap-2">
                      <select
                        value={selectedStepRunState.status}
                        onChange={(event) => updateRunStepStatus(selectedStep.stepId, event.target.value as WorkflowRunStepStatus)}
                        className="rounded border border-[#E6E4DD] bg-white text-xs p-1.5"
                      >
                        <option value="todo">todo</option>
                        <option value="done">done</option>
                        <option value="failed">failed</option>
                      </select>
                      <input
                        value={selectedStepRunState.note}
                        onChange={(event) => updateRunStepNote(selectedStep.stepId, event.target.value)}
                        placeholder="Run note (optional)"
                        className="rounded border border-[#E6E4DD] bg-white text-xs p-1.5"
                      />
                    </div>
                  ) : null}
                </div>

                <div className="space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">Selected</div>
                  {selectedStep.selected ? (
                    (() => {
                      const candidate = selectedStep.selected as WorkflowSkillCandidate;
                      const tally = getFeedbackTally(candidate.skillId, selectedStep.stage);
                      return (
                        <div className="space-y-2">
                          <button
                            onClick={() => setSelectedSkillId(candidate.skillId)}
                            className={`w-full text-left rounded-lg border px-3 py-3 ${
                              selectedCandidate?.skillId === candidate.skillId
                                ? 'border-claude-accent bg-[#FFF6F1]'
                                : 'border-[#ECEAE4] bg-[#F9F8F5] hover:bg-[#F2F1EC]'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="font-medium text-gray-900 inline-flex items-center gap-2">
                                {candidate.name}
                                {selectedStepLockedSkillId ? (
                                  <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 border border-indigo-200 text-indigo-700">
                                    <Lock size={10} />
                                    locked
                                  </span>
                                ) : null}
                              </div>
                              <div className={`text-xs font-semibold ${confidenceClass(candidate.confidence)}`}>
                                {Math.round(candidate.confidence * 100)}%
                              </div>
                            </div>
                            <div className="text-xs text-gray-500 mt-1">
                              score {candidate.score.toFixed(2)} · {candidate.stage}
                            </div>
                            <div className="text-xs text-gray-700 mt-2">{candidate.reasoning}</div>
                          </button>
                          <div className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="text-gray-500">feedback: +{tally.up} / -{tally.down}</span>
                            <div className="inline-flex items-center gap-1">
                              <button
                                onClick={() => void handleCandidateFeedback(selectedStep, candidate, 1, 'selected')}
                                disabled={feedbackBusyKey === makeFeedbackActionKey(selectedStep.stepId, candidate.skillId, 1, 'selected')}
                                className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-700 disabled:opacity-50"
                              >
                                <ThumbsUp size={12} />
                                Useful
                              </button>
                              <button
                                onClick={() => void handleCandidateFeedback(selectedStep, candidate, -1, 'selected')}
                                disabled={feedbackBusyKey === makeFeedbackActionKey(selectedStep.stepId, candidate.skillId, -1, 'selected')}
                                className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-2 py-1 text-red-700 disabled:opacity-50"
                              >
                                <ThumbsDown size={12} />
                                Poor fit
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })()
                  ) : (
                    <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                      No skill selected for this step.
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">Alternatives</div>
                  {selectedStep.alternatives.length === 0 ? (
                    <div className="text-sm text-gray-500">No alternatives for this step.</div>
                  ) : (
                    selectedStep.alternatives.slice(0, 3).map((candidate) => (
                      <div key={`${selectedStep.stepId}-${candidate.skillId}`} className="space-y-2">
                        <button
                          onClick={() => setSelectedSkillId(candidate.skillId)}
                          className={`w-full text-left rounded-lg border px-3 py-3 ${
                            selectedCandidate?.skillId === candidate.skillId
                              ? 'border-claude-accent bg-[#FFF6F1]'
                              : 'border-[#ECEAE4] bg-[#F9F8F5] hover:bg-[#F2F1EC]'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-medium text-gray-900">{candidate.name}</div>
                            <div className={`text-xs font-semibold ${confidenceClass(candidate.confidence)}`}>
                              {Math.round(candidate.confidence * 100)}%
                            </div>
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            score {candidate.score.toFixed(2)} · {candidate.stage}
                          </div>
                          <div className="text-xs text-gray-700 mt-2">{candidate.reasoning}</div>
                        </button>
                        <div className="flex items-center justify-between gap-2 text-[11px]">
                          {(() => {
                            const tally = getFeedbackTally(candidate.skillId, selectedStep.stage);
                            return (
                              <>
                                <span className="text-gray-500">feedback: +{tally.up} / -{tally.down}</span>
                                <div className="inline-flex items-center gap-1">
                                  <button
                                    onClick={() => void handleCandidateFeedback(selectedStep, candidate, 1, 'alternative')}
                                    disabled={feedbackBusyKey === makeFeedbackActionKey(selectedStep.stepId, candidate.skillId, 1, 'alternative')}
                                    className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-700 disabled:opacity-50"
                                  >
                                    <ThumbsUp size={12} />
                                    Upvote
                                  </button>
                                  <button
                                    onClick={() => void handleCandidateFeedback(selectedStep, candidate, -1, 'alternative')}
                                    disabled={feedbackBusyKey === makeFeedbackActionKey(selectedStep.stepId, candidate.skillId, -1, 'alternative')}
                                    className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-2 py-1 text-red-700 disabled:opacity-50"
                                  >
                                    <ThumbsDown size={12} />
                                    Downvote
                                  </button>
                                </div>
                              </>
                            );
                          })()}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {selectedStep.missingCapabilities.length > 0 ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-wider text-amber-800">Missing capabilities</div>
                    <div className="space-y-1.5">
                      {selectedStep.missingCapabilities.map((tag) => (
                        <div key={tag} className="flex items-center justify-between gap-2 bg-white border border-amber-200 rounded px-2 py-1">
                          <span className="text-xs text-amber-800">{tag}</span>
                          <button
                            onClick={() => createSkillDraft(selectedStep, tag)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] border border-[#E6E4DD] bg-[#F9F8F5] text-gray-700 hover:bg-[#EFEDE8]"
                          >
                            <FilePlus2 size={12} />
                            Generate SKILL.md
                          </button>
                        </div>
                      ))}
                    </div>
                    {(() => {
                      const suggestion = buildSuggestion(selectedStep);
                      return (
                        <div className="text-xs text-amber-900 bg-white border border-amber-200 rounded p-2">
                          <div className="font-semibold">Suggested new skill</div>
                          <div className="mt-1 font-mono">name: {suggestion.name}</div>
                          <div>stage: {suggestion.stage}</div>
                          <div>desc: {suggestion.description}</div>
                          <div>tags: {suggestion.tags.join(', ') || '-'}</div>
                        </div>
                      );
                    })()}
                  </div>
                ) : null}
              </div>
            )}
          </section>

          <section className="bg-white rounded-xl border border-claude-border p-4 overflow-y-auto">
            {!selectedCandidate || !selectedSkill ? (
              <p className="text-sm text-gray-500">Select selected skill or alternative to view detail.</p>
            ) : (
              <div className="space-y-4">
                <div className="border-b border-[#ECEAE4] pb-3">
                  <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Skill Detail</div>
                  <h3 className="font-serif text-xl text-gray-900">{selectedSkill.name}</h3>
                  <p className="text-sm text-gray-600 mt-1">{selectedSkill.oneLiner}</p>
                  <div className="text-xs text-gray-500 mt-2">
                    <span className={`font-semibold ${confidenceClass(selectedCandidate.confidence)}`}>
                      confidence {Math.round(selectedCandidate.confidence * 100)}%
                    </span>{' '}
                    · score {selectedCandidate.score.toFixed(2)}
                  </div>
                </div>

                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Why selected</div>
                  <div className="text-sm text-gray-700 bg-[#F9F8F5] border border-[#ECEAE4] rounded p-3">
                    {selectedCandidate.reasoning}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {selectedCandidate.matchedTags.length === 0 ? (
                      <span className="text-xs text-gray-500">No matched tags.</span>
                    ) : (
                      selectedCandidate.matchedTags.map((tag) => (
                        <span key={tag} className="px-2 py-0.5 text-xs rounded bg-[#F3F1EC] border border-[#E4E0D6] text-gray-700">
                          {tag}
                        </span>
                      ))
                    )}
                  </div>
                </div>

                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Tags</div>
                  <div className="text-xs text-gray-700 space-y-1">
                    <div>
                      <span className="font-semibold">inputs:</span> {selectedSkill.inputsTags.join(', ') || '-'}
                    </div>
                    <div>
                      <span className="font-semibold">artifacts:</span> {selectedSkill.artifactsTags.join(', ') || '-'}
                    </div>
                    <div>
                      <span className="font-semibold">capabilities:</span> {selectedSkill.capabilitiesTags.join(', ') || '-'}
                    </div>
                  </div>
                </div>

                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Flags</div>
                  {selectedSkill.flags.length === 0 ? (
                    <div className="text-xs text-emerald-700">No flags.</div>
                  ) : (
                    <div className="space-y-1">
                      {selectedSkill.flags.slice(0, 8).map((flag) => (
                        <div key={`${flag.code}-${flag.message}`} className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                          {flag.code}
                          {flag.field ? ` (${flag.field})` : ''}: {flag.message}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Evidence</div>
                  {selectedSkill.semantics?.evidence?.length ? (
                    <div className="space-y-1">
                      {selectedSkill.semantics.evidence.slice(0, 5).map((evidence, index) => (
                        <div key={`${evidence.field}-${index}`} className="text-xs text-gray-700 bg-[#F9F8F5] border border-[#ECEAE4] rounded px-2 py-1.5">
                          <span className="font-semibold">{evidence.field}:</span> {evidence.quote}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-gray-500">No semantic evidence available.</div>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>

        {assembly ? (
          <div className="bg-white rounded-xl border border-claude-border p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Global missing capabilities</div>
            {assembly.missingCapabilities.length === 0 ? (
              <div className="text-sm text-emerald-700 inline-flex items-center gap-2">
                <CheckCircle2 size={15} /> No missing capabilities across workflow steps.
              </div>
            ) : (
              <div className="space-y-2">
                {assembly.missingCapabilities.map((tag) => (
                  <div key={tag} className="flex items-center justify-between gap-2 px-2.5 py-1 text-xs rounded bg-amber-50 border border-amber-200 text-amber-800">
                    <span>{tag}</span>
                    {selectedStep ? (
                      <button
                        onClick={() => createSkillDraft(selectedStep, tag)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
                      >
                        <FilePlus2 size={12} />
                        Generate SKILL.md
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
            <div className="text-xs text-gray-500 mt-3 inline-flex items-center gap-1">
              <GitBranch size={12} />
              mode: {tagOnlyMode ? 'tag-only' : 'graph+tags'} · analyzed skills: {analyzedSkills.length}
            </div>
          </div>
        ) : null}
      </div>

      {pendingDangerExport ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/35" onClick={handleDangerGateCancel}></div>
          <div className="relative w-full max-w-lg rounded-xl border border-red-300 bg-white shadow-2xl p-5 space-y-4">
            <div className="inline-flex items-center gap-2 text-red-700 text-sm font-semibold">
              <AlertCircle size={16} />
              Danger skills selected
            </div>
            <p className="text-sm text-gray-700">
              Export includes one or more skills marked as <code>riskLevel=danger</code>. Confirm that you understand
              the risk before continuing.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={handleDangerGateCancel}
                className="px-3 py-2 rounded-md border border-[#D9D6CE] bg-white text-sm text-gray-700 hover:bg-[#F7F5EF]"
              >
                Cancel
              </button>
              <button
                onClick={handleDangerGateContinue}
                className="px-3 py-2 rounded-md bg-red-600 text-white text-sm hover:bg-red-700"
              >
                I understand / Continue
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {draftPreview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/25" onClick={() => setDraftPreview(null)}></div>
          <div className="relative w-full max-w-5xl max-h-[88vh] overflow-hidden rounded-xl border border-claude-border bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-[#ECEAE4]">
              <div>
                <h3 className="font-serif text-xl text-gray-900">Draft Preview: {draftPreview.slug}</h3>
                <p className="text-xs text-gray-500 mt-1">
                  Origin: {draftPreview.stepId} · {draftPreview.stepTitle} · {draftPreview.createdAtIso}
                </p>
              </div>
              <button
                onClick={() => setDraftPreview(null)}
                className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100"
              >
                <X size={16} />
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] max-h-[calc(88vh-74px)]">
              <aside className="border-r border-[#ECEAE4] p-4 space-y-4 overflow-y-auto">
                <div>
                  <div className="text-xs uppercase tracking-wider text-gray-500 mb-2 font-semibold">Draft Metadata</div>
                  <div className="text-xs text-gray-700 space-y-1">
                    <div><span className="font-semibold">slug:</span> {draftPreview.slug}</div>
                    <div><span className="font-semibold">stage:</span> {selectedStep?.stage || '-'}</div>
                    <div><span className="font-semibold">plan:</span> {draftPreview.planName || 'custom'}</div>
                    <div><span className="font-semibold">missing capability:</span> {draftPreview.missingTag}</div>
                  </div>
                </div>

                <div>
                  <div className="text-xs uppercase tracking-wider text-gray-500 mb-2 font-semibold">Tags</div>
                  <div className="text-xs text-gray-700 space-y-1">
                    <div><span className="font-semibold">inputs:</span> {draftPreview.inputsTags.join(', ') || '-'}</div>
                    <div><span className="font-semibold">artifacts:</span> {draftPreview.artifactsTags.join(', ') || '-'}</div>
                    <div><span className="font-semibold">capabilities:</span> {draftPreview.capabilitiesTags.join(', ') || '-'}</div>
                  </div>
                </div>

                <div className="space-y-2">
                  <button
                    onClick={downloadDraftSkillMd}
                    className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-claude-accent text-white text-sm hover:bg-[#c26647]"
                  >
                    <Download size={14} />
                    Download SKILL.md
                  </button>
                  <button
                    onClick={downloadDraftZip}
                    disabled={isDownloadingZip}
                    className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-gray-900 text-white text-sm disabled:opacity-60"
                  >
                    <Package size={14} />
                    {isDownloadingZip ? 'Preparing ZIP...' : 'Download ZIP'}
                  </button>
                  <p className="text-[11px] text-gray-500">
                    ZIP contains `{draftPreview.slug}/SKILL.md`, `scripts/README.md`, `references/README.md`.
                  </p>
                </div>

                {draftError ? (
                  <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">{draftError}</div>
                ) : null}
              </aside>

              <div className="overflow-auto p-4 bg-[#FCFBF9]">
                <pre className="text-xs leading-relaxed text-gray-800 whitespace-pre-wrap font-mono border border-[#ECEAE4] bg-white rounded-lg p-4">
                  {draftPreview.skillMd}
                </pre>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default WorkflowPanel;
