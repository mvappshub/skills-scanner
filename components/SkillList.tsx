import React, { useMemo, useState } from 'react';
import { AlertCircle, Download, Search, Share2, Sparkles } from 'lucide-react';
import { SkillGraph, SkillRecord } from '../types';

interface SkillListProps {
  skills: SkillRecord[];
  graph: SkillGraph;
  onSelectSkill: (skill: SkillRecord) => void;
  onAnalyzeSkill: (id: string) => void;
  onRetryErrors: (skillIds: string[]) => void;
  isAnalysisRunning: boolean;
  catalogMode: 'current' | 'catalog';
  onCatalogModeChange: (mode: 'current' | 'catalog') => void;
  selectedLibraryId: string;
  onSelectedLibraryIdChange: (libraryId: string) => void;
  selectedDatasetLabel: string;
  onSelectedDatasetLabelChange: (datasetLabel: string) => void;
  availableLibraries: string[];
  availableDatasets: string[];
}

function downloadCsv(filename: string, header: string[], rows: string[][]) {
  const sanitizeCell = (value: string) =>
    String(value ?? '')
      .replace(/\r?\n/g, ' ')
      .replace(/\t/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

  const delimiter = ';';
  const csv =
    'sep=;\r\n' +
    [header, ...rows]
      .map((row) => row.map((value) => `"${sanitizeCell(value).replace(/"/g, '""')}"`).join(delimiter))
      .join('\r\n');

  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function formatTimestamp(value: string | null): string {
  if (!value) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'n/a';
  return date.toLocaleString();
}

function pendingReasonLabel(reason: SkillRecord['pendingReason']): string {
  if (reason === 'new_skill') return 'new skill';
  if (reason === 'skill_changed') return 'changed skill';
  if (reason === 'model_changed') return 'model changed';
  if (reason === 'vocab_changed') return 'vocab changed';
  if (reason === 'prompt_changed') return 'prompt changed';
  if (reason === 'logic_changed') return 'logic changed';
  if (reason === 'recovery_after_error') return 'retry after previous error';
  if (reason === 'ambiguous_identity') return 'ambiguous identity (manual review needed)';
  return 'waiting for first analysis';
}

const SkillList: React.FC<SkillListProps> = ({
  skills,
  graph,
  onSelectSkill,
  onAnalyzeSkill,
  onRetryErrors,
  isAnalysisRunning,
  catalogMode,
  onCatalogModeChange,
  selectedLibraryId,
  onSelectedLibraryIdChange,
  selectedDatasetLabel,
  onSelectedDatasetLabelChange,
  availableLibraries,
  availableDatasets,
}) => {
  const [filter, setFilter] = useState('');
  const [onlyPending, setOnlyPending] = useState(false);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [openStatusSkillId, setOpenStatusSkillId] = useState<string | null>(null);

  const errorCount = useMemo(() => skills.filter((skill) => skill.semanticsStatus === 'error').length, [skills]);
  const pendingCount = useMemo(() => skills.filter((skill) => skill.semanticsStatus === 'pending').length, [skills]);

  const filteredSkills = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return skills.filter((skill) => {
      if (onlyPending && skill.semanticsStatus === 'ok') return false;
      if (onlyErrors && skill.semanticsStatus !== 'error') return false;
      if (!q) return true;

      const bag = [
        skill.skillId,
        skill.name,
        skill.oneLiner,
        skill.categoryLabel,
        skill.stage,
        skill.inputs.join(' '),
        skill.artifacts.join(' '),
        skill.capabilities.join(' '),
        skill.inputsTags.join(' '),
        skill.artifactsTags.join(' '),
        skill.capabilitiesTags.join(' '),
        skill.rootPath,
      ]
        .join(' ')
        .toLowerCase();

      return bag.includes(q);
    });
  }, [skills, filter, onlyPending, onlyErrors]);

  const handleExportSkills = () => {
    if (!skills.length) return;

    const rows = skills.map((skill) => [
      skill.skillId,
      skill.name,
      skill.oneLiner,
      `${skill.categoryLabel} (${Math.round(skill.categoryConfidence * 100)}%)`,
      `${skill.confidenceLevel} (${skill.confidenceBasis})`,
      skill.stage,
      skill.inputs.join(', '),
      skill.artifacts.join(', '),
      skill.capabilities.join(', '),
      skill.inputsTags.join(', '),
      skill.artifactsTags.join(', '),
      skill.capabilitiesTags.join(', '),
      skill.prerequisites.join(', '),
      skill.constraints.join(', '),
      skill.requires.scripts ? 'true' : 'false',
      skill.requires.mcp ? 'true' : 'false',
      skill.requires.network ? 'true' : 'false',
      skill.requires.tools.join(', '),
      skill.requires.runtimes.join(', '),
      skill.requires.secrets.join(', '),
      skill.libraryId,
      skill.datasetLabel,
      skill.semanticsStatus,
      skill.pendingReason || '',
      skill.semanticsUpdatedAt || '',
      skill.semanticsMeta.modelId,
      skill.semanticsMeta.vocabVersion,
      skill.semanticsMeta.promptVersion,
      skill.flags.map((flag) => `${flag.code}${flag.field ? `:${flag.field}` : ''}`).join(' | '),
      skill.rootPath,
    ]);

    downloadCsv(
      `skills-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        'skillId',
        'name',
        'oneLiner',
        'category+conf',
        'confidence',
        'stage',
        'inputs',
        'artifacts',
        'capabilities',
        'inputsTags',
        'artifactsTags',
        'capabilitiesTags',
        'prerequisites',
        'constraints',
        'requires.scripts',
        'requires.mcp',
        'requires.network',
        'requires.tools',
        'requires.runtimes',
        'requires.secrets',
        'libraryId',
        'datasetLabel',
        'semanticsStatus',
        'pendingReason',
        'semanticsUpdatedAt',
        'modelId',
        'vocabVersion',
        'promptVersion',
        'flags',
        'path',
      ],
      rows,
    );
  };

  const handleExportEdges = () => {
    const rows = graph.edges.map((edge) => [
      edge.from,
      edge.to,
      edge.type,
      edge.score.toFixed(4),
      edge.overlapTags.join(', '),
    ]);
    downloadCsv(`edges-${new Date().toISOString().slice(0, 10)}.csv`, ['from', 'to', 'type', 'score', 'overlapTags'], rows);
  };

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="px-8 py-5 border-b border-claude-border flex items-center justify-between gap-4 sticky top-0 bg-white/95 backdrop-blur z-20">
        <h2 className="font-serif text-xl text-gray-900 hidden md:block">Skill Map</h2>

        <div className="flex items-center gap-3 flex-1 justify-end">
          <div className="inline-flex items-center gap-2">
            <div className="inline-flex rounded-full border border-gray-200 bg-white p-0.5">
              <button
                onClick={() => onCatalogModeChange('current')}
                className={`px-3 py-1.5 text-xs rounded-full ${
                  catalogMode === 'current' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                Current Scan
              </button>
              <button
                onClick={() => onCatalogModeChange('catalog')}
                className={`px-3 py-1.5 text-xs rounded-full ${
                  catalogMode === 'catalog' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                Catalog
              </button>
            </div>
            <select
              value={selectedLibraryId}
              onChange={(event) => onSelectedLibraryIdChange(event.target.value)}
              disabled={catalogMode !== 'catalog'}
              className="px-2 py-2 text-xs rounded-full border border-gray-200 bg-white text-gray-700 disabled:opacity-50"
            >
              <option value="all">Library: All</option>
              {availableLibraries.map((library) => (
                <option key={library} value={library}>
                  {library}
                </option>
              ))}
            </select>
            <select
              value={selectedDatasetLabel}
              onChange={(event) => onSelectedDatasetLabelChange(event.target.value)}
              disabled={catalogMode !== 'catalog'}
              className="px-2 py-2 text-xs rounded-full border border-gray-200 bg-white text-gray-700 disabled:opacity-50"
            >
              <option value="all">Dataset: All</option>
              {availableDatasets.map((dataset) => (
                <option key={dataset} value={dataset}>
                  {dataset}
                </option>
              ))}
            </select>
            <button
              onClick={() => setOnlyPending((prev) => !prev)}
              className={`px-3 py-2 text-xs rounded-full border transition-colors ${
                onlyPending ? 'bg-amber-100 border-amber-300 text-amber-800' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              Only pending ({pendingCount})
            </button>
            <button
              onClick={() => setOnlyErrors((prev) => !prev)}
              className={`px-3 py-2 text-xs rounded-full border transition-colors ${
                onlyErrors ? 'bg-red-100 border-red-300 text-red-800' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              Only errors ({errorCount})
            </button>
            <button
              onClick={() =>
                onRetryErrors(
                  filteredSkills
                    .filter((skill) => skill.semanticsStatus === 'error')
                    .map((skill) => skill.id),
                )
              }
              disabled={errorCount === 0 || isAnalysisRunning}
              className="flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-[#B45309] rounded-full hover:bg-[#92400E] transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Sparkles size={14} />
              Retry errors (Pass1)
            </button>
          </div>

          <div className="relative w-full max-w-md group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-claude-accent transition-colors" size={16} />
            <input
              type="text"
              placeholder="Filter by stage, inputs, capabilities, category..."
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-[#F4F3F0] border-none rounded-full text-sm text-gray-800 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-claude-accent/20 transition-all shadow-inner"
            />
          </div>
          <button
            onClick={handleExportSkills}
            disabled={!skills.length}
            className="flex items-center gap-2 px-4 py-2 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-full hover:bg-gray-50 hover:text-gray-900 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download size={14} />
            Export Skills
          </button>
          <button
            onClick={handleExportEdges}
            disabled={!skills.length}
            title={
              graph.edges.length === 0
                ? '0 edges (filtered by constraints/threshold)'
                : `${graph.edges.length} edges | density ${(graph.metrics.density * 100).toFixed(1)}%`
            }
            className="flex items-center gap-2 px-4 py-2 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-full hover:bg-gray-50 hover:text-gray-900 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Share2 size={14} />
            Export Edges ({graph.edges.length})
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-left text-sm border-collapse">
          <thead className="bg-[#FCFBF9] text-gray-500 text-xs font-semibold sticky top-0 z-10 uppercase tracking-wider shadow-sm">
            <tr>
              <th className="px-6 py-4 border-b border-claude-border">Name</th>
              <th className="px-6 py-4 border-b border-claude-border">One-liner</th>
              <th className="px-6 py-4 border-b border-claude-border">Category+conf</th>
              <th className="px-6 py-4 border-b border-claude-border">Stage</th>
              <th className="px-6 py-4 border-b border-claude-border">Inputs</th>
              <th className="px-6 py-4 border-b border-claude-border">Outputs</th>
              <th className="px-6 py-4 border-b border-claude-border">Requires</th>
              <th className="px-6 py-4 border-b border-claude-border">Flags</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filteredSkills.map((skill) => (
              <tr key={skill.id} onClick={() => onSelectSkill(skill)} className="hover:bg-[#F4F3F0] transition-colors group cursor-pointer align-top">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <div className="font-medium text-gray-900">{skill.name}</div>
                    <div
                      className="relative"
                      onMouseEnter={() => setOpenStatusSkillId(skill.id)}
                      onMouseLeave={() => setOpenStatusSkillId((current) => (current === skill.id ? null : current))}
                    >
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          setOpenStatusSkillId((current) => (current === skill.id ? null : skill.id));
                        }}
                        className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                          skill.semanticsStatus === 'ok'
                            ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                            : skill.semanticsStatus === 'error'
                              ? 'bg-red-50 border-red-300 text-red-700'
                              : 'bg-amber-50 border-amber-300 text-amber-700'
                        }`}
                      >
                        {skill.semanticsStatus === 'ok' ? 'OK' : skill.semanticsStatus === 'error' ? 'ERROR' : 'PENDING'}
                      </button>

                      {openStatusSkillId === skill.id ? (
                        <div
                          className="absolute left-0 top-full mt-1 w-[280px] rounded-lg border border-[#E5E2DA] bg-white shadow-lg p-3 z-40 text-xs text-gray-700"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {skill.semanticsStatus === 'ok' ? (
                            <div className="space-y-1">
                              <div className="font-semibold text-emerald-700">Semantics cached</div>
                              <div>updated: {formatTimestamp(skill.semanticsUpdatedAt)}</div>
                              <div>model: {skill.semanticsMeta.modelId}</div>
                              <div>vocab: {skill.semanticsMeta.vocabVersion}</div>
                              <div>prompt: {skill.semanticsMeta.promptVersion}</div>
                            </div>
                          ) : null}

                          {skill.semanticsStatus === 'pending' ? (
                            <div className="space-y-1">
                              <div className="font-semibold text-amber-700">Awaiting analysis</div>
                              <div>reason: {pendingReasonLabel(skill.pendingReason)}</div>
                              <div>model: {skill.semanticsMeta.modelId}</div>
                              <div>vocab: {skill.semanticsMeta.vocabVersion}</div>
                              <div>prompt: {skill.semanticsMeta.promptVersion}</div>
                            </div>
                          ) : null}

                          {skill.semanticsStatus === 'error' ? (
                            <div className="space-y-2">
                              <div className="font-semibold text-red-700">Analysis failed</div>
                              <div className="text-red-800 bg-red-50 border border-red-100 rounded p-2 max-h-24 overflow-auto">
                                {skill.lastError || 'Unknown error'}
                              </div>
                              <button
                                onClick={() => onAnalyzeSkill(skill.id)}
                                disabled={isAnalysisRunning}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-red-600 text-white disabled:opacity-50"
                              >
                                <Sparkles size={12} />
                                Retry Pass1
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="text-[11px] text-gray-400 mt-1 font-mono truncate max-w-[280px]">{skill.skillId}</div>
                  <div className="text-[10px] text-gray-400 mt-1">
                    library: {skill.libraryId} · dataset: {skill.datasetLabel}
                  </div>
                </td>
                <td className="px-6 py-4 text-gray-700 max-w-[260px]">{skill.oneLiner}</td>
                <td className="px-6 py-4">
                  <div className="text-gray-800 font-medium">{skill.categoryLabel}</div>
                  <div className="text-xs text-gray-400">
                    {Math.round(skill.categoryConfidence * 100)}% - {skill.confidenceLevel}
                  </div>
                </td>
                <td className="px-6 py-4 capitalize">{skill.stage}</td>
                <td className="px-6 py-4 text-xs text-gray-600">{skill.inputs.join(', ') || '-'}</td>
                <td className="px-6 py-4 text-xs text-gray-600">
                  <div className="mb-1">
                    <span className="font-medium">Artifacts:</span> {skill.artifacts.join(', ') || '-'}
                  </div>
                  <div>
                    <span className="font-medium">Capabilities:</span> {skill.capabilities.join(', ') || '-'}
                  </div>
                </td>
                <td className="px-6 py-4 text-xs text-gray-600">
                  scripts:{skill.requires.scripts ? 'yes' : 'no'}<br />
                  mcp:{skill.requires.mcp ? 'yes' : 'no'}<br />
                  network:{skill.requires.network ? 'yes' : 'no'}
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-xs text-gray-600 max-w-[260px]">
                      {skill.flags.length ? (
                        skill.flags.slice(0, 3).map((flag) => (
                          <div key={`${flag.code}-${flag.field ?? ''}`} className="flex items-start gap-1.5 mb-1">
                            <AlertCircle size={12} className="mt-0.5 text-amber-600" />
                            <span>{flag.code}</span>
                          </div>
                        ))
                      ) : (
                        <span className="text-emerald-600">No flags</span>
                      )}
                    </div>
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        onAnalyzeSkill(skill.id);
                      }}
                      disabled={skill.analysisStatus === 'analyzing'}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-claude-accent text-white disabled:opacity-50"
                    >
                      <Sparkles size={12} />
                      {skill.analysisStatus === 'done' ? 'Re-run' : 'Analyze'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="px-8 py-4 border-t border-claude-border text-[11px] flex justify-between items-center text-gray-400 bg-[#FCFBF9]">
        <span>Showing {filteredSkills.length} skills</span>
        <span className="font-medium text-claude-accent/80">Export edges to validate workflow graph quality (CSV always available)</span>
      </div>
    </div>
  );
};

export default SkillList;
