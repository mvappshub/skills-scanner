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
  via: string[];
}

export interface SkillGraph {
  edges: SkillGraphEdge[];
  adjacency: Record<string, string[]>;
  relatedBySkill: Record<string, string[]>;
  chains: string[][];
}

export interface SkillRecord {
  id: string;
  skillId: string;
  repoId: string;
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
