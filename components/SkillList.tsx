import React, { useMemo, useState } from 'react';
import { AlertCircle, Download, Search, Share2, Sparkles } from 'lucide-react';
import { SkillGraph, SkillRecord } from '../types';

interface SkillListProps {
  skills: SkillRecord[];
  graph: SkillGraph;
  onSelectSkill: (skill: SkillRecord) => void;
  onAnalyzeSkill: (id: string) => void;
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

const SkillList: React.FC<SkillListProps> = ({ skills, graph, onSelectSkill, onAnalyzeSkill }) => {
  const [filter, setFilter] = useState('');

  const filteredSkills = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return skills;

    return skills.filter((skill) => {
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
  }, [skills, filter]);

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
        'flags',
        'path',
      ],
      rows,
    );
  };

  const handleExportEdges = () => {
    const rows = graph.edges.map((edge) => [edge.from, edge.to, edge.type, edge.via.join(', ')]);
    downloadCsv(`edges-${new Date().toISOString().slice(0, 10)}.csv`, ['from', 'to', 'type', 'via'], rows);
  };

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="px-8 py-5 border-b border-claude-border flex items-center justify-between gap-4 sticky top-0 bg-white/95 backdrop-blur z-20">
        <h2 className="font-serif text-xl text-gray-900 hidden md:block">Skill Map</h2>

        <div className="flex items-center gap-3 flex-1 justify-end">
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
            title={graph.edges.length === 0 ? '0 edges (tag overlap empty)' : `${graph.edges.length} edges ready`}
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
                  <div className="font-medium text-gray-900">{skill.name}</div>
                  <div className="text-[11px] text-gray-400 mt-1 font-mono truncate max-w-[280px]">{skill.skillId}</div>
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
