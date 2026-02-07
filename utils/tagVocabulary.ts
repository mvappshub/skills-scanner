import { InvalidTagIssue, MachineTagSemantics } from '../types';

export const TAG_VOCAB: readonly string[] = [
  'requirements',
  'planning',
  'workflow',
  'tasks',
  'automation',
  'integration',
  'api',
  'rest',
  'graphql',
  'webhook',
  'auth',
  'oauth',
  'security',
  'privacy',
  'compliance',
  'risk',
  'audit',
  'tests',
  'debugging',
  'refactor',
  'performance',
  'monitoring',
  'observability',
  'logging',
  'ci-cd',
  'deploy',
  'docker',
  'kubernetes',
  'serverless',
  'nodejs',
  'typescript',
  'javascript',
  'python',
  'go',
  'rust',
  'java',
  'react',
  'nextjs',
  'frontend',
  'backend',
  'database',
  'sql',
  'nosql',
  'vector-db',
  'rag',
  'llm',
  'prompting',
  'agents',
  'mcp',
  'tooling',
  'cli',
  'scripts',
  'docs',
  'readme',
  'changelog',
  'guides',
  'templates',
  'examples',
  'architecture',
  'diagram',
  'mermaid',
  'ui',
  'ux',
  'design',
  'accessibility',
  'seo',
  'analytics',
  'dashboard',
  'reporting',
  'documents',
  'export',
  'csv',
  'json',
  'yaml',
  'markdown',
  'pdf',
  'docx',
  'pptx',
  'image',
  'video',
  'audio',
  'notebook',
  'notion',
  'slack',
  'discord',
  'telegram',
  'github',
  'jira',
  'file-ops',
  'data-extraction',
  'data-transform',
  'validation',
  'quality',
];

const VOCAB_SET = new Set(TAG_VOCAB);

