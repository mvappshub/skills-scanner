import React, { useEffect, useMemo, useRef, useState } from 'react';
import Sidebar from './components/Sidebar';
import UploadArea from './components/UploadArea';
import Dashboard from './components/Dashboard';
import SkillList from './components/SkillList';
import SkillDetailPanel from './components/SkillDetailPanel';
import WorkflowPanel from './components/WorkflowPanel';
import { AnalyzeProgress, CacheStats, PendingReason, ScanStats, SkillRecord } from './types';
import { buildSkillGraph } from './utils/graphBuilder';
import { applySemantics, clearSemantics, scanFiles } from './utils/scannerLogic';
import { runPass1, runPass2 } from './utils/aiLogic';
import {
  buildCacheStats,
  clearHeavyFieldsInCache,
  clearOldRuns,
  cacheRowToSkillRecord,
  exportCacheSnapshot,
  getCacheHealthSnapshot,
  getLibrarySkillRows,
  getSkillRowsByIds,
  importCacheSnapshot,
  listAllSkillRows,
  loadLatestDatasetFromCache,
  putRun,
  saveDatasetSkills,
  saveSingleSkill,
  type CacheHealthSnapshot,
  type SkillCacheRow,
} from './utils/cacheDb';
import { SEMANTICS_LOGIC_VERSION, SEMANTICS_MODEL_ID, SEMANTICS_PROMPT_VERSION } from './utils/semanticsAI';
import { TAG_VOCAB_VERSION } from './utils/tagVocabulary';

interface AnalyzeBatchResult {
  processed: number;
  succeeded: number;
  failed: number;
  updated: SkillRecord[];
}

interface AnalyzeBatchOptions {
  batchSize?: number;
}

type CatalogMode = 'current' | 'catalog';
type ScanMode = 'merge' | 'full_rescan';

