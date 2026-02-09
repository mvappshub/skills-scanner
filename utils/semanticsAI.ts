import { CategoryId, ConfidenceBasis, EvidencePack, Facts, InvalidTagIssue, MachineTagSemantics, Semantics, Stage } from '../types';
import { getLlmClient } from './llm/client';
import { getSemanticsModelId } from './llm/config';
import { normalizeCategory } from './taxonomy';
import { fieldTagVocabularyForPrompt, isArtifactInterfaceTag, sanitizeMachineTags, tagVocabularyForPrompt } from './tagVocabulary';

export const SEMANTICS_MODEL_ID = getSemanticsModelId();
export const SEMANTICS_PROMPT_VERSION = 'p1-v1';
export const SEMANTICS_LOGIC_VERSION = 'semantics-v1';

function fallbackSemantics(facts: Facts): Semantics {
  const inferredStage: Stage = facts.riskLevel === 'danger' ? 'security' : 'other';
  return {
    oneLiner: facts.frontmatter.description || facts.canonicalName || 'Skill semantics unavailable',
    stage: inferredStage,
    humanReadable: {
      inputsText: [],
      artifactsText: [],
      capabilitiesText: [],
    },
    machineTags: {
      inputsTags: [],
      artifactsTags: [],
      capabilitiesTags: [],
    },
    prerequisites: facts.frontmatter.compatibility ?? [],
    constraints: [],
    sideEffects: facts.riskSignals,
    categoryId: 'general',
    confidence: 0.35,
    confidenceBasis: 'rules',
    evidence: [
      {
        field: 'fallback',
        quote: 'AI extraction failed; fallback from deterministic facts',
      },
    ],
    invalidTagIssues: [],
  };
}

function createPrompt(facts: Facts, evidence: EvidencePack, deep: boolean): string {
  return [
    'You are extracting workflow semantics for an Agent Skill.',
    'Return strict JSON only according to schema.',
    'Use only provided evidence and facts. Do not invent missing details.',
    '',
    'Facts:',
    JSON.stringify(
      {
        skillId: facts.skillId,
        rootPath: facts.rootPath,
        canonicalName: facts.canonicalName,
        frontmatter: facts.frontmatter,
        requires: facts.requires,
        mcpSignals: facts.mcpSignals,
        riskLevel: facts.riskLevel,
        riskSignals: facts.riskSignals,
      },
      null,
      2,
    ),
    '',
    'Evidence:',
    deep ? evidence.asText : evidence.items.slice(0, 4).map((item) => `${item.label}: ${item.content}`).join('\n\n'),
    '',
    'Required fields:',
    '- oneLiner: max 20 words',
    '- stage: one of intake, plan, implement, verify, refactor, security, docs, release, other',
    '- humanReadable.inputsText: 3-8 short descriptive phrases',
    '- humanReadable.artifactsText: 3-8 concrete deliverables (files/json/docs/prompts)',
    '- humanReadable.capabilitiesText: 3-8 abilities',
    `- machineTags.inputsTags: 3-8 canonical tags from allowed vocabulary only: ${fieldTagVocabularyForPrompt('inputsTags')}`,
    `- machineTags.artifactsTags: 3-8 canonical tags for OUTPUT artifacts only, from: ${fieldTagVocabularyForPrompt('artifactsTags')}`,
    `- machineTags.capabilitiesTags: 3-8 canonical tags from allowed vocabulary only: ${fieldTagVocabularyForPrompt('capabilitiesTags')}`,
    '- artifactsTags must correspond to actual output artifacts in humanReadable.artifactsText.',
    '- Do NOT infer artifactsTags from inputs or capabilities.',
    '- prerequisites: assumptions/dependencies',
    '- constraints: limits/requirements',
    '- sideEffects: risky or consequential actions',
    '- categoryId: one of skill_dev, skill_docs, workflow_ops, agent_config, prompt_eng, security, ml_ops, general',
    '- confidence: 0..1',
    '- confidenceBasis: one of rules, llm, hybrid',
    '- evidence: list of objects [{ field, quote }]',
    '- Never invent new tags outside the allowed vocabulary.',
    `- Global canonical vocabulary reference: ${tagVocabularyForPrompt()}`,
  ].join('\n');
}

export const SEMANTICS_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    oneLiner: { type: 'string' },
    stage: { type: 'string' },
    humanReadable: {
      type: 'object',
      additionalProperties: false,
      properties: {
        inputsText: { type: 'array', items: { type: 'string' } },
        artifactsText: { type: 'array', items: { type: 'string' } },
        capabilitiesText: { type: 'array', items: { type: 'string' } },
      },
      required: ['inputsText', 'artifactsText', 'capabilitiesText'],
    },
    machineTags: {
      type: 'object',
      additionalProperties: false,
      properties: {
        inputsTags: { type: 'array', items: { type: 'string' } },
        artifactsTags: { type: 'array', items: { type: 'string' } },
        capabilitiesTags: { type: 'array', items: { type: 'string' } },
      },
      required: ['inputsTags', 'artifactsTags', 'capabilitiesTags'],
    },
    prerequisites: { type: 'array', items: { type: 'string' } },
    constraints: { type: 'array', items: { type: 'string' } },
    sideEffects: { type: 'array', items: { type: 'string' } },
    categoryId: { type: 'string' },
    confidence: { type: 'number' },
    confidenceBasis: { type: 'string' },
    evidence: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          field: { type: 'string' },
          quote: { type: 'string' },
        },
        required: ['field', 'quote'],
      },
    },
  },
  required: [
    'oneLiner',
    'stage',
    'humanReadable',
    'machineTags',
    'prerequisites',
    'constraints',
    'sideEffects',
    'categoryId',
    'confidence',
    'confidenceBasis',
    'evidence',
  ],
};

