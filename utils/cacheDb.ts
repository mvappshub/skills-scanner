import { DBSchema, openDB } from 'idb';
import { confidenceLevel, categoryLabel } from './taxonomy';
import {
  CacheStats,
  PendingReason,
  SkillRecord,
  Semantics,
  SemanticsStatus,
  SemanticsVersionMeta,
  WorkflowPlan,
  WorkflowFeedbackCandidateType,
  WorkflowFeedbackRecord,
  WorkflowTemplateRecord,
} from '../types';
import { SEMANTICS_LOGIC_VERSION, SEMANTICS_MODEL_ID, SEMANTICS_PROMPT_VERSION } from './semanticsAI';
import { TAG_VOCAB_VERSION } from './tagVocabulary';

const DB_NAME = 'skills-scanner-cache';
const DB_VERSION = 5;
const SKILLS_STORE = 'skills';
const RUNS_STORE = 'runs';
const TEMPLATES_STORE = 'templates';
const FEEDBACK_STORE = 'workflow_feedback';
const MIN_WARNING_THRESHOLD_BYTES = 200 * 1024 * 1024;
const MAX_WARNING_THRESHOLD_BYTES = 500 * 1024 * 1024;
const DEFAULT_WARNING_THRESHOLD_BYTES = 300 * 1024 * 1024;

const SENSITIVE_KEY_PATTERN = /(api[_-]?key|token|secret|password|credential|private[_-]?key)/i;
const INLINE_SECRET_PATTERN = /((api[_-]?key|token|secret|password)\s*[:=]\s*)([^,\s;]+)/gi;

export interface SkillCacheRow {
  skillId: string;
  libraryId: string;
  sourceRootLabel: string;
  datasetLabel: string;
  repoId: string;
  rootPath: string;
  name: string;
  factsJson: SkillRecord['facts'];
  factsFingerprint: string;
  factsUpdatedAt: string;
  semanticsJson: Semantics | null;
  semanticsMeta: SemanticsVersionMeta;
  semanticsFingerprint: string;
  semanticsUpdatedAt: string | null;
  semanticsStatus: SemanticsStatus;
  pendingReason: PendingReason | null;
  flagsJson: SkillRecord['flags'];
  lastError: string | null;
  recordJson?: SkillRecord;
  updatedAt: string;
}

export interface RunCacheRow {
  runId: string;
  startedAt: string;
  datasetLabel: string;
  promptVersion: string;
  vocabVersion: string;
  modelId: string;
  semanticsLogicVersion: string;
}

