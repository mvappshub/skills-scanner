import { Facts, QualityFlag, Semantics } from '../types';

interface VerifyContext {
  duplicateNameCount: number;
  missingReferencedFiles: string[];
  outsideRootReferencedFiles: string[];
  skillMdLength: number;
}

function hasExecutionVerb(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes('run ') ||
    lower.includes('execute ') ||
    lower.includes('invokes ') ||
    /\bpython\s+\S+/.test(lower) ||
    /\bnpm\s+(run|exec)/.test(lower) ||
    /\bbash\s+\S+/.test(lower) ||
    /\bnode\s+\S+/.test(lower)
  );
}

function hasScriptPathReference(text: string): boolean {
  const lower = text.toLowerCase();
  return /scripts?[\\/][\w.\-/]+/.test(lower);
}

export function verifySemantics(facts: Facts, semantics: Semantics, context: VerifyContext): QualityFlag[] {
  const flags: QualityFlag[] = [];
  const inputs = semantics.humanReadable.inputsText;
  const artifacts = semantics.humanReadable.artifactsText;
  const capabilities = semantics.humanReadable.capabilitiesText;

  if (!facts.frontmatterValidation.hasFrontmatter || !facts.frontmatterValidation.hasName || !facts.frontmatterValidation.hasDescription) {
    flags.push({
      level: 'error',
      code: 'INVALID_FRONTMATTER',
      message: 'Missing frontmatter and/or required name/description fields',
    });
  }

  if (!facts.identityValidation.nameValid) {
    flags.push({
      level: 'error',
      code: 'INVALID_FRONTMATTER',
      field: 'name',
      message: 'Skill name should be lowercase and hyphen-only',
    });
  }

  if (!facts.identityValidation.nameMatchesFolder) {
    flags.push({
      level: 'warning',
      code: 'NAME_FOLDER_MISMATCH',
      field: 'name',
      message: `Name "${facts.canonicalName}" does not match folder "${facts.folderName}"`,
    });
  }

  if (context.duplicateNameCount > 1) {
    flags.push({
      level: 'warning',
      code: 'DUPLICATE_NAME',
      field: 'name',
      message: `Duplicate skill name in repo (${context.duplicateNameCount} occurrences)`,
    });
  }

  for (const missing of context.missingReferencedFiles) {
    flags.push({
      level: 'warning',
      code: 'MISSING_REFERENCED_FILE',
      field: 'references',
      message: `Referenced file not found: ${missing}`,
    });
  }

  for (const outside of context.outsideRootReferencedFiles) {
    flags.push({
      level: 'info',
      code: 'REFERENCED_FILE_OUTSIDE_ROOT',
      field: 'references',
      message: `Referenced file exists outside skill root: ${outside}`,
    });
  }

  if (context.skillMdLength > 18_000) {
    flags.push({
      level: 'info',
      code: 'TOO_LONG_SKILL_MD',
      field: 'content',
      message: `SKILL.md is large (${context.skillMdLength} chars); progressive disclosure recommended`,
    });
  }

  if (semantics.confidence < 0.55) {
    flags.push({
      level: 'warning',
      code: 'LOW_CONFIDENCE',
      field: 'confidence',
      message: `Low confidence (${semantics.confidence.toFixed(2)})`,
    });
  }

  if (!inputs.length && !semantics.machineTags.inputsTags.length) {
    flags.push({ level: 'warning', code: 'MISSING_INPUTS', field: 'inputs', message: 'Semantics missing inputs' });
  }

  if (!artifacts.length && !semantics.machineTags.artifactsTags.length) {
    flags.push({
      level: 'warning',
      code: 'MISSING_ARTIFACTS',
      field: 'artifacts',
      message: 'Semantics missing concrete artifacts',
    });
  }

  if (!capabilities.length && !semantics.machineTags.capabilitiesTags.length) {
    flags.push({
      level: 'warning',
      code: 'MISSING_CAPABILITIES',
      field: 'capabilities',
      message: 'Semantics missing capabilities',
    });
  }

  if (!semantics.stage || semantics.stage === 'other') {
    flags.push({ level: 'warning', code: 'MISSING_STAGE', field: 'stage', message: 'Semantics stage unresolved' });
  }

  const executionClaims = [
    ...capabilities,
    ...semantics.sideEffects,
    ...semantics.constraints,
    ...semantics.prerequisites,
  ];

  const explicitScriptExecutionClaims = executionClaims.filter(
    (entry) => hasExecutionVerb(entry) && hasScriptPathReference(entry),
  );

  if (!facts.hasScripts && explicitScriptExecutionClaims.length > 0) {
    flags.push({
      level: 'error',
      code: 'SCRIPT_CONTRADICTION',
      field: 'requires.scripts',
      message: 'Semantics indicates executable script behavior but deterministic facts found no scripts',
    });
  }

  if (
    !facts.hasScripts &&
    executionClaims.some((entry) => entry.toLowerCase().includes('script')) &&
    explicitScriptExecutionClaims.length === 0
  ) {
    flags.push({
      level: 'warning',
      code: 'SEMANTIC_ALGO_MISMATCH',
      field: 'requires.scripts',
      message: 'Semantic text mentions scripts but no explicit runnable script path was detected',
    });
  }

  if (semantics.invalidTagIssues.length > 0) {
    for (const issue of semantics.invalidTagIssues.slice(0, 5)) {
      const isFieldViolation =
        issue.reason === 'field_not_allowed' || issue.reason === 'artifact_evidence_missing';
      flags.push({
        level: 'warning',
        code: isFieldViolation ? 'INVALID_TAG_FOR_FIELD' : 'INVALID_TAG',
        field: issue.field,
        message:
          issue.reason === 'artifact_evidence_missing'
            ? `Artifact tag "${issue.mappedTo || issue.rawTag}" dropped (no artifacts evidence)`
            : issue.reason === 'field_not_allowed'
              ? `Tag "${issue.mappedTo || issue.rawTag}" not allowed in field "${issue.field}"`
              : issue.mappedTo
                ? `Unknown tag "${issue.rawTag}" normalized to "${issue.mappedTo}"`
                : `Unknown tag "${issue.rawTag}" dropped`,
      });
    }
  }

  const mcpClaims = [
    ...semantics.sideEffects,
    ...semantics.prerequisites,
    ...semantics.constraints,
    ...inputs,
    ...capabilities,
  ];
  const impliesMcp =
    semantics.machineTags.inputsTags.includes('mcp') ||
    semantics.machineTags.capabilitiesTags.includes('mcp') ||
    mcpClaims.some((entry) => entry.toLowerCase().includes('mcp'));
  if (impliesMcp && !facts.requires.mcp) {
    flags.push({
      level: 'warning',
      code: 'MCP_CONTRADICTION',
      field: 'requires.mcp',
      message: 'Semantics references MCP but deterministic signals are missing',
    });
  }

  if (facts.requires.network === false && semantics.constraints.some((entry) => entry.toLowerCase().includes('internet required'))) {
    flags.push({
      level: 'warning',
      code: 'SEMANTIC_ALGO_MISMATCH',
      field: 'requires.network',
      message: 'Semantic constraints claim network dependency that deterministic scan did not find',
    });
  }

  if (facts.riskLevel === 'danger') {
    flags.push({
      level: 'info',
      code: 'DETERMINISTIC_DANGER',
      field: 'risk',
      message: 'Deterministic scan detected destructive risk patterns',
    });
  }

  return flags;
}