function normalizeTextList(values: unknown, limit = 8): string[] {
  if (!Array.isArray(values)) return [];

  const normalized = values
    .map((entry) => String(entry ?? '').trim())
    .filter(Boolean)
    .map((entry) => entry.replace(/\s+/g, ' '));

  return Array.from(new Set(normalized)).slice(0, limit);
}

function mergeMachineTags(primary: MachineTagSemantics, secondary: MachineTagSemantics): MachineTagSemantics {
  return {
    inputsTags: Array.from(new Set([...primary.inputsTags, ...secondary.inputsTags])).slice(0, 8),
    artifactsTags: Array.from(new Set([...primary.artifactsTags, ...secondary.artifactsTags])).slice(0, 8),
    capabilitiesTags: Array.from(new Set([...primary.capabilitiesTags, ...secondary.capabilitiesTags])).slice(0, 8),
  };
}

function sanitizeStage(value: string): Stage {
  const allowed: Stage[] = ['intake', 'plan', 'implement', 'verify', 'refactor', 'security', 'docs', 'release', 'other'];
  return (allowed.includes(value as Stage) ? value : 'other') as Stage;
}

function sanitizeCategory(value: string): CategoryId {
  return normalizeCategory(value);
}

function sanitizeConfidenceBasis(value: string): ConfidenceBasis {
  if (value === 'rules' || value === 'llm' || value === 'hybrid') {
    return value;
  }
  return 'llm';
}

const ARTIFACT_TAG_EVIDENCE_HINTS: Record<string, string[]> = {
  plan: ['plan', 'roadmap', 'implementation plan'],
  spec: ['spec', 'specification', 'requirements doc', 'prd'],
  schema: ['schema', 'erd', 'model', 'migration'],
  code: ['code', 'implementation', 'source', 'module'],
  patch: ['patch', 'diff', 'changeset'],
  tests: ['test', 'suite', 'coverage'],
  docs: ['doc', 'documentation', 'guide'],
  config: ['config', 'configuration', 'settings', 'yaml', 'json', 'toml'],
  report: ['report', 'summary', 'analysis'],
  pr: ['pull request', 'pr'],
  deploy: ['deploy', 'release'],
  readme: ['readme'],
  changelog: ['changelog', 'release notes'],
  templates: ['template'],
  examples: ['example'],
  diagram: ['diagram', 'flowchart', 'mermaid'],
  scripts: ['script'],
  export: ['export'],
  csv: ['csv'],
  json: ['json'],
  yaml: ['yaml', 'yml'],
  markdown: ['markdown', '.md'],
  pdf: ['pdf'],
  docx: ['docx'],
  pptx: ['pptx', 'slides', 'deck'],
  image: ['image', 'screenshot'],
  video: ['video'],
  audio: ['audio'],
};

function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function hasAnyNeedle(haystack: string, needles: string[]): boolean {
  const normalizedHaystack = normalizeForMatch(haystack);
  return needles.some((needle) => normalizedHaystack.includes(normalizeForMatch(needle)));
}

const ARTIFACT_CONTEXT_HINTS = ['output', 'artifact', 'deliverable', 'generate', 'create', 'produce', 'file', 'document'];
const OUTPUT_EVIDENCE_HINTS = [
  'write',
  'writes',
  'written',
  'create file',
  'generate file',
  'save file',
  'output file',
  'produces',
  'exports',
  'redirect',
  'fs.write',
  'touch ',
  '> ',
];