export interface WorkflowTemplateRow {
  templateId: string;
  name: string;
  description: string;
  workflowType: string;
  stack: string;
  constraints: string;
  planJson: WorkflowPlan;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowFeedbackRow {
  feedbackId: string;
  skillId: string;
  stepId: string;
  stepStage: string;
  expectedTags: string[];
  matchedTags: string[];
  rating: 1 | -1;
  candidateType: WorkflowFeedbackCandidateType;
  createdAt: string;
}

export interface CacheHealthSnapshot {
  estimatedBytes: number;
  estimatedMegabytes: number;
  warningThresholdBytes: number;
  warningLevel: 'ok' | 'warning' | 'danger';
  runCount: number;
}

interface SkillsScannerDB extends DBSchema {
  [SKILLS_STORE]: {
    key: string;
    value: SkillCacheRow;
    indexes: {
      'by-library': string;
      'by-dataset': string;
      'by-updatedAt': string;
    };
  };
  [RUNS_STORE]: {
    key: string;
    value: RunCacheRow;
    indexes: {
      'by-startedAt': string;
      'by-dataset': string;
    };
  };
  [TEMPLATES_STORE]: {
    key: string;
    value: WorkflowTemplateRow;
    indexes: {
      'by-updatedAt': string;
      'by-name': string;
    };
  };
  [FEEDBACK_STORE]: {
    key: string;
    value: WorkflowFeedbackRow;
    indexes: {
      'by-createdAt': string;
      'by-skillId': string;
      'by-stepStage': string;
    };
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function defaultSemanticsMeta(skillMdHash = ''): SemanticsVersionMeta {
  return {
    modelId: SEMANTICS_MODEL_ID,
    promptVersion: SEMANTICS_PROMPT_VERSION,
    vocabVersion: TAG_VOCAB_VERSION,
    logicVersion: SEMANTICS_LOGIC_VERSION,
    skillMdHash,
  };
}

function normalizeSemanticsStatus(value: unknown): SemanticsStatus {
  if (value === 'ok' || value === 'pending' || value === 'error') return value;
  return 'pending';
}

function normalizePendingReason(value: unknown, status: SemanticsStatus): PendingReason | null {
  if (
    value === 'new_skill' ||
    value === 'skill_changed' ||
    value === 'model_changed' ||
    value === 'vocab_changed' ||
    value === 'prompt_changed' ||
    value === 'logic_changed' ||
    value === 'recovery_after_error' ||
    value === 'ambiguous_identity'
  ) {
    return value;
  }
  if (status === 'pending') return 'skill_changed';
  return null;
}

function redactSensitiveText(value: string): string {
  return value.replace(INLINE_SECRET_PATTERN, (_match, prefix) => `${prefix}[REDACTED]`);
}

function sanitizeFrontmatterForExport(frontmatter: SkillRecord['facts']['frontmatter']): SkillRecord['facts']['frontmatter'] {
  const metadata = frontmatter.metadata || {};
  const safeMetadata: Record<string, string | string[]> = {};

  for (const [key, rawValue] of Object.entries(metadata)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      safeMetadata[key] = '[REDACTED]';
      continue;
    }

    if (Array.isArray(rawValue)) {
      safeMetadata[key] = rawValue.map((entry) => redactSensitiveText(String(entry)));
    } else {
      safeMetadata[key] = redactSensitiveText(String(rawValue));
    }
  }

  return {
    ...frontmatter,
    description: frontmatter.description ? redactSensitiveText(frontmatter.description) : frontmatter.description,
    metadata: safeMetadata,
  };
}

function stripHeavyFields(record: SkillRecord): SkillRecord {
  return {
    ...record,
    rawSkillContent: '',
    evidencePack: {
      bundleId: record.evidencePack.bundleId,
      items: [],
      asText: '',
    },
  };
}

function stripSemanticsEvidence(semantics: Semantics | null): Semantics | null {
  if (!semantics) return null;
  return {
    ...semantics,
    evidence: [],
  };
}

function inferAnalysisStatus(semanticsStatus: SemanticsStatus, semantics: Semantics | null): SkillRecord['analysisStatus'] {
  if (semanticsStatus === 'error') return 'failed';
  if (semanticsStatus === 'ok' && semantics) return 'done';
  return 'not_analyzed';
}

function normalizeRow(raw: Partial<SkillCacheRow>): SkillCacheRow {
  const semanticsStatus = normalizeSemanticsStatus(raw.semanticsStatus);
  const semanticsMeta = raw.semanticsMeta || defaultSemanticsMeta();

  return {
    skillId: String(raw.skillId || ''),
    libraryId: String(raw.libraryId || raw.repoId || ''),
    sourceRootLabel: String(raw.sourceRootLabel || raw.libraryId || raw.repoId || ''),
    datasetLabel: String(raw.datasetLabel || raw.sourceRootLabel || raw.libraryId || raw.repoId || ''),
    repoId: String(raw.repoId || ''),
    rootPath: String(raw.rootPath || ''),
    name: String(raw.name || ''),
    factsJson: raw.factsJson as SkillRecord['facts'],
    factsFingerprint: String(raw.factsFingerprint || ''),
    factsUpdatedAt: String(raw.factsUpdatedAt || nowIso()),
    semanticsJson: (raw.semanticsJson as Semantics | null) ?? null,
    semanticsMeta,
    semanticsFingerprint: String(raw.semanticsFingerprint || ''),
    semanticsUpdatedAt: raw.semanticsUpdatedAt || null,
    semanticsStatus,
    pendingReason: normalizePendingReason(raw.pendingReason, semanticsStatus),
    flagsJson: (raw.flagsJson as SkillRecord['flags']) ?? [],
    lastError: raw.lastError || null,
    recordJson: raw.recordJson ? stripHeavyFields(raw.recordJson) : undefined,
    updatedAt: String(raw.updatedAt || nowIso()),
  };
}

function normalizeRunRow(raw: Partial<RunCacheRow>): RunCacheRow {
  return {
    runId: String(raw.runId || ''),
    startedAt: String(raw.startedAt || nowIso()),
    datasetLabel: String(raw.datasetLabel || ''),
    promptVersion: String(raw.promptVersion || SEMANTICS_PROMPT_VERSION),
    vocabVersion: String(raw.vocabVersion || TAG_VOCAB_VERSION),
    modelId: String(raw.modelId || SEMANTICS_MODEL_ID),
    semanticsLogicVersion: String(raw.semanticsLogicVersion || SEMANTICS_LOGIC_VERSION),
  };
}

function normalizeTemplateRow(raw: Partial<WorkflowTemplateRow>): WorkflowTemplateRow {
  return {
    templateId: String(raw.templateId || ''),
    name: String(raw.name || 'Untitled template'),
    description: String(raw.description || ''),
    workflowType: String(raw.workflowType || ''),
    stack: String(raw.stack || ''),
    constraints: String(raw.constraints || ''),
    planJson: (raw.planJson || { name: 'Untitled workflow', steps: [] }) as WorkflowPlan,
    createdAt: String(raw.createdAt || nowIso()),
    updatedAt: String(raw.updatedAt || nowIso()),
  };
}

function normalizeWorkflowFeedbackRow(raw: Partial<WorkflowFeedbackRow>): WorkflowFeedbackRow {
  const normalizedRating = raw.rating === -1 ? -1 : 1;
  const candidateType: WorkflowFeedbackCandidateType = raw.candidateType === 'alternative' ? 'alternative' : 'selected';

  return {
    feedbackId: String(raw.feedbackId || ''),
    skillId: String(raw.skillId || ''),
    stepId: String(raw.stepId || ''),
    stepStage: String(raw.stepStage || 'other'),
    expectedTags: Array.isArray(raw.expectedTags) ? raw.expectedTags.map((entry) => String(entry)) : [],
    matchedTags: Array.isArray(raw.matchedTags) ? raw.matchedTags.map((entry) => String(entry)) : [],
    rating: normalizedRating,
    candidateType,
    createdAt: String(raw.createdAt || nowIso()),
  };
}

function workflowFeedbackRowToRecord(row: WorkflowFeedbackRow): WorkflowFeedbackRecord {
  const normalized = normalizeWorkflowFeedbackRow(row);
  return {
    feedbackId: normalized.feedbackId,
    skillId: normalized.skillId,
    stepId: normalized.stepId,
    stepStage: normalized.stepStage as WorkflowFeedbackRecord['stepStage'],
    expectedTags: normalized.expectedTags,
    matchedTags: normalized.matchedTags,
    rating: normalized.rating,
    candidateType: normalized.candidateType,
    createdAt: normalized.createdAt,
  };
}

function templateRowToRecord(row: WorkflowTemplateRow): WorkflowTemplateRecord {
  const normalized = normalizeTemplateRow(row);
  return {
    templateId: normalized.templateId,
    name: normalized.name,
    description: normalized.description,
    workflowType: normalized.workflowType,
    stack: normalized.stack,
    constraints: normalized.constraints,
    plan: normalized.planJson,
    createdAt: normalized.createdAt,
    updatedAt: normalized.updatedAt,
  };
}

function templateRecordToRow(record: WorkflowTemplateRecord): WorkflowTemplateRow {
  const timestamp = nowIso();
  return normalizeTemplateRow({
    templateId: record.templateId,
    name: record.name,
    description: record.description,
    workflowType: record.workflowType,
    stack: record.stack,
    constraints: record.constraints,
    planJson: record.plan,
    createdAt: record.createdAt || timestamp,
    updatedAt: record.updatedAt || timestamp,
  });
}

function fallbackRecordFromRow(row: SkillCacheRow): SkillRecord {
  const semantics = row.semanticsJson;
  const stage = semantics?.stage ?? (row.factsJson.riskLevel === 'danger' ? 'security' : 'other');
  const categoryId = semantics?.categoryId ?? 'general';
  const confidence = semantics?.confidence ?? 0.35;
  const basis = semantics?.confidenceBasis ?? 'rules';

  return {
    id: row.skillId,
    skillId: row.skillId,
    repoId: row.repoId,
    libraryId: row.libraryId || row.repoId,
    sourceRootLabel: row.sourceRootLabel || row.libraryId || row.repoId,
    datasetLabel: row.datasetLabel,
    name: row.name || row.factsJson.canonicalName,
    oneLiner: semantics?.oneLiner || row.factsJson.frontmatter.description || row.factsJson.canonicalName || 'No semantic summary yet',
    categoryId,
    categoryLabel: categoryLabel(categoryId),
    categoryConfidence: confidence,
    confidenceLevel: confidenceLevel(confidence),
    confidenceBasis: basis,
    stage,
    inputs: semantics?.humanReadable.inputsText ?? [],
    artifacts: semantics?.humanReadable.artifactsText ?? [],
    capabilities: semantics?.humanReadable.capabilitiesText ?? [],
    inputsTags: semantics?.machineTags.inputsTags ?? [],
    artifactsTags: semantics?.machineTags.artifactsTags ?? [],
    capabilitiesTags: semantics?.machineTags.capabilitiesTags ?? [],
    prerequisites: semantics?.prerequisites ?? row.factsJson.frontmatter.compatibility ?? [],
    constraints: semantics?.constraints ?? row.factsJson.frontmatter.allowedTools ?? [],
    requires: row.factsJson.requires,
    duplicateNameCount: 1,
    missingReferencedFiles: [],
    outsideRootReferencedFiles: [],
    flags: row.flagsJson ?? [],
    riskLevel: row.factsJson.riskLevel,
    rootPath: row.rootPath,
    relatedSkills: [],
    facts: row.factsJson,
    evidencePack: {
      bundleId: row.factsJson.bundleId,
      items: [],
      asText: '',
    },
    semantics,
    semanticsMeta: row.semanticsMeta || defaultSemanticsMeta(),
    semanticsStatus: row.semanticsStatus,
    pendingReason: row.pendingReason,
    factsFingerprint: row.factsFingerprint,
    semanticsFingerprint: row.semanticsFingerprint,
    factsUpdatedAt: row.factsUpdatedAt,
    semanticsUpdatedAt: row.semanticsUpdatedAt,
    lastError: row.lastError,
    rawSkillContent: '',
    analysisStatus: inferAnalysisStatus(row.semanticsStatus, semantics),
  };
}

export function cacheRowToSkillRecord(row: SkillCacheRow): SkillRecord {
  if (!row.recordJson) {
    return fallbackRecordFromRow(row);
  }

  return {
    ...stripHeavyFields(row.recordJson),
    id: row.skillId,
    skillId: row.skillId,
    libraryId: row.libraryId || row.recordJson.libraryId || row.repoId,
    sourceRootLabel: row.sourceRootLabel || row.recordJson.sourceRootLabel || row.libraryId || row.repoId,
    datasetLabel: row.datasetLabel,
    repoId: row.repoId || row.recordJson.repoId,
    rootPath: row.rootPath || row.recordJson.rootPath,
    name: row.name || row.recordJson.name,
    facts: row.factsJson,
    factsFingerprint: row.factsFingerprint,
    factsUpdatedAt: row.factsUpdatedAt,
    semantics: row.semanticsJson,
    semanticsMeta: row.semanticsMeta || row.recordJson.semanticsMeta || defaultSemanticsMeta(),
    semanticsFingerprint: row.semanticsFingerprint,
    semanticsUpdatedAt: row.semanticsUpdatedAt,
    semanticsStatus: row.semanticsStatus,
    pendingReason: row.pendingReason,
    flags: row.flagsJson || row.recordJson.flags,
    lastError: row.lastError,
    relatedSkills: [],
    analysisStatus: inferAnalysisStatus(row.semanticsStatus, row.semanticsJson),
  };
}

export function skillRecordToCacheRow(record: SkillRecord): SkillCacheRow {
  const updatedAt = nowIso();
  const compactRecord = stripHeavyFields(record);
  return {
    skillId: record.id,
    libraryId: record.libraryId || record.repoId,
    sourceRootLabel: record.sourceRootLabel || record.libraryId || record.repoId,
    datasetLabel: record.datasetLabel || record.repoId,
    repoId: record.repoId,
    rootPath: record.rootPath,
    name: record.name,
    factsJson: record.facts,
    factsFingerprint: record.factsFingerprint,
    factsUpdatedAt: record.factsUpdatedAt || updatedAt,
    semanticsJson: record.semantics,
    semanticsMeta: record.semanticsMeta || defaultSemanticsMeta(),
    semanticsFingerprint: record.semanticsFingerprint,
    semanticsUpdatedAt: record.semanticsUpdatedAt,
    semanticsStatus: record.semanticsStatus,
    pendingReason: record.pendingReason,
    flagsJson: record.flags,
    lastError: record.lastError,
    recordJson: compactRecord,
    updatedAt,
  };
}

async function getDb() {
  return openDB<SkillsScannerDB>(DB_NAME, DB_VERSION, {
    async upgrade(db, oldVersion, _newVersion, transaction) {
      if (!db.objectStoreNames.contains(SKILLS_STORE)) {
        const skillsStore = db.createObjectStore(SKILLS_STORE, { keyPath: 'skillId' });
        skillsStore.createIndex('by-library', 'libraryId');
        skillsStore.createIndex('by-dataset', 'datasetLabel');
        skillsStore.createIndex('by-updatedAt', 'updatedAt');
      } else {
        const skillsStore = transaction?.objectStore(SKILLS_STORE);
        if (skillsStore && !skillsStore.indexNames.contains('by-library')) {
          skillsStore.createIndex('by-library', 'libraryId');
        }
      }

      if (!db.objectStoreNames.contains(RUNS_STORE)) {
        const runsStore = db.createObjectStore(RUNS_STORE, { keyPath: 'runId' });
        runsStore.createIndex('by-startedAt', 'startedAt');
        runsStore.createIndex('by-dataset', 'datasetLabel');
      }

      if (!db.objectStoreNames.contains(TEMPLATES_STORE)) {
        const templatesStore = db.createObjectStore(TEMPLATES_STORE, { keyPath: 'templateId' });
        templatesStore.createIndex('by-updatedAt', 'updatedAt');
        templatesStore.createIndex('by-name', 'name');
      } else {
        const templatesStore = transaction?.objectStore(TEMPLATES_STORE);
        if (templatesStore && !templatesStore.indexNames.contains('by-updatedAt')) {
          templatesStore.createIndex('by-updatedAt', 'updatedAt');
        }
        if (templatesStore && !templatesStore.indexNames.contains('by-name')) {
          templatesStore.createIndex('by-name', 'name');
        }
      }

      if (!db.objectStoreNames.contains(FEEDBACK_STORE)) {
        const feedbackStore = db.createObjectStore(FEEDBACK_STORE, { keyPath: 'feedbackId' });
        feedbackStore.createIndex('by-createdAt', 'createdAt');
        feedbackStore.createIndex('by-skillId', 'skillId');
        feedbackStore.createIndex('by-stepStage', 'stepStage');
      } else {
        const feedbackStore = transaction?.objectStore(FEEDBACK_STORE);
        if (feedbackStore && !feedbackStore.indexNames.contains('by-createdAt')) {
          feedbackStore.createIndex('by-createdAt', 'createdAt');
        }
        if (feedbackStore && !feedbackStore.indexNames.contains('by-skillId')) {
          feedbackStore.createIndex('by-skillId', 'skillId');
        }
        if (feedbackStore && !feedbackStore.indexNames.contains('by-stepStage')) {
          feedbackStore.createIndex('by-stepStage', 'stepStage');
        }
      }

      if (!transaction) return;

      if (oldVersion < 3) {
        const skillsStore = transaction.objectStore(SKILLS_STORE);
        let skillCursor = await skillsStore.openCursor();
        while (skillCursor) {
          const normalized = normalizeRow(skillCursor.value as Partial<SkillCacheRow>);
          await skillCursor.update(normalized);
          skillCursor = await skillCursor.continue();
        }

        const runsStore = transaction.objectStore(RUNS_STORE);
        let runCursor = await runsStore.openCursor();
        while (runCursor) {
          const normalizedRun = normalizeRunRow(runCursor.value as Partial<RunCacheRow>);
          await runCursor.update(normalizedRun);
          runCursor = await runCursor.continue();
        }
      }

      if (oldVersion < 4 && db.objectStoreNames.contains(TEMPLATES_STORE)) {
        const templatesStore = transaction.objectStore(TEMPLATES_STORE);
        let templateCursor = await templatesStore.openCursor();
        while (templateCursor) {
          const normalizedTemplate = normalizeTemplateRow(templateCursor.value as Partial<WorkflowTemplateRow>);
          await templateCursor.update(normalizedTemplate);
          templateCursor = await templateCursor.continue();
        }
      }

      if (oldVersion < 5 && db.objectStoreNames.contains(FEEDBACK_STORE)) {
        const feedbackStore = transaction.objectStore(FEEDBACK_STORE);
        let feedbackCursor = await feedbackStore.openCursor();
        while (feedbackCursor) {
          const normalizedFeedback = normalizeWorkflowFeedbackRow(feedbackCursor.value as Partial<WorkflowFeedbackRow>);
          await feedbackCursor.update(normalizedFeedback);
          feedbackCursor = await feedbackCursor.continue();
        }
      }
    },
  });
}

export async function getSkillRowsByIds(skillIds: string[]): Promise<Map<string, SkillCacheRow>> {
  const db = await getDb();
  const tx = db.transaction(SKILLS_STORE, 'readonly');
  const store = tx.objectStore(SKILLS_STORE);
  const rows = await Promise.all(skillIds.map((id) => store.get(id)));
  await tx.done;

  const mapped = new Map<string, SkillCacheRow>();
  for (const row of rows) {
    if (!row) continue;
    const normalized = normalizeRow(row as Partial<SkillCacheRow>);
    mapped.set(normalized.skillId, normalized);
  }
  return mapped;
}

export async function putRun(row: RunCacheRow): Promise<void> {
  const db = await getDb();
  await db.put(RUNS_STORE, normalizeRunRow(row));
}

export async function listWorkflowTemplates(): Promise<WorkflowTemplateRecord[]> {
  const db = await getDb();
  const tx = db.transaction(TEMPLATES_STORE, 'readonly');
  const rows = await tx.objectStore(TEMPLATES_STORE).index('by-updatedAt').getAll();
  await tx.done;
  return rows
    .map((row) => templateRowToRecord(row as WorkflowTemplateRow))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function saveWorkflowTemplate(template: WorkflowTemplateRecord): Promise<void> {
  const db = await getDb();
  const normalized = templateRecordToRow({
    ...template,
    updatedAt: nowIso(),
    createdAt: template.createdAt || nowIso(),
  });
  await db.put(TEMPLATES_STORE, normalized);
}

export async function deleteWorkflowTemplate(templateId: string): Promise<void> {
  const db = await getDb();
  await db.delete(TEMPLATES_STORE, templateId);
}

export async function addWorkflowFeedback(entry: Omit<WorkflowFeedbackRecord, 'feedbackId' | 'createdAt'>): Promise<WorkflowFeedbackRecord> {
  const feedbackId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `feedback-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

  const row = normalizeWorkflowFeedbackRow({
    feedbackId,
    skillId: entry.skillId,
    stepId: entry.stepId,
    stepStage: entry.stepStage,
    expectedTags: entry.expectedTags,
    matchedTags: entry.matchedTags,
    rating: entry.rating,
    candidateType: entry.candidateType,
    createdAt: nowIso(),
  });

  const db = await getDb();
  await db.put(FEEDBACK_STORE, row);
  return workflowFeedbackRowToRecord(row);
}

export async function listWorkflowFeedback(limit = 3000): Promise<WorkflowFeedbackRecord[]> {
  const db = await getDb();
  const tx = db.transaction(FEEDBACK_STORE, 'readonly');
  const rows = await tx.objectStore(FEEDBACK_STORE).index('by-createdAt').getAll();
  await tx.done;

  return rows
    .map((row) => workflowFeedbackRowToRecord(row as WorkflowFeedbackRow))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, Math.max(0, limit));
}

export async function exportWorkflowTemplatesSnapshot(): Promise<{
  version: string;
  exportedAt: string;
  templates: WorkflowTemplateRow[];
}> {
  const db = await getDb();
  const tx = db.transaction(TEMPLATES_STORE, 'readonly');
  const templates = await tx.objectStore(TEMPLATES_STORE).getAll();
  await tx.done;

  return {
    version: '1',
    exportedAt: nowIso(),
    templates: templates.map((row) => normalizeTemplateRow(row as Partial<WorkflowTemplateRow>)),
  };
}

export async function importWorkflowTemplatesSnapshot(payload: unknown): Promise<{ importedTemplates: number }> {
  if (!isObject(payload)) {
    throw new Error('Invalid templates payload: expected object');
  }

  const rawTemplates = Array.isArray(payload.templates) ? payload.templates : [];
  const db = await getDb();
  const tx = db.transaction(TEMPLATES_STORE, 'readwrite');
  let importedTemplates = 0;

  for (const entry of rawTemplates) {
    if (!isObject(entry)) continue;
    const row = normalizeTemplateRow(entry as Partial<WorkflowTemplateRow>);
    if (!row.templateId) continue;
    await tx.objectStore(TEMPLATES_STORE).put(row);
    importedTemplates += 1;
  }

  await tx.done;
  return { importedTemplates };
}

export async function getLatestRun(): Promise<RunCacheRow | null> {
  const db = await getDb();
  const tx = db.transaction(RUNS_STORE, 'readonly');
  const store = tx.objectStore(RUNS_STORE).index('by-startedAt');
  const cursor = await store.openCursor(null, 'prev');
  await tx.done;
  return cursor?.value ? normalizeRunRow(cursor.value as Partial<RunCacheRow>) : null;
}

export async function getDatasetSkillRows(datasetLabel: string): Promise<SkillCacheRow[]> {
  const db = await getDb();
  const tx = db.transaction(SKILLS_STORE, 'readonly');
  const rows = await tx.objectStore(SKILLS_STORE).index('by-dataset').getAll(datasetLabel);
  await tx.done;
  return rows.map((row) => normalizeRow(row as Partial<SkillCacheRow>));
}

export async function getLibrarySkillRows(libraryId: string): Promise<SkillCacheRow[]> {
  const db = await getDb();
  const tx = db.transaction(SKILLS_STORE, 'readonly');
  const rows = await tx.objectStore(SKILLS_STORE).index('by-library').getAll(libraryId);
  await tx.done;
  return rows.map((row) => normalizeRow(row as Partial<SkillCacheRow>));
}

export async function listAllSkillRows(): Promise<SkillCacheRow[]> {
  const db = await getDb();
  const tx = db.transaction(SKILLS_STORE, 'readonly');
  const rows = await tx.objectStore(SKILLS_STORE).getAll();
  await tx.done;
  return rows.map((row) => normalizeRow(row as Partial<SkillCacheRow>));
}

export async function saveDatasetSkills(
  libraryId: string,
  datasetLabel: string,
  records: SkillRecord[],
  options: { prune?: boolean } = {},
): Promise<void> {
  const prune = options.prune ?? false;
  const rows = records.map((record) =>
    skillRecordToCacheRow({
      ...record,
      libraryId,
      datasetLabel,
    }),
  );

  const db = await getDb();
  const tx = db.transaction(SKILLS_STORE, 'readwrite');
  const store = tx.objectStore(SKILLS_STORE);
  const keepIds = new Set(rows.map((row) => row.skillId));

  for (const row of rows) {
    await store.put(row);
  }

  if (prune) {
    const existingKeys = await store.index('by-library').getAllKeys(libraryId);
    for (const key of existingKeys) {
      const skillId = String(key);
      if (!keepIds.has(skillId)) {
        await store.delete(skillId);
      }
    }
  }

  await tx.done;
}

export async function saveSingleSkill(record: SkillRecord): Promise<void> {
  const db = await getDb();
  await db.put(SKILLS_STORE, skillRecordToCacheRow(record));
}

export async function loadLatestDatasetFromCache(): Promise<{ run: RunCacheRow | null; skills: SkillRecord[] }> {
  const run = await getLatestRun();
  if (!run) {
    const db = await getDb();
    const tx = db.transaction(SKILLS_STORE, 'readonly');
    const latestSkillCursor = await tx.objectStore(SKILLS_STORE).index('by-updatedAt').openCursor(null, 'prev');
    await tx.done;

    if (!latestSkillCursor?.value?.datasetLabel) {
      return { run: null, skills: [] };
    }

    const fallbackRows = await getDatasetSkillRows(latestSkillCursor.value.datasetLabel);
    return {
      run: null,
      skills: fallbackRows.map(cacheRowToSkillRecord),
    };
  }

  const rows = await getDatasetSkillRows(run.datasetLabel);
  return {
    run,
    skills: rows.map(cacheRowToSkillRecord),
  };
}

function estimateSerializedBytes(value: unknown): number {
  try {
    const payload = JSON.stringify(value);
    return new TextEncoder().encode(payload).length;
  } catch {
    return 0;
  }
}

async function resolveWarningThresholdBytes(): Promise<number> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate();
      if (estimate.quota && Number.isFinite(estimate.quota)) {
        const suggested = Math.round(estimate.quota * 0.4);
        return Math.min(MAX_WARNING_THRESHOLD_BYTES, Math.max(MIN_WARNING_THRESHOLD_BYTES, suggested));
      }
    }
  } catch (error) {
    console.warn('Failed to read browser storage estimate:', error);
  }

  return DEFAULT_WARNING_THRESHOLD_BYTES;
}

export async function getCacheHealthSnapshot(): Promise<CacheHealthSnapshot> {
  const db = await getDb();
  const tx = db.transaction([SKILLS_STORE, RUNS_STORE, TEMPLATES_STORE, FEEDBACK_STORE], 'readonly');
  const skills = await tx.objectStore(SKILLS_STORE).getAll();
  const runs = await tx.objectStore(RUNS_STORE).getAll();
  const templates = await tx.objectStore(TEMPLATES_STORE).getAll();
  const feedback = await tx.objectStore(FEEDBACK_STORE).getAll();
  await tx.done;

  const estimatedBytes =
    skills.reduce((sum, row) => sum + estimateSerializedBytes(row), 0) +
    runs.reduce((sum, row) => sum + estimateSerializedBytes(row), 0) +
    templates.reduce((sum, row) => sum + estimateSerializedBytes(row), 0) +
    feedback.reduce((sum, row) => sum + estimateSerializedBytes(row), 0);
  const warningThresholdBytes = await resolveWarningThresholdBytes();
  const ratio = warningThresholdBytes > 0 ? estimatedBytes / warningThresholdBytes : 0;

  return {
    estimatedBytes,
    estimatedMegabytes: estimatedBytes / (1024 * 1024),
    warningThresholdBytes,
    warningLevel: ratio >= 1 ? 'danger' : ratio >= 0.75 ? 'warning' : 'ok',
    runCount: runs.length,
  };
}

function sanitizeSkillRowForExport(row: SkillCacheRow): SkillCacheRow {
  const sanitizedFacts = {
    ...row.factsJson,
    frontmatter: sanitizeFrontmatterForExport(row.factsJson.frontmatter),
  };

  const sanitizedRecord = row.recordJson
    ? {
        ...stripHeavyFields(row.recordJson),
        facts: sanitizedFacts,
      }
    : undefined;

  return {
    ...row,
    factsJson: sanitizedFacts,
    recordJson: sanitizedRecord,
  };
}

export async function exportCacheSnapshot(): Promise<{
  version: string;
  exportedAt: string;
  skills: SkillCacheRow[];
  runs: RunCacheRow[];
  templates: WorkflowTemplateRow[];
  workflowFeedback: WorkflowFeedbackRow[];
}> {
  const db = await getDb();
  const tx = db.transaction([SKILLS_STORE, RUNS_STORE, TEMPLATES_STORE, FEEDBACK_STORE], 'readonly');
  const skills = await tx.objectStore(SKILLS_STORE).getAll();
  const runs = await tx.objectStore(RUNS_STORE).getAll();
  const templates = await tx.objectStore(TEMPLATES_STORE).getAll();
  const workflowFeedback = await tx.objectStore(FEEDBACK_STORE).getAll();
  await tx.done;

  return {
    version: '5',
    exportedAt: nowIso(),
    skills: skills
      .map((row) => normalizeRow(row as Partial<SkillCacheRow>))
      .map((row) => sanitizeSkillRowForExport(row)),
    runs: runs.map((row) => normalizeRunRow(row as Partial<RunCacheRow>)),
    templates: templates.map((row) => normalizeTemplateRow(row as Partial<WorkflowTemplateRow>)),
    workflowFeedback: workflowFeedback.map((row) => normalizeWorkflowFeedbackRow(row as Partial<WorkflowFeedbackRow>)),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export async function importCacheSnapshot(payload: unknown): Promise<{
  importedSkills: number;
  importedRuns: number;
  importedTemplates: number;
  importedWorkflowFeedback: number;
}> {
  if (!isObject(payload)) {
    throw new Error('Invalid cache payload: expected object');
  }

  const rawSkills = Array.isArray(payload.skills) ? payload.skills : [];
  const rawRuns = Array.isArray(payload.runs) ? payload.runs : [];
  const rawTemplates = Array.isArray(payload.templates) ? payload.templates : [];
  const rawWorkflowFeedback = Array.isArray(payload.workflowFeedback) ? payload.workflowFeedback : [];

  const db = await getDb();
  const tx = db.transaction([SKILLS_STORE, RUNS_STORE, TEMPLATES_STORE, FEEDBACK_STORE], 'readwrite');
  let importedSkills = 0;
  let importedRuns = 0;
  let importedTemplates = 0;
  let importedWorkflowFeedback = 0;

  for (const entry of rawSkills) {
    if (!isObject(entry)) continue;
    const row = normalizeRow(entry as Partial<SkillCacheRow>);
    if (!row.skillId) continue;
    await tx.objectStore(SKILLS_STORE).put(row);
    importedSkills += 1;
  }

  for (const entry of rawRuns) {
    if (!isObject(entry)) continue;
    const row = normalizeRunRow(entry as Partial<RunCacheRow>);
    if (!row.runId) continue;
    await tx.objectStore(RUNS_STORE).put(row);
    importedRuns += 1;
  }

  for (const entry of rawTemplates) {
    if (!isObject(entry)) continue;
    const row = normalizeTemplateRow(entry as Partial<WorkflowTemplateRow>);
    if (!row.templateId) continue;
    await tx.objectStore(TEMPLATES_STORE).put(row);
    importedTemplates += 1;
  }

  for (const entry of rawWorkflowFeedback) {
    if (!isObject(entry)) continue;
    const row = normalizeWorkflowFeedbackRow(entry as Partial<WorkflowFeedbackRow>);
    if (!row.feedbackId || !row.skillId) continue;
    await tx.objectStore(FEEDBACK_STORE).put(row);
    importedWorkflowFeedback += 1;
  }

  await tx.done;
  return { importedSkills, importedRuns, importedTemplates, importedWorkflowFeedback };
}

export async function clearHeavyFieldsInCache(): Promise<{ updatedSkills: number }> {
  const db = await getDb();
  const tx = db.transaction(SKILLS_STORE, 'readwrite');
  const store = tx.objectStore(SKILLS_STORE);
  let cursor = await store.openCursor();
  let updatedSkills = 0;

  while (cursor) {
    const row = normalizeRow(cursor.value as Partial<SkillCacheRow>);
    const compactSemantics = stripSemanticsEvidence(row.semanticsJson);
    const compactRecord = row.recordJson
      ? stripHeavyFields({
          ...row.recordJson,
          semantics: stripSemanticsEvidence(row.recordJson.semantics),
        })
      : undefined;

    const nextRow: SkillCacheRow = {
      ...row,
      semanticsJson: compactSemantics,
      recordJson: compactRecord,
      updatedAt: nowIso(),
    };

    await cursor.update(nextRow);
    updatedSkills += 1;
    cursor = await cursor.continue();
  }

  await tx.done;
  return { updatedSkills };
}

export async function clearOldRuns(keepLatest = 30): Promise<{ removedRuns: number; keptRuns: number }> {
  const safeKeep = Math.max(0, Math.floor(keepLatest));
  const db = await getDb();
  const tx = db.transaction(RUNS_STORE, 'readwrite');
  const index = tx.objectStore(RUNS_STORE).index('by-startedAt');
  const keys = (await index.getAllKeys()) as string[];
  const toDelete = Math.max(0, keys.length - safeKeep);
  let removedRuns = 0;

  for (let i = 0; i < toDelete; i += 1) {
    const key = String(keys[i]);
    await tx.objectStore(RUNS_STORE).delete(key);
    removedRuns += 1;
  }

  await tx.done;
  return { removedRuns, keptRuns: keys.length - removedRuns };
}

export function buildCacheStats(
  skills: SkillRecord[],
  lastRunAt: string | null,
  datasetLabel: string | null,
  health?: Partial<CacheHealthSnapshot>,
): CacheStats {
  const totalSkills = skills.length;
  const cachedSemanticsCount = skills.filter((skill) => skill.semanticsStatus === 'ok').length;
  const pendingSemanticsCount = skills.filter((skill) => skill.semanticsStatus !== 'ok').length;

  return {
    datasetLabel,
    totalSkills,
    cachedSemanticsCount,
    pendingSemanticsCount,
    lastRunAt,
    estimatedBytes: health?.estimatedBytes || 0,
    estimatedMegabytes: health?.estimatedMegabytes || 0,
    warningThresholdBytes: health?.warningThresholdBytes || DEFAULT_WARNING_THRESHOLD_BYTES,
    warningLevel: health?.warningLevel || 'ok',
    runCount: health?.runCount || 0,
  };
}
