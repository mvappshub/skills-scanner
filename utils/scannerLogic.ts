import { buildSkillBundles, normalizePath } from './bundleBuilder';
import { buildEvidencePack } from './evidencePackBuilder';
import { extractFacts, normalizeSkillName } from './factsExtractor';
import { extractSemantics, shouldEscalateSemantics } from './semanticsAI';
import { confidenceLevel, categoryLabel, normalizeCategory } from './taxonomy';
import { verifySemantics } from './verifier';
import { CategoryId, ConfidenceBasis, SkillRecord } from '../types';

function inferRepoId(fileList: FileList): string {
  const files = Array.from(fileList);
  const first = files[0]?.webkitRelativePath?.replace(/\\/g, '/') || 'repo';
  const firstSegment = first.split('/')[0] || 'repo';
  return normalizeSkillName(firstSegment || 'repo');
}

function collectGlobalPaths(fileList: FileList): Set<string> {
  return new Set(
    Array.from(fileList).map((file) => normalizePath(file.webkitRelativePath || file.name)),
  );
}

function inferCategoryFromFacts(name: string, description: string): CategoryId {
  return normalizeCategory(`${name} ${description}`);
}

function initialStage(riskLevel: SkillRecord['riskLevel']): SkillRecord['stage'] {
  if (riskLevel === 'danger') return 'security';
  return 'other';
}

function collectBundlePaths(record: {
  factsFilePath: string;
  scripts: string[];
  references: string[];
  assets: string[];
  others: string[];
}): Set<string> {
  return new Set([
    record.factsFilePath,
    ...record.scripts,
    ...record.references,
    ...record.assets,
    ...record.others,
  ]);
}

function resolveRelativePath(baseFilePath: string, relativePath: string): string {
  const normalizedBase = baseFilePath.replace(/\\/g, '/');
  const baseParts = normalizedBase.split('/');
  baseParts.pop();

  const incoming = relativePath.replace(/\\/g, '/').split('/');
  const pathParts = [...baseParts];

  for (const part of incoming) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (pathParts.length > 0) pathParts.pop();
      continue;
    }
    pathParts.push(part);
  }

  return pathParts.join('/');
}

function detectMissingReferences(
  skillContent: string,
  skillFilePath: string,
  bundlePaths: Set<string>,
  globalPaths: Set<string>,
): { missing: string[]; outsideRoot: string[] } {
  const contentWithoutCodeBlocks = skillContent.replace(/```[\s\S]*?```/g, '');
  const matches = contentWithoutCodeBlocks.matchAll(/\[[^\]]+\]\(([^)]+)\)/g);
  const missing = new Set<string>();
  const outsideRoot = new Set<string>();

  for (const match of matches) {
    const target = match[1]?.trim();
    if (!target) continue;
    if (
      target.startsWith('http://') ||
      target.startsWith('https://') ||
      target.startsWith('#') ||
      target.startsWith('mailto:') ||
      target.startsWith('data:')
    ) {
      continue;
    }

    const cleanTarget = normalizePath(target.split('?')[0].split('#')[0]);
    const resolved = cleanTarget.startsWith('/')
      ? cleanTarget.replace(/^\//, '')
      : resolveRelativePath(skillFilePath, cleanTarget);

    if (!globalPaths.has(resolved)) {
      missing.add(cleanTarget);
      continue;
    }

    if (!bundlePaths.has(resolved)) {
      outsideRoot.add(cleanTarget);
    }
  }

  return {
    missing: Array.from(missing),
    outsideRoot: Array.from(outsideRoot),
  };
}

function makeInitialRecord(args: {
  id: string;
  name: string;
  oneLiner: string;
  categoryId: CategoryId;
  confidence: number;
  basis: ConfidenceBasis;
  stage: SkillRecord['stage'];
  rootPath: string;
  facts: SkillRecord['facts'];
  evidencePack: SkillRecord['evidencePack'];
  rawSkillContent: string;
  missingReferencedFiles: string[];
  outsideRootReferencedFiles: string[];
}): SkillRecord {
  return {
    id: args.id,
    skillId: args.id,
    repoId: args.facts.repoId,
    name: args.name,
    oneLiner: args.oneLiner,
    categoryId: args.categoryId,
    categoryLabel: categoryLabel(args.categoryId),
    categoryConfidence: args.confidence,
    confidenceLevel: confidenceLevel(args.confidence),
    confidenceBasis: args.basis,
    stage: args.stage,
    inputs: [],
    artifacts: [],
    capabilities: [],
    inputsTags: [],
    artifactsTags: [],
    capabilitiesTags: [],
    prerequisites: args.facts.frontmatter.compatibility ?? [],
    constraints: args.facts.frontmatter.allowedTools ?? [],
    requires: args.facts.requires,
    duplicateNameCount: 1,
    missingReferencedFiles: args.missingReferencedFiles,
    outsideRootReferencedFiles: args.outsideRootReferencedFiles,
    flags: [],
    riskLevel: args.facts.riskLevel,
    rootPath: args.rootPath,
    relatedSkills: [],
    facts: args.facts,
    evidencePack: args.evidencePack,
    semantics: null,
    rawSkillContent: args.rawSkillContent,
    analysisStatus: 'not_analyzed',
  };
}