function enforceArtifactsEvidence(
  artifactsTags: string[],
  artifactsText: string[],
  sourceEvidence: EvidencePack,
): { keptTags: string[]; issues: InvalidTagIssue[]; confidencePenalty: number } {
  if (!artifactsTags.length) {
    return { keptTags: [], issues: [], confidencePenalty: 0 };
  }

  const artifactsCorpus = artifactsText.join('\n');
  const sourceEvidenceCorpus = sourceEvidence.items
    .map((item) => `${item.label}\n${item.content}`)
    .join('\n\n');
  const strictCorpus = `${sourceEvidenceCorpus}\n${artifactsCorpus}`;
  const hasExplicitOutputEvidence = hasAnyNeedle(sourceEvidenceCorpus, OUTPUT_EVIDENCE_HINTS);
  const hasArtifactContext =
    artifactsText.length > 0 ||
    hasAnyNeedle(sourceEvidenceCorpus, ARTIFACT_CONTEXT_HINTS) ||
    hasAnyNeedle(sourceEvidenceCorpus, OUTPUT_EVIDENCE_HINTS);

  const keptTags: string[] = [];
  const issues: InvalidTagIssue[] = [];

  if (!hasExplicitOutputEvidence) {
    for (const tag of artifactsTags) {
      issues.push({
        field: 'artifactsTags',
        rawTag: tag,
        mappedTo: tag,
        reason: 'artifact_evidence_missing',
      });
    }

    return {
      keptTags: [],
      issues,
      confidencePenalty: Math.min(0.2, artifactsTags.length * 0.05),
    };
  }

  for (const tag of artifactsTags) {
    const hints = ARTIFACT_TAG_EVIDENCE_HINTS[tag] ?? [tag.replace(/-/g, ' ')];
    const supportedStrict = hasAnyNeedle(strictCorpus, hints);
    const supportedFallback = !supportedStrict && isArtifactInterfaceTag(tag) && hasArtifactContext;

    if (supportedStrict || supportedFallback) {
      keptTags.push(tag);
    } else {
      issues.push({
        field: 'artifactsTags',
        rawTag: tag,
        mappedTo: tag,
        reason: 'artifact_evidence_missing',
      });
    }
  }

  const droppedCount = artifactsTags.length - keptTags.length;
  const confidencePenalty = droppedCount > 0 ? Math.min(0.15, droppedCount * 0.04) : 0;

  return {
    keptTags,
    issues,
    confidencePenalty,
  };
}

export async function extractSemantics(
  facts: Facts,
  evidence: EvidencePack,
  options: { deep?: boolean } = {},
): Promise<Semantics> {
  const deep = options.deep ?? false;

  try {
    const llm = getLlmClient();
    const parsed = (await llm.generateSemantics(createPrompt(facts, evidence, deep), SEMANTICS_JSON_SCHEMA)) as Partial<
      Semantics
    > & {
      stage?: string;
      categoryId?: string;
      confidenceBasis?: string;
      inputs?: string[];
      artifacts?: string[];
      capabilities?: string[];
    };

    const humanReadable = {
      inputsText: normalizeTextList(parsed.humanReadable?.inputsText ?? parsed.inputs),
      artifactsText: normalizeTextList(parsed.humanReadable?.artifactsText ?? parsed.artifacts),
      capabilitiesText: normalizeTextList(parsed.humanReadable?.capabilitiesText ?? parsed.capabilities),
    };

    const directMachineTags = sanitizeMachineTags(parsed.machineTags ?? {});
    const fallbackFromHuman = sanitizeMachineTags({
      inputsTags: humanReadable.inputsText,
      artifactsTags: humanReadable.artifactsText,
      capabilitiesTags: humanReadable.capabilitiesText,
    });

    const mergedMachineTags = mergeMachineTags(directMachineTags.machineTags, fallbackFromHuman.machineTags);
    const artifactEvidence = enforceArtifactsEvidence(
      mergedMachineTags.artifactsTags,
      humanReadable.artifactsText,
      evidence,
    );

    const machineTags: MachineTagSemantics = {
      ...mergedMachineTags,
      artifactsTags: artifactEvidence.keptTags,
    };
    const invalidTagIssues = [
      ...directMachineTags.invalidTagIssues,
      ...fallbackFromHuman.invalidTagIssues,
      ...artifactEvidence.issues,
    ];
    const baseConfidence = Math.max(0, Math.min(1, Number(parsed.confidence || 0)));
    const confidence = Math.max(0, baseConfidence - artifactEvidence.confidencePenalty);

    return {
      oneLiner: parsed.oneLiner?.trim() || 'No summary',
      stage: sanitizeStage(parsed.stage || 'other'),
      humanReadable,
      machineTags,
      prerequisites: normalizeTextList(parsed.prerequisites, 10),
      constraints: normalizeTextList(parsed.constraints, 10),
      sideEffects: normalizeTextList(parsed.sideEffects, 10),
      categoryId: sanitizeCategory(parsed.categoryId || 'general'),
      confidence,
      confidenceBasis: sanitizeConfidenceBasis(parsed.confidenceBasis || 'llm'),
      evidence: Array.isArray(parsed.evidence) ? parsed.evidence.slice(0, 12) : [],
      invalidTagIssues,
    };
  } catch (error) {
    console.warn('Semantics extraction failed:', error);
    return fallbackSemantics(facts);
  }
}

export function shouldEscalateSemantics(semantics: Semantics): boolean {
  if (semantics.confidence < 0.55) return true;
  if (!semantics.stage || semantics.stage === 'other') return true;
  if (semantics.machineTags.inputsTags.length === 0 && semantics.humanReadable.inputsText.length === 0) return true;
  if (
    semantics.machineTags.artifactsTags.length === 0 &&
    semantics.machineTags.capabilitiesTags.length === 0 &&
    semantics.humanReadable.artifactsText.length === 0 &&
    semantics.humanReadable.capabilitiesText.length === 0
  ) {
    return true;
  }
  if (semantics.evidence.length < 2) return true;
  return false;
}
