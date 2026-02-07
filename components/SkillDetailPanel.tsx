import React from 'react';
import { AlertCircle, FileCode, Sparkles, X } from 'lucide-react';
import { SkillRecord } from '../types';

interface SkillDetailPanelProps {
  skill: SkillRecord;
  onClose: () => void;
  onAnalyze: () => void;
  onDeepAnalyze: () => void;
}

const SkillDetailPanel: React.FC<SkillDetailPanelProps> = ({ skill, onClose, onAnalyze, onDeepAnalyze }) => {
  const confidence = Math.round(skill.categoryConfidence * 100);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/10 backdrop-blur-[2px] transition-opacity" onClick={onClose}></div>

      <div className="relative w-full max-w-3xl bg-white h-full shadow-2xl flex flex-col animate-slide-in-right overflow-hidden border-l border-claude-border">
        <div className="h-14 border-b border-claude-border flex items-center justify-between px-6 bg-[#FCFBF9] shrink-0">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-7 h-7 rounded-[6px] bg-white border border-claude-border flex items-center justify-center text-claude-accent shadow-sm shrink-0">
              <FileCode size={16} />
            </div>
            <div className="min-w-0">
              <h2 className="font-sans text-sm font-medium text-gray-900 truncate">{skill.name}</h2>
              <div className="text-xs text-claude-subtext">
                <span className="truncate max-w-[360px] font-mono opacity-80">{skill.skillId}</span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-200/60 rounded-md text-gray-500 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto bg-white">
          <div className="max-w-3xl mx-auto p-8 space-y-8">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <span className="px-2.5 py-1 bg-gray-100 rounded-md text-xs font-medium text-gray-600 border border-gray-200">
                  {skill.categoryLabel} ({confidence}%)
                </span>
                <span className="px-2.5 py-1 bg-gray-50 rounded-md text-xs font-medium text-gray-500 border border-gray-200">
                  stage: {skill.stage}
                </span>
                <span className="px-2.5 py-1 bg-gray-50 rounded-md text-xs font-medium text-gray-500 border border-gray-200">
                  {skill.confidenceLevel} / {skill.confidenceBasis}
                </span>
              </div>
              <h1 className="font-serif text-3xl text-gray-900 leading-tight mb-4">{skill.name}</h1>
              <p className="text-lg text-gray-600 leading-relaxed font-serif">{skill.oneLiner}</p>
            </div>

            <div className="border-t border-b border-claude-border py-6">
              <div className="flex items-center justify-between gap-3 mb-4">
                <h3 className="font-sans font-medium text-gray-900 flex items-center gap-2">
                  <Sparkles size={16} className="text-claude-accent" />
                  AI Pipeline
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={onAnalyze}
                    disabled={skill.analysisStatus === 'analyzing'}
                    className="bg-claude-accent hover:bg-[#c26647] text-white px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50"
                  >
                    Analyze (Pass 1)
                  </button>
                  <button
                    onClick={onDeepAnalyze}
                    disabled={skill.analysisStatus === 'analyzing'}
                    className="bg-gray-800 hover:bg-gray-700 text-white px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50"
                  >
                    Deep analyze (Pass 2)
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">Inputs</div>
                  <div className="text-gray-700">{skill.inputs.join(', ') || '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">Artifacts</div>
                  <div className="text-gray-700">{skill.artifacts.join(', ') || '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">Capabilities</div>
                  <div className="text-gray-700">{skill.capabilities.join(', ') || '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">Prerequisites</div>
                  <div className="text-gray-700">{skill.prerequisites.join(', ') || '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">Constraints</div>
                  <div className="text-gray-700">{skill.constraints.join(', ') || '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">Related skills</div>
                  <div className="text-gray-700">{skill.relatedSkills.join(', ') || '-'}</div>
                </div>
              </div>
            </div>

            <div>
              <h3 className="font-sans font-medium text-gray-900 mb-3">Requires</h3>
              <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono bg-[#F9F8F5] border border-[#ECEAE4] rounded-lg p-3">
                {JSON.stringify(skill.requires, null, 2)}
              </pre>
            </div>

            <div>
              <h3 className="font-sans font-medium text-gray-900 mb-3">Evidence Pack</h3>
              <div className="space-y-3">
                {skill.evidencePack.items.map((item, idx) => (
                  <div key={`${item.kind}-${idx}`} className="bg-[#F9F8F5] border border-[#ECEAE4] rounded-lg p-3">
                    <div className="text-xs uppercase tracking-wider text-gray-400 mb-1">
                      {item.kind} - {item.label}
                    </div>
                    <div className="text-[11px] text-gray-500 mb-2 font-mono">
                      {item.file}:{item.lineStart}-{item.lineEnd} hash:{item.snippetHash}
                    </div>
                    <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono">{item.content}</pre>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="font-sans font-medium text-gray-900 mb-3">Quality Flags</h3>
              {skill.flags.length === 0 ? (
                <div className="text-sm text-emerald-700">No quality flags.</div>
              ) : (
                <div className="space-y-2">
                  {skill.flags.map((flag) => (
                    <div key={`${flag.code}-${flag.field ?? ''}-${flag.message}`} className="flex items-start gap-2 text-sm text-gray-700 bg-[#FFF6E8] border border-[#F6DEB5] rounded-lg p-2">
                      <AlertCircle size={14} className="mt-0.5 text-amber-700" />
                      <div>
                        <div className="font-medium">
                          {flag.code}
                          {flag.field ? ` (${flag.field})` : ''}
                        </div>
                        <div>{flag.message}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h3 className="font-sans font-medium text-gray-900 mb-3">Source</h3>
              <div className="bg-white border border-claude-border rounded-lg overflow-hidden">
                <div className="bg-[#F9F9F9] px-4 py-2 border-b border-claude-border flex items-center justify-between">
                  <span className="text-xs font-mono text-gray-500">{skill.facts.filePath}</span>
                </div>
                <div className="p-4 overflow-x-auto max-h-96">
                  <pre className="text-xs font-mono text-gray-600 whitespace-pre">{skill.rawSkillContent}</pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SkillDetailPanel;