function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function makeRunId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `run-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function downloadJson(filename: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function hydrateFromCachedSemantics(freshRecord: SkillRecord, cachedRecord: SkillRecord, cachedRow: SkillCacheRow): SkillRecord {
  if (!cachedRecord.semantics) {
    return clearSemantics(freshRecord);
  }

  const hydrated = applySemantics(freshRecord, cachedRecord.semantics);
  return {
    ...hydrated,
    flags: cachedRecord.flags.length ? cachedRecord.flags : hydrated.flags,
    semanticsStatus: 'ok',
    pendingReason: null,
    analysisStatus: 'done',
    semanticsUpdatedAt: cachedRow.semanticsUpdatedAt,
    lastError: null,
  };
}

function derivePendingReason(freshRecord: SkillRecord, cachedRow: SkillCacheRow): PendingReason {
  const cachedMeta = cachedRow.semanticsMeta;
  const freshMeta = freshRecord.semanticsMeta;

  if (!cachedMeta) return 'skill_changed';
  if (cachedMeta.skillMdHash !== freshMeta.skillMdHash) return 'skill_changed';
  if ((cachedMeta.providerId || 'gemini') !== freshMeta.providerId) return 'model_changed';
  if (cachedMeta.modelId !== freshMeta.modelId) return 'model_changed';
  if (cachedMeta.vocabVersion !== freshMeta.vocabVersion) return 'vocab_changed';
  if (cachedMeta.promptVersion !== freshMeta.promptVersion) return 'prompt_changed';
  if (cachedMeta.logicVersion !== freshMeta.logicVersion) return 'logic_changed';
  return 'skill_changed';
}

function normalizeNameKey(name: string): string {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function contentLookupKey(skillMdHash: string, normalizedName: string): string {
  return `${skillMdHash}::${normalizeNameKey(normalizedName)}`;
}

function normalizePathForMatch(path: string): string {
  return String(path || '')
    .replace(/\\/g, '/')
    .toLowerCase()
    .replace(/\/+/g, '/')
    .replace(/\/$/, '');
}

function rootPathSimilarity(leftPath: string, rightPath: string): number {
  const left = normalizePathForMatch(leftPath).split('/').filter(Boolean);
  const right = normalizePathForMatch(rightPath).split('/').filter(Boolean);
  if (!left.length || !right.length) return 0;

  let commonSuffix = 0;
  while (
    commonSuffix < left.length &&
    commonSuffix < right.length &&
    left[left.length - 1 - commonSuffix] === right[right.length - 1 - commonSuffix]
  ) {
    commonSuffix += 1;
  }

  return commonSuffix / Math.max(left.length, right.length, 1);
}

function scriptCount(facts: SkillRecord['facts']): number {
  return facts.scriptNames.length;
}

function pickIdentityFallbackCandidate(
  fresh: SkillRecord,
  candidates: SkillCacheRow[],
): { row: SkillCacheRow | null; ambiguous: boolean } {
  if (candidates.length === 0) {
    return { row: null, ambiguous: false };
  }

  const freshScripts = scriptCount(fresh.facts);
  const scored = candidates.map((row) => {
    const rowScripts = row.factsJson?.scriptNames?.length ?? 0;
    const scriptsDelta = Math.abs(freshScripts - rowScripts);
    const scriptsScore = scriptsDelta === 0 ? 1 : scriptsDelta <= 1 ? 0.35 : 0;
    const repoScore = row.repoId === fresh.repoId ? 2 : 0;
    const pathScore = rootPathSimilarity(row.rootPath, fresh.rootPath);
    const totalScore = repoScore + scriptsScore + pathScore;

    return {
      row,
      totalScore,
      pathScore,
      repoMatch: row.repoId === fresh.repoId,
    };
  });

  scored.sort((a, b) => b.totalScore - a.totalScore || b.pathScore - a.pathScore || a.row.skillId.localeCompare(b.row.skillId));
  const [best, second] = scored;
  const hasConfidence = best.totalScore >= 2.15 && (best.repoMatch || best.pathScore >= 0.5);
  const clearlyUnique = !second || best.totalScore - second.totalScore >= 0.75;

  if (hasConfidence && clearlyUnique) {
    return { row: best.row, ambiguous: false };
  }

  return { row: null, ambiguous: true };
}

function mergeScannedWithCache(
  scanned: SkillRecord[],
  cachedRows: Map<string, SkillCacheRow>,
  cachedByContent: Map<string, SkillCacheRow[]>,
  globalCachedByContent: Map<string, SkillCacheRow[]>,
): SkillRecord[] {
  return scanned.map((fresh) => {
    const directRow = cachedRows.get(fresh.id);
    const fallbackKey = contentLookupKey(fresh.semanticsMeta.skillMdHash, fresh.facts.canonicalNameNormalized || fresh.name);
    const fallbackCandidates = directRow ? [] : cachedByContent.get(fallbackKey) ?? globalCachedByContent.get(fallbackKey) ?? [];
    const fallbackResolution = directRow ? { row: null, ambiguous: false } : pickIdentityFallbackCandidate(fresh, fallbackCandidates);
    const cachedRow = directRow ?? fallbackResolution.row;

    if (!cachedRow && fallbackResolution.ambiguous) {
      return {
        ...fresh,
        pendingReason: 'ambiguous_identity',
      };
    }

    if (!cachedRow) {
      return {
        ...fresh,
        pendingReason: 'new_skill',
      };
    }

    const cachedRecord = cacheRowToSkillRecord(cachedRow);
    let merged: SkillRecord = {
      ...fresh,
      lastError: cachedRow.lastError,
    };

    if (cachedRow.factsFingerprint === fresh.factsFingerprint) {
      merged = {
        ...merged,
        facts: cachedRecord.facts,
        flags: cachedRecord.flags,
        factsUpdatedAt: cachedRow.factsUpdatedAt,
      };
    }

    if (cachedRow.semanticsFingerprint !== fresh.semanticsFingerprint) {
      return clearSemantics(merged, null, derivePendingReason(fresh, cachedRow));
    }

    if (cachedRow.semanticsStatus === 'ok' && cachedRecord.semantics) {
      return hydrateFromCachedSemantics(merged, cachedRecord, cachedRow);
    }

    if (cachedRow.semanticsStatus === 'error') {
      return {
        ...clearSemantics(merged, cachedRow.lastError || 'Previous analysis failed'),
        semanticsStatus: 'error',
        pendingReason: cachedRow.pendingReason,
        analysisStatus: 'failed',
        semanticsUpdatedAt: cachedRow.semanticsUpdatedAt,
      };
    }

    return {
      ...clearSemantics(merged, null, cachedRow.pendingReason ?? 'skill_changed'),
      semanticsStatus: 'pending',
      semanticsUpdatedAt: cachedRow.semanticsUpdatedAt,
      lastError: null,
    };
  });
}

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<'upload' | 'dashboard' | 'list' | 'workflow'>('upload');
  const [currentScanSkills, setCurrentScanSkills] = useState<SkillRecord[]>([]);
  const [catalogSkills, setCatalogSkills] = useState<SkillRecord[]>([]);
  const [catalogMode, setCatalogMode] = useState<CatalogMode>('current');
  const [selectedLibraryId, setSelectedLibraryId] = useState<string>('all');
  const [selectedDatasetLabel, setSelectedDatasetLabel] = useState<string>('all');
  const [datasetLabel, setDatasetLabel] = useState<string | null>(null);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [scanMode, setScanMode] = useState<ScanMode>('merge');
  const [isScanning, setIsScanning] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<AnalyzeProgress | null>(null);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [cacheHealth, setCacheHealth] = useState<CacheHealthSnapshot | null>(null);

  const currentScanRef = useRef<SkillRecord[]>([]);
  const catalogRef = useRef<SkillRecord[]>([]);

  const updateCurrentScanSkills = (updater: React.SetStateAction<SkillRecord[]>) => {
    setCurrentScanSkills((prev) => {
      const next = typeof updater === 'function' ? (updater as (skills: SkillRecord[]) => SkillRecord[])(prev) : updater;
      currentScanRef.current = next;
      return next;
    });
  };

  const updateCatalogSkills = (updater: React.SetStateAction<SkillRecord[]>) => {
    setCatalogSkills((prev) => {
      const next = typeof updater === 'function' ? (updater as (skills: SkillRecord[]) => SkillRecord[])(prev) : updater;
      catalogRef.current = next;
      return next;
    });
  };

  const replaceSkill = (updatedSkill: SkillRecord) => {
    updateCurrentScanSkills((prev) => prev.map((skill) => (skill.id === updatedSkill.id ? updatedSkill : skill)));
    updateCatalogSkills((prev) => {
      const index = prev.findIndex((skill) => skill.id === updatedSkill.id);
      if (index === -1) return [...prev, updatedSkill];
      const next = [...prev];
      next[index] = updatedSkill;
      return next;
    });
  };

  const getSkillById = (skillId: string): SkillRecord | null => {
    return (
      currentScanRef.current.find((entry) => entry.id === skillId) ??
      catalogRef.current.find((entry) => entry.id === skillId) ??
      null
    );
  };

  const refreshCatalogSkills = async () => {
    const allRows = await listAllSkillRows();
    const allSkills = allRows.map(cacheRowToSkillRecord);
    updateCatalogSkills(allSkills);
  };

  const refreshCacheHealth = async () => {
    const snapshot = await getCacheHealthSnapshot();
    setCacheHealth(snapshot);
  };

  useEffect(() => {
    currentScanRef.current = currentScanSkills;
  }, [currentScanSkills]);

  useEffect(() => {
    catalogRef.current = catalogSkills;
  }, [catalogSkills]);

  useEffect(() => {
    let cancelled = false;

    const restore = async () => {
      try {
        const { run, skills } = await loadLatestDatasetFromCache();
        if (cancelled) return;

        updateCurrentScanSkills(skills);
        await Promise.all([refreshCatalogSkills(), refreshCacheHealth()]);

        if (skills.length > 0) {
          setDatasetLabel(run?.datasetLabel ?? skills[0].datasetLabel ?? null);
          setSelectedLibraryId(skills[0].libraryId || 'all');
          setSelectedDatasetLabel(run?.datasetLabel ?? skills[0].datasetLabel ?? 'all');
          setCurrentView('dashboard');
        }

        setLastRunAt(run?.startedAt ?? null);
      } catch (error) {
        console.warn('Failed to restore cached dataset:', error);
      }
    };

    restore();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredCatalogSkills = useMemo(() => {
    return catalogSkills.filter((skill) => {
      if (selectedLibraryId !== 'all' && skill.libraryId !== selectedLibraryId) return false;
      if (selectedDatasetLabel !== 'all' && skill.datasetLabel !== selectedDatasetLabel) return false;
      return true;
    });
  }, [catalogSkills, selectedLibraryId, selectedDatasetLabel]);

  const displayedSkills = useMemo(
    () => (catalogMode === 'catalog' ? filteredCatalogSkills : currentScanSkills),
    [catalogMode, filteredCatalogSkills, currentScanSkills],
  );

  useEffect(() => {
    if (!selectedSkillId) return;
    if (!displayedSkills.some((skill) => skill.id === selectedSkillId)) {
      setSelectedSkillId(null);
    }
  }, [displayedSkills, selectedSkillId]);

  const analyzeSkillIds = async (
    skillIds: string[],
    phase: 'pass1' | 'pass2',
    options: AnalyzeBatchOptions = {},
  ): Promise<AnalyzeBatchResult> => {
    const uniqueIds = Array.from(new Set(skillIds.filter(Boolean)));
    if (!uniqueIds.length) {
      return { processed: 0, succeeded: 0, failed: 0, updated: [] };
    }

    const total = uniqueIds.length;
    const batchSize = options.batchSize ?? 12;
    const updated: SkillRecord[] = [];
    let failed = 0;
    let current = 0;

    setAnalysisProgress({ current, total, phase });

    for (const group of chunk(uniqueIds, batchSize)) {
      for (const skillId of group) {
        const source = getSkillById(skillId);
        if (!source) {
          current += 1;
          setAnalysisProgress({ current, total, phase });
          continue;
        }

        replaceSkill({ ...source, analysisStatus: 'analyzing' });

        try {
          const analyzed = phase === 'pass1' ? await runPass1(source) : await runPass2(source);
          const persisted: SkillRecord = {
            ...analyzed,
            libraryId: source.libraryId,
            sourceRootLabel: source.sourceRootLabel,
            datasetLabel: source.datasetLabel || source.libraryId || source.repoId,
            semanticsStatus: 'ok',
            pendingReason: null,
            semanticsUpdatedAt: analyzed.semanticsUpdatedAt || new Date().toISOString(),
            lastError: null,
          };

          replaceSkill(persisted);
          await saveSingleSkill(persisted);
          updated.push(persisted);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Analysis failed';
          const failedRecord: SkillRecord = {
            ...clearSemantics(source, errorMessage),
            libraryId: source.libraryId,
            sourceRootLabel: source.sourceRootLabel,
            datasetLabel: source.datasetLabel || source.libraryId || source.repoId,
            semanticsStatus: 'error',
            semanticsUpdatedAt: new Date().toISOString(),
            lastError: errorMessage,
          };

          replaceSkill(failedRecord);
          await saveSingleSkill(failedRecord);
          updated.push(failedRecord);
          failed += 1;
          console.warn(`Analysis failed for ${source.id}`, error);
        }

        current += 1;
        setAnalysisProgress({ current, total, phase });
      }
    }

    setAnalysisProgress(null);

    return {
      processed: uniqueIds.length,
      succeeded: uniqueIds.length - failed,
      failed,
      updated,
    };
  };

  const runSingleAnalysis = async (id: string, phase: 'pass1' | 'pass2') => {
    await analyzeSkillIds([id], phase, { batchSize: 1 });
  };

  const runPendingAnalysis = async (phase: 'pass1' | 'pass2') => {
    const pendingIds = displayedSkills
      .filter((skill) => skill.semanticsStatus !== 'ok')
      .map((skill) => skill.id);
    if (!pendingIds.length) return;
    await analyzeSkillIds(pendingIds, phase, { batchSize: phase === 'pass1' ? 12 : 10 });
  };

  const handleScan = async (files: FileList) => {
    setIsScanning(true);
    setAnalysisProgress(null);
    setSelectedSkillId(null);

    try {
      const scanned = await scanFiles(files);
      if (scanned.length === 0) {
        alert('No SKILL.md/skill.md files found.');
        return;
      }

      const nextLibraryId = scanned[0]?.libraryId || selectedLibraryId || 'default-library';
      const nextDatasetLabel = scanned[0]?.sourceRootLabel || nextLibraryId;
      const [directCachedById, cachedLibraryRows, allCachedRows] = await Promise.all([
        getSkillRowsByIds(scanned.map((skill) => skill.id)),
        getLibrarySkillRows(nextLibraryId),
        listAllSkillRows(),
      ]);
      const cachedByContent = new Map<string, SkillCacheRow[]>();
      const globalCachedByContent = new Map<string, SkillCacheRow[]>();

      for (const row of cachedLibraryRows) {
        const normalizedName = row.factsJson.canonicalNameNormalized || normalizeNameKey(row.name || row.factsJson.canonicalName);
        const key = contentLookupKey(row.semanticsMeta.skillMdHash, normalizedName);
        const libraryBucket = cachedByContent.get(key) || [];
        libraryBucket.push(row);
        cachedByContent.set(key, libraryBucket);

        const globalBucket = globalCachedByContent.get(key) || [];
        globalBucket.push(row);
        globalCachedByContent.set(key, globalBucket);
      }

      for (const row of allCachedRows) {
        const normalizedName = row.factsJson.canonicalNameNormalized || normalizeNameKey(row.name || row.factsJson.canonicalName);
        const key = contentLookupKey(row.semanticsMeta.skillMdHash, normalizedName);
        const bucket = globalCachedByContent.get(key) || [];
        if (!bucket.some((entry) => entry.skillId === row.skillId)) {
          bucket.push(row);
        }
        globalCachedByContent.set(key, bucket);
      }

      const merged = mergeScannedWithCache(scanned, directCachedById, cachedByContent, globalCachedByContent).map((skill) => ({
        ...skill,
        libraryId: nextLibraryId,
        sourceRootLabel: scanned[0]?.sourceRootLabel || nextDatasetLabel,
        datasetLabel: nextDatasetLabel,
      }));

      const runStartedAt = new Date().toISOString();
      await saveDatasetSkills(nextLibraryId, nextDatasetLabel, merged, {
        prune: scanMode === 'full_rescan',
      });
      await putRun({
        runId: makeRunId(),
        startedAt: runStartedAt,
        datasetLabel: nextDatasetLabel,
        promptVersion: SEMANTICS_PROMPT_VERSION,
        vocabVersion: TAG_VOCAB_VERSION,
        modelId: SEMANTICS_MODEL_ID,
        semanticsLogicVersion: SEMANTICS_LOGIC_VERSION,
      });

      updateCurrentScanSkills(merged);
      await Promise.all([refreshCatalogSkills(), refreshCacheHealth()]);
      setCatalogMode('current');
      setSelectedLibraryId(nextLibraryId);
      setSelectedDatasetLabel(nextDatasetLabel);
      setDatasetLabel(nextDatasetLabel);
      setLastRunAt(runStartedAt);
      setCurrentView('dashboard');

    } catch (error) {
      console.error('Scanning failed:', error);
      alert('Scanning failed. See console for details.');
    } finally {
      setIsScanning(false);
    }
  };

  const handleExportCache = async () => {
    try {
      const payload = await exportCacheSnapshot();
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      downloadJson(`skills-cache-${stamp}.json`, payload);
    } catch (error) {
      console.error('Cache export failed:', error);
      alert('Cache export failed. See console for details.');
    }
  };

  const refreshFromLatestDataset = async () => {
    const { run, skills } = await loadLatestDatasetFromCache();
    updateCurrentScanSkills(skills);
    await Promise.all([refreshCatalogSkills(), refreshCacheHealth()]);
    setDatasetLabel(run?.datasetLabel ?? skills[0]?.datasetLabel ?? null);
    setLastRunAt(run?.startedAt ?? null);

    if (skills.length > 0) {
      setSelectedLibraryId(skills[0].libraryId || 'all');
      setSelectedDatasetLabel(run?.datasetLabel ?? skills[0].datasetLabel ?? 'all');
      setCurrentView('dashboard');
    }
  };

  const handleImportCache = async (file: File) => {
    try {
      const text = await file.text();
      const payload = JSON.parse(text) as unknown;
      const result = await importCacheSnapshot(payload);
      await refreshFromLatestDataset();
      alert(
        `Cache imported: ${result.importedSkills} skills, ${result.importedRuns} runs, ${result.importedTemplates} templates, ${result.importedWorkflowFeedback} feedback entries.`,
      );
    } catch (error) {
      console.error('Cache import failed:', error);
      alert('Cache import failed. Ensure JSON matches exported cache format.');
    }
  };

  const handleClearHeavyFields = async () => {
    try {
      const result = await clearHeavyFieldsInCache();
      await refreshFromLatestDataset();
      alert(`Cleared heavy fields for ${result.updatedSkills} cached skills.`);
    } catch (error) {
      console.error('Clearing heavy fields failed:', error);
      alert('Clearing heavy fields failed. See console for details.');
    }
  };

  const handleClearOldRuns = async () => {
    try {
      const result = await clearOldRuns(30);
      await refreshFromLatestDataset();
      alert(`Removed ${result.removedRuns} old runs. Kept ${result.keptRuns} latest runs.`);
    } catch (error) {
      console.error('Clearing old runs failed:', error);
      alert('Clearing old runs failed. See console for details.');
    }
  };

  const handleRetryErrors = async (skillIds: string[]) => {
    if (!skillIds.length) return;
    await analyzeSkillIds(skillIds, 'pass1', { batchSize: 12 });
  };

  const stats: ScanStats = useMemo(() => {
    const base: ScanStats = {
      total: displayedSkills.length,
      scriptsCount: 0,
      mcpCount: 0,
      byStage: {},
      byRisk: { safe: 0, warning: 0, danger: 0 },
      flaggedCount: 0,
      flagCounts: {},
    };

    for (const skill of displayedSkills) {
      if (skill.requires.scripts) base.scriptsCount += 1;
      if (skill.requires.mcp) base.mcpCount += 1;
      base.byStage[skill.stage] = (base.byStage[skill.stage] || 0) + 1;
      base.byRisk[skill.riskLevel] += 1;
      if (skill.flags.length > 0) {
        base.flaggedCount += 1;
        for (const flag of skill.flags) {
          base.flagCounts[flag.code] = (base.flagCounts[flag.code] || 0) + 1;
        }
      }
    }

    return base;
  }, [displayedSkills]);

  const graph = useMemo(
    () => buildSkillGraph(displayedSkills.filter((skill) => skill.semanticsStatus === 'ok')),
    [displayedSkills],
  );

  const workflowSkills = useMemo(() => {
    if (displayedSkills.some((skill) => skill.semanticsStatus === 'ok')) {
      return displayedSkills;
    }

    if (filteredCatalogSkills.some((skill) => skill.semanticsStatus === 'ok')) {
      return filteredCatalogSkills;
    }

    if (catalogSkills.some((skill) => skill.semanticsStatus === 'ok')) {
      return catalogSkills;
    }

    return displayedSkills;
  }, [displayedSkills, filteredCatalogSkills, catalogSkills]);

  const workflowGraph = useMemo(
    () => buildSkillGraph(workflowSkills.filter((skill) => skill.semanticsStatus === 'ok')),
    [workflowSkills],
  );

  const skillsWithGraph = useMemo(
    () =>
      displayedSkills.map((skill) => ({
        ...skill,
        relatedSkills: graph.relatedBySkill[skill.id] ?? [],
      })),
    [displayedSkills, graph.relatedBySkill],
  );

  const workflowSkillsWithGraph = useMemo(
    () =>
      workflowSkills.map((skill) => ({
        ...skill,
        relatedSkills: workflowGraph.relatedBySkill[skill.id] ?? [],
      })),
    [workflowSkills, workflowGraph.relatedBySkill],
  );

  const selectedSkill = useMemo(
    () => skillsWithGraph.find((skill) => skill.id === selectedSkillId) ?? null,
    [skillsWithGraph, selectedSkillId],
  );

  const cacheStats: CacheStats = useMemo(
    () => buildCacheStats(catalogSkills, lastRunAt, datasetLabel, cacheHealth || undefined),
    [catalogSkills, lastRunAt, datasetLabel, cacheHealth],
  );

  const availableLibraries = useMemo(() => {
    return Array.from(new Set(catalogSkills.map((skill) => skill.libraryId).filter(Boolean))).sort();
  }, [catalogSkills]);

  const availableDatasets = useMemo(() => {
    const pool = selectedLibraryId === 'all'
      ? catalogSkills
      : catalogSkills.filter((skill) => skill.libraryId === selectedLibraryId);
    return Array.from(new Set(pool.map((skill) => skill.datasetLabel).filter(Boolean))).sort();
  }, [catalogSkills, selectedLibraryId]);

  const handleChangeView = (view: 'upload' | 'dashboard' | 'list' | 'workflow') => {
    setCurrentView(view);
    if (view !== 'list') {
      setSelectedSkillId(null);
    }
  };

  return (
    <div className="flex h-screen w-full bg-claude-bg text-claude-text font-sans antialiased overflow-hidden selection:bg-claude-accent/20">
      <Sidebar
        currentView={currentView}
        onChangeView={(view) => handleChangeView(view as 'upload' | 'dashboard' | 'list' | 'workflow')}
        skillCount={displayedSkills.length}
        analysisProgress={analysisProgress}
        cacheStats={cacheStats}
        scanMode={scanMode}
        onRunPass1={() => runPendingAnalysis('pass1')}
        onRunPass2={() => runPendingAnalysis('pass2')}
        onExportCache={handleExportCache}
        onImportCache={handleImportCache}
        onClearHeavyFields={handleClearHeavyFields}
        onClearOldRuns={handleClearOldRuns}
      />

      <main className="flex-1 h-full overflow-hidden relative flex flex-col">
        {currentView === 'upload' && (
          <UploadArea
            onScan={handleScan}
            isScanning={isScanning}
            scanMode={scanMode}
            onScanModeChange={setScanMode}
          />
        )}

        {currentView === 'dashboard' && (
          <div className="h-full overflow-y-auto">
            <Dashboard stats={stats} graph={graph} />
          </div>
        )}

        {currentView === 'list' && (
          <SkillList
            skills={skillsWithGraph}
            graph={graph}
            onSelectSkill={(skill) => setSelectedSkillId(skill.id)}
            onAnalyzeSkill={(id) => runSingleAnalysis(id, 'pass1')}
            onRetryErrors={handleRetryErrors}
            isAnalysisRunning={Boolean(analysisProgress)}
            catalogMode={catalogMode}
            onCatalogModeChange={(mode) => setCatalogMode(mode)}
            selectedLibraryId={selectedLibraryId}
            onSelectedLibraryIdChange={(value) => {
              setSelectedLibraryId(value);
              setSelectedDatasetLabel('all');
            }}
            selectedDatasetLabel={selectedDatasetLabel}
            onSelectedDatasetLabelChange={setSelectedDatasetLabel}
            availableLibraries={availableLibraries}
            availableDatasets={availableDatasets}
          />
        )}

        {currentView === 'workflow' && (
          <WorkflowPanel
            skills={workflowSkillsWithGraph}
            graph={workflowGraph}
            analysisProgress={analysisProgress}
            onAnalyzeSkillIds={(ids, phase, options) => analyzeSkillIds(ids, phase, options)}
          />
        )}
      </main>

      {selectedSkill && (
        <SkillDetailPanel
          skill={selectedSkill}
          onClose={() => setSelectedSkillId(null)}
          onAnalyze={() => runSingleAnalysis(selectedSkill.id, 'pass1')}
          onDeepAnalyze={() => runSingleAnalysis(selectedSkill.id, 'pass2')}
        />
      )}
    </div>
  );
};

export default App;
