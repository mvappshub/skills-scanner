export type Stage =
  | 'intake'
  | 'plan'
  | 'implement'
  | 'verify'
  | 'refactor'
  | 'security'
  | 'docs'
  | 'release'
  | 'other';

export type RiskLevel = 'safe' | 'warning' | 'danger';
export type SemanticsStatus = 'ok' | 'pending' | 'error';
export type PendingReason =
  | 'new_skill'
  | 'skill_changed'
  | 'model_changed'
  | 'vocab_changed'
  | 'prompt_changed'
  | 'logic_changed'
  | 'recovery_after_error'
  | 'ambiguous_identity';

export type ConfidenceBasis = 'rules' | 'llm' | 'hybrid';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export type CategoryId =
  | 'skill_dev'
  | 'skill_docs'
  | 'workflow_ops'
  | 'agent_config'
  | 'prompt_eng'
  | 'security'
  | 'ml_ops'
  | 'general';

export interface BundleAttachment {
  path: string;
  file: File;
}

export interface SkillBundle {
  id: string;
  rootPath: string;
  skillMdFile: BundleAttachment;
  scriptsFiles: BundleAttachment[];
  referencesFiles: BundleAttachment[];
  assetsFiles: BundleAttachment[];
  otherFiles: BundleAttachment[];
}

export interface FrontmatterData {
  name?: string;
  description?: string;
  compatibility?: string[];
  allowedTools?: string[];
  metadata?: Record<string, string | string[]>;
}

export interface FrontmatterValidation {
  hasFrontmatter: boolean;
  hasName: boolean;
  hasDescription: boolean;
  warnings: string[];
}

export interface IdentityValidation {
  nameValid: boolean;
  nameMatchesFolder: boolean;
}

export interface ScriptSummary {
  path: string;
  kind: string;
  shebang: string | null;
  topCommands: string[];
}

export interface RequiresProfile {
  scripts: boolean;
  mcp: boolean;
  network: boolean;
  tools: string[];
  runtimes: string[];
  secrets: string[];
}

export interface Facts {
  bundleId: string;
  skillId: string;
  repoId: string;
  rootPath: string;
  folderName: string;
  filePath: string;
  canonicalName: string;
  canonicalNameNormalized: string;
  frontmatter: FrontmatterData;
  frontmatterValidation: FrontmatterValidation;
  identityValidation: IdentityValidation;
  hasScripts: boolean;
  scriptNames: string[];
  scriptCommandSummary: ScriptSummary[];
  mcpSignals: string[];
  riskLevel: RiskLevel;
  riskSignals: string[];
  requires: RequiresProfile;
}

export interface EvidenceItem {
  kind: 'intro' | 'heading' | 'code' | 'scripts';
  label: string;
  content: string;
  file: string;
  lineStart: number;
  lineEnd: number;
  snippetHash: string;
}

export interface EvidencePack {
  bundleId: string;
  items: EvidenceItem[];
  asText: string;
}

export interface SemanticsEvidence {
  field: string;
  quote: string;
}

export interface HumanReadableSemantics {
  inputsText: string[];
  artifactsText: string[];
  capabilitiesText: string[];
}

export interface MachineTagSemantics {
  inputsTags: string[];
  artifactsTags: string[];
  capabilitiesTags: string[];
}

export interface InvalidTagIssue {
  field: keyof MachineTagSemantics;
  rawTag: string;
  mappedTo?: string;
  reason?: 'unknown_tag' | 'field_not_allowed' | 'artifact_evidence_missing';
}

export interface Semantics {
  oneLiner: string;
  stage: Stage;
  humanReadable: HumanReadableSemantics;
  machineTags: MachineTagSemantics;
  prerequisites: string[];
  constraints: string[];
  sideEffects: string[];
  categoryId: CategoryId;
  confidence: number;
  confidenceBasis: ConfidenceBasis;
  evidence: SemanticsEvidence[];
  invalidTagIssues: InvalidTagIssue[];
}

export interface SemanticsVersionMeta {
  modelId: string;
  promptVersion: string;
  vocabVersion: string;
  logicVersion: string;
  skillMdHash: string;
}

export interface QualityFlag {
  level: 'info' | 'warning' | 'error';
  code:
    | 'INVALID_FRONTMATTER'
    | 'NAME_FOLDER_MISMATCH'
    | 'DUPLICATE_NAME'
    | 'MISSING_REFERENCED_FILE'
    | 'REFERENCED_FILE_OUTSIDE_ROOT'
    | 'SEMANTIC_ALGO_MISMATCH'
    | 'TOO_LONG_SKILL_MD'
    | 'LOW_CONFIDENCE'
    | 'MISSING_STAGE'
    | 'MISSING_INPUTS'
    | 'MISSING_ARTIFACTS'
    | 'MISSING_CAPABILITIES'
    | 'INVALID_TAG'
    | 'INVALID_TAG_FOR_FIELD'
    | 'MCP_CONTRADICTION'
    | 'SCRIPT_CONTRADICTION'
    | 'DETERMINISTIC_DANGER';
  message: string;
  field?: string;
}