export async function scanFiles(fileList: FileList): Promise<SkillRecord[]> {
  const repoId = inferRepoId(fileList);
  const globalPaths = collectGlobalPaths(fileList);
  const scriptsInFileList = Array.from(fileList).filter((file) =>
    normalizePath(file.webkitRelativePath || file.name).toLowerCase().includes('/scripts/'),
  ).length;
  const bundles = buildSkillBundles(fileList);

  console.info('[scanner] scriptsInFileList:', scriptsInFileList);
  console.table(
    bundles.map((bundle) => ({
      root: bundle.rootPath,
      skill: bundle.skillMdFile?.path,
      scripts: bundle.scriptsFiles.length,
      refs: bundle.referencesFiles.length,
      assets: bundle.assetsFiles.length,
      other: bundle.otherFiles.length,
    })),
  );

  const records: SkillRecord[] = [];

  for (const bundle of bundles) {
    const skillContent = await bundle.skillMdFile.file.text();
    const facts = await extractFacts(bundle, skillContent, repoId);
    const evidencePack = buildEvidencePack(bundle.id, skillContent, facts);

    const name = facts.canonicalName;
    const oneLiner = facts.frontmatter.description || 'No semantic summary yet';
    const categoryId = inferCategoryFromFacts(name, oneLiner);

    const availablePaths = collectBundlePaths({
      factsFilePath: facts.filePath,
      scripts: bundle.scriptsFiles.map((file) => file.path),
      references: bundle.referencesFiles.map((file) => file.path),
      assets: bundle.assetsFiles.map((file) => file.path),
      others: bundle.otherFiles.map((file) => file.path),
    });

    const referenceCheck = detectMissingReferences(
      skillContent,
      facts.filePath,
      availablePaths,
      globalPaths,
    );

    records.push(
      makeInitialRecord({
        id: facts.skillId,
        name,
        oneLiner,
        categoryId,
        confidence: 0.45,
        basis: 'rules',
        stage: initialStage(facts.riskLevel),
        rootPath: bundle.rootPath,
        facts,
        evidencePack,
        rawSkillContent: skillContent,
        missingReferencedFiles: referenceCheck.missing,
        outsideRootReferencedFiles: referenceCheck.outsideRoot,
      }),
    );
  }

  const nameCounts = new Map<string, number>();
  for (const record of records) {
    const key = record.facts.canonicalNameNormalized;
    nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
  }

  return records.map((record) => {
    const duplicateCount = nameCounts.get(record.facts.canonicalNameNormalized) || 1;
    return {
      ...record,
      duplicateNameCount: duplicateCount,
      flags: verifySemantics(
        record.facts,
        {
          oneLiner: record.oneLiner,
          stage: record.stage,
          humanReadable: {
            inputsText: record.inputs,
            artifactsText: record.artifacts,
            capabilitiesText: record.capabilities,
          },
          machineTags: {
            inputsTags: record.inputsTags,
            artifactsTags: record.artifactsTags,
            capabilitiesTags: record.capabilitiesTags,
          },
          prerequisites: record.prerequisites,
          constraints: record.constraints,
          sideEffects: [],
          categoryId: record.categoryId,
          confidence: record.categoryConfidence,
          confidenceBasis: record.confidenceBasis,
          evidence: [],
          invalidTagIssues: [],
        },
        {
          duplicateNameCount: duplicateCount,
          missingReferencedFiles: record.missingReferencedFiles,
          outsideRootReferencedFiles: record.outsideRootReferencedFiles,
          skillMdLength: record.rawSkillContent.length,
        },
      ),
    };
  });
}

function applySemantics(record: SkillRecord, semantics: NonNullable<SkillRecord['semantics']>): SkillRecord {
  const flags = verifySemantics(record.facts, semantics, {
    duplicateNameCount: record.duplicateNameCount,
    missingReferencedFiles: record.missingReferencedFiles,
    outsideRootReferencedFiles: record.outsideRootReferencedFiles,
    skillMdLength: record.rawSkillContent.length,
  });

  return {
    ...record,
    semantics,
    oneLiner: semantics.oneLiner,
    categoryId: semantics.categoryId,
    categoryLabel: categoryLabel(semantics.categoryId),
    categoryConfidence: semantics.confidence,
    confidenceBasis: semantics.confidenceBasis,
    confidenceLevel: confidenceLevel(semantics.confidence),
    stage: semantics.stage,
    inputs: semantics.humanReadable.inputsText,
    artifacts: semantics.humanReadable.artifactsText,
    capabilities: semantics.humanReadable.capabilitiesText,
    inputsTags: semantics.machineTags.inputsTags,
    artifactsTags: semantics.machineTags.artifactsTags,
    capabilitiesTags: semantics.machineTags.capabilitiesTags,
    prerequisites: semantics.prerequisites,
    constraints: semantics.constraints,
    flags,
    analysisStatus: semantics.confidence > 0 ? 'done' : 'failed',
  };
}

export async function analyzeSkill(record: SkillRecord, options: { deep?: boolean } = {}): Promise<SkillRecord> {
  const deep = options.deep ?? false;
  let semantics = await extractSemantics(record.facts, record.evidencePack, { deep });

  if (!deep && shouldEscalateSemantics(semantics)) {
    semantics = await extractSemantics(record.facts, record.evidencePack, { deep: true });
  }

  return applySemantics(record, semantics);
}

export async function deepAnalyzeSkill(record: SkillRecord): Promise<SkillRecord> {
  const semantics = await extractSemantics(record.facts, record.evidencePack, { deep: true });
  return applySemantics(record, semantics);
}