const SYNONYM_TO_TAG: Record<string, string> = {
  requirement: 'requirements',
  requirements: 'requirements',
  spec: 'requirements',
  specs: 'requirements',
  specification: 'requirements',
  specifications: 'requirements',
  prd: 'requirements',
  roadmap: 'planning',
  planning: 'planning',
  orchestration: 'workflow',
  pipeline: 'workflow',
  pipelines: 'workflow',
  todo: 'tasks',
  todos: 'tasks',
  task: 'tasks',
  automation: 'automation',
  automations: 'automation',
  integrations: 'integration',
  connector: 'integration',
  connectors: 'integration',
  endpoint: 'api',
  endpoints: 'api',
  http: 'rest',
  restapi: 'rest',
  graphql: 'graphql',
  hook: 'webhook',
  webhooks: 'webhook',
  authentication: 'auth',
  authorization: 'auth',
  login: 'auth',
  oauth2: 'oauth',
  sec: 'security',
  privacy: 'privacy',
  gdpr: 'compliance',
  hipaa: 'compliance',
  iso27001: 'compliance',
  test: 'tests',
  testing: 'tests',
  qa: 'tests',
  jest: 'tests',
  vitest: 'tests',
  pytest: 'tests',
  playwright: 'tests',
  cypress: 'tests',
  debug: 'debugging',
  debugging: 'debugging',
  profiling: 'performance',
  metrics: 'monitoring',
  tracing: 'observability',
  logs: 'logging',
  logging: 'logging',
  cicd: 'ci-cd',
  ci: 'ci-cd',
  cd: 'ci-cd',
  deployment: 'deploy',
  deployments: 'deploy',
  vercel: 'deploy',
  netlify: 'deploy',
  container: 'docker',
  containers: 'docker',
  k8s: 'kubernetes',
  lambda: 'serverless',
  cloudfunctions: 'serverless',
  node: 'nodejs',
  'node.js': 'nodejs',
  ts: 'typescript',
  js: 'javascript',
  golang: 'go',
  frontend: 'frontend',
  backend: 'backend',
  postgres: 'sql',
  mysql: 'sql',
  sqlite: 'sql',
  mongo: 'nosql',
  mongodb: 'nosql',
  redis: 'nosql',
  vectordb: 'vector-db',
  embeddings: 'rag',
  rag: 'rag',
  llms: 'llm',
  ai: 'llm',
  prompts: 'prompting',
  prompt: 'prompting',
  agent: 'agents',
  mcpserver: 'mcp',
  mcpservers: 'mcp',
  modelcontextprotocol: 'mcp',
  tools: 'tooling',
  command: 'cli',
  commands: 'cli',
  script: 'scripts',
  scripts: 'scripts',
  documentation: 'docs',
  docs: 'docs',
  readme: 'readme',
  changelog: 'changelog',
  guide: 'guides',
  guides: 'guides',
  template: 'templates',
  templates: 'templates',
  sample: 'examples',
  samples: 'examples',
  example: 'examples',
  diagram: 'diagram',
  diagrams: 'diagram',
  flowchart: 'diagram',
  mermaid: 'mermaid',
  ux: 'ux',
  ui: 'ui',
  a11y: 'accessibility',
  accessibility: 'accessibility',
  search: 'seo',
  analytics: 'analytics',
  chart: 'dashboard',
  charts: 'dashboard',
  dashboard: 'dashboard',
  report: 'reporting',
  reports: 'reporting',
  document: 'documents',
  documents: 'documents',
  doc: 'documents',
  exporting: 'export',
  exports: 'export',
  export: 'export',
  xlsx: 'csv',
  tsv: 'csv',
  json: 'json',
  yml: 'yaml',
  yaml: 'yaml',
  md: 'markdown',
  markdown: 'markdown',
  pdf: 'pdf',
  word: 'docx',
  docx: 'docx',
  powerpoint: 'pptx',
  ppt: 'pptx',
  slides: 'pptx',
  pptx: 'pptx',
  image: 'image',
  images: 'image',
  screenshot: 'image',
  screenshots: 'image',
  video: 'video',
  videos: 'video',
  audio: 'audio',
  notebooklm: 'notebook',
  notebook: 'notebook',
  notion: 'notion',
  slack: 'slack',
  discord: 'discord',
  telegram: 'telegram',
  github: 'github',
  jira: 'jira',
  filesystem: 'file-ops',
  files: 'file-ops',
  extraction: 'data-extraction',
  parser: 'data-extraction',
  transform: 'data-transform',
  etl: 'data-transform',
  validate: 'validation',
  validation: 'validation',
  quality: 'quality',
};

const COMPOUND_SYNONYMS: Array<{ phrase: string; tag: string }> = [
  { phrase: 'requirements spec', tag: 'requirements' },
  { phrase: 'spec requirements', tag: 'requirements' },
  { phrase: 'mcp server', tag: 'mcp' },
  { phrase: 'model context protocol', tag: 'mcp' },
  { phrase: 'word document', tag: 'docx' },
  { phrase: 'power point', tag: 'pptx' },
  { phrase: 'powerpoint slides', tag: 'pptx' },
  { phrase: 'slide deck', tag: 'pptx' },
  { phrase: 'test jest', tag: 'tests' },
  { phrase: 'deployment vercel', tag: 'deploy' },
];

function normalizeTagToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_/\\]+/g, ' ')
    .replace(/[^a-z0-9\s-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toCanonicalCandidate(value: string): string {
  return normalizeTagToken(value).replace(/\s+/g, '-');
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i += 1) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j += 1) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i += 1) {
    for (let j = 1; j <= a.length; j += 1) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
      }
    }
  }

  return matrix[b.length][a.length];
}