export type EdgeType = 'depends_on' | 'complements' | 'precedes' | 'alternative_to';

export interface SkillGraphEdge {
  from: string;
  to: string;
  type: EdgeType;
  score: number;
  overlapTags: string[];
  via: string[];
}

export interface GraphNodeDegree {
  id: string;
  degree: number;
  inDegree: number;
  outDegree: number;
}

export interface GraphDropReasons {
  stoplist: number;
  spec: number;
  threshold: number;
  topK: number;
  stage: number;
  similarity: number;
  reciprocalDependsOn: number;
}

export interface GraphMetrics {
  edgeCount: number;
  density: number;
  distributionByType: Record<EdgeType, number>;
  topDegreeNodes: GraphNodeDegree[];
  dropReasons: GraphDropReasons;
  threshold: number;
  candidateCount: number;
}

export interface SkillGraph {
  edges: SkillGraphEdge[];
  adjacency: Record<string, string[]>;
  relatedBySkill: Record<string, string[]>;
  chains: string[][];
  metrics: GraphMetrics;
}

export interface WorkflowPlanStep {
  id?: string;
  title?: string;
  stage: Stage;
  inputsTags: string[];
  outputsTags: string[];
  capabilitiesTags?: string[];
}

export interface WorkflowPlan {
  id?: string;
  name?: string;
  steps: WorkflowPlanStep[];
}

export interface WorkflowArchitectInput {
  description: string;
  workflowType: string;
  stack: string;
  constraints: string;
}

export interface WorkflowTemplateRecord {
  templateId: string;
  name: string;
  description: string;
  workflowType: string;
  stack: string;
  constraints: string;
  plan: WorkflowPlan;
  createdAt: string;
  updatedAt: string;
}

export type WorkflowFeedbackCandidateType = 'selected' | 'alternative';

export interface WorkflowFeedbackRecord {
  feedbackId: string;
  skillId: string;
  stepId: string;
  stepStage: Stage;
  expectedTags: string[];
  matchedTags: string[];
  rating: 1 | -1;
  candidateType: WorkflowFeedbackCandidateType;
  createdAt: string;
}

export interface WorkflowSkillCandidate {
  skillId: string;
  name: string;
  stage: Stage;
  score: number;
  confidence: number;
  matchedTags: string[];
  reasoning: string;
}

export interface WorkflowStepAssembly {
  stepId: string;
  title: string;
  stage: Stage;
  selected: WorkflowSkillCandidate | null;
  alternatives: WorkflowSkillCandidate[];
  overlapTags: string[];
  missingCapabilities: string[];
  locked: boolean;
}

export interface SkillWorkflowAssembly {
  selected: WorkflowSkillCandidate[];
  alternatives: Record<string, WorkflowSkillCandidate[]>;
  reasoning: Record<string, string>;
  missingCapabilities: string[];
  steps: WorkflowStepAssembly[];
}

export interface SkillRecord {
  id: string;
  skillId: string;
  repoId: string;
  libraryId: string;
  sourceRootLabel: string;
  datasetLabel: string;
  name: string;
  oneLiner: string;
  categoryId: CategoryId;
  categoryLabel: string;
  categoryConfidence: number;
  confidenceLevel: ConfidenceLevel;
  confidenceBasis: ConfidenceBasis;
  stage: Stage;
  inputs: string[];
  artifacts: string[];
  capabilities: string[];
  inputsTags: string[];
  artifactsTags: string[];
  capabilitiesTags: string[];
  prerequisites: string[];
  constraints: string[];
  requires: RequiresProfile;
  duplicateNameCount: number;
  missingReferencedFiles: string[];
  outsideRootReferencedFiles: string[];
  flags: QualityFlag[];
  riskLevel: RiskLevel;
  rootPath: string;
  relatedSkills: string[];
  facts: Facts;
  evidencePack: EvidencePack;
  semantics: Semantics | null;
  semanticsMeta: SemanticsVersionMeta;
  semanticsStatus: SemanticsStatus;
  pendingReason: PendingReason | null;
  factsFingerprint: string;
  semanticsFingerprint: string;
  factsUpdatedAt: string;
  semanticsUpdatedAt: string | null;
  lastError: string | null;
  rawSkillContent: string;
  analysisStatus: 'not_analyzed' | 'analyzing' | 'done' | 'failed';
}

export interface ScanStats {
  total: number;
  scriptsCount: number;
  mcpCount: number;
  byStage: Record<string, number>;
  byRisk: Record<RiskLevel, number>;
  flaggedCount: number;
  flagCounts: Record<string, number>;
}

export interface AnalyzeProgress {
  current: number;
  total: number;
  phase: 'pass1' | 'pass2';
}

export interface CacheStats {
  datasetLabel: string | null;
  totalSkills: number;
  cachedSemanticsCount: number;
  pendingSemanticsCount: number;
  lastRunAt: string | null;
  estimatedBytes: number;
  estimatedMegabytes: number;
  warningThresholdBytes: number;
  warningLevel: 'ok' | 'warning' | 'danger';
  runCount: number;
}