function closestTagByTokenScore(normalized: string): string | null {
  if (!normalized) return null;
  const tokenParts = normalized.split(' ').filter(Boolean);
  const multiToken = tokenParts.length > 1;
  let bestTag: string | null = null;
  let bestScore = 0;

  for (const tag of TAG_VOCAB) {
    if (multiToken && tag.length <= 3) {
      continue;
    }

    const tagWords = tag.split('-');
    let score = 0;

    if (normalized === tag.replace(/-/g, ' ')) score += 50;
    if (normalized.includes(tag.replace(/-/g, ' '))) score += 8;

    for (const part of tokenParts) {
      if (part === tag) score += 10;
      if (tagWords.includes(part)) score += 6;
      if (part.length > 3 && tag.includes(part)) score += 2;
    }

    if (score > bestScore) {
      bestScore = score;
      bestTag = tag;
    }
  }

  if (bestScore >= 8) return bestTag;

  let levenshteinTag: string | null = null;
  let minDistance = Number.POSITIVE_INFINITY;
  const compact = normalized.replace(/\s+/g, '');
  if (compact.length < 5) return null;

  for (const tag of TAG_VOCAB) {
    if (tag.length <= 3) continue;
    const distance = levenshteinDistance(compact, tag.replace(/-/g, ''));
    if (distance < minDistance) {
      minDistance = distance;
      levenshteinTag = tag;
    }
  }

  if (minDistance <= 2) return levenshteinTag;
  return null;
}

function mapRawTag(rawTag: string): { mapped: string | null; issue: { rawTag: string; mappedTo?: string } | null } {
  const raw = String(rawTag ?? '').trim();
  if (!raw) return { mapped: null, issue: null };

  const canonicalCandidate = toCanonicalCandidate(raw);
  if (VOCAB_SET.has(canonicalCandidate)) {
    return { mapped: canonicalCandidate, issue: null };
  }

  const normalized = normalizeTagToken(raw);
  if (!normalized) {
    return { mapped: null, issue: { rawTag: raw } };
  }

  if (VOCAB_SET.has(normalized)) {
    return { mapped: normalized, issue: null };
  }

  const exactSynonym = SYNONYM_TO_TAG[normalized.replace(/\s+/g, '')] || SYNONYM_TO_TAG[normalized];
  if (exactSynonym) {
    return { mapped: exactSynonym, issue: null };
  }

  for (const { phrase, tag } of COMPOUND_SYNONYMS) {
    if (normalized.includes(phrase)) {
      return { mapped: tag, issue: null };
    }
  }

  const parts = normalized.split(' ').filter(Boolean);
  for (const part of parts) {
    const synonym = SYNONYM_TO_TAG[part];
    if (synonym) {
      return { mapped: synonym, issue: { rawTag: raw, mappedTo: synonym } };
    }
    if (part.length >= 4 && VOCAB_SET.has(part)) {
      return { mapped: part, issue: { rawTag: raw, mappedTo: part } };
    }
  }

  const fuzzyMatch = closestTagByTokenScore(normalized);
  if (fuzzyMatch) {
    return { mapped: fuzzyMatch, issue: { rawTag: raw, mappedTo: fuzzyMatch } };
  }

  return { mapped: null, issue: { rawTag: raw } };
}

function sanitizeTagField(
  rawTags: string[],
  field: keyof MachineTagSemantics,
): { tags: string[]; issues: InvalidTagIssue[] } {
  const result: string[] = [];
  const issues: InvalidTagIssue[] = [];

  for (const candidate of rawTags.slice(0, 24)) {
    const { mapped, issue } = mapRawTag(candidate);
    if (mapped && !result.includes(mapped)) {
      result.push(mapped);
    }
    if (issue) {
      issues.push({
        field,
        rawTag: issue.rawTag,
        mappedTo: issue.mappedTo,
      });
    }
  }

  return {
    tags: result.slice(0, 8),
    issues,
  };
}

export function sanitizeMachineTags(raw: Partial<MachineTagSemantics>): {
  machineTags: MachineTagSemantics;
  invalidTagIssues: InvalidTagIssue[];
} {
  const inputs = sanitizeTagField(raw.inputsTags ?? [], 'inputsTags');
  const artifacts = sanitizeTagField(raw.artifactsTags ?? [], 'artifactsTags');
  const capabilities = sanitizeTagField(raw.capabilitiesTags ?? [], 'capabilitiesTags');

  return {
    machineTags: {
      inputsTags: inputs.tags,
      artifactsTags: artifacts.tags,
      capabilitiesTags: capabilities.tags,
    },
    invalidTagIssues: [...inputs.issues, ...artifacts.issues, ...capabilities.issues],
  };
}

export function tagVocabularyForPrompt(): string {
  return TAG_VOCAB.join(', ');
}
