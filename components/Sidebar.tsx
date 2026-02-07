import React from 'react';
import { LayoutDashboard, FileText, Upload, Settings, Loader2, Sparkles } from 'lucide-react';
import { AnalyzeProgress } from '../types';

interface SidebarProps {
  currentView: string;
  onChangeView: (view: string) => void;
  skillCount: number;
  analysisProgress?: AnalyzeProgress | null;
  onRunPass1: () => void;
  onRunPass2: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  onChangeView,
  skillCount,
  analysisProgress,
  onRunPass1,
  onRunPass2,
}) => {
  return (
    <div className="w-[260px] bg-claude-sidebar h-screen flex flex-col border-r border-claude-border shrink-0 font-sans">
      <div className="p-4 pt-5 pb-4">
        <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-[#E3E2DE] transition-colors cursor-default group">
          <div className="w-7 h-7 bg-claude-accent rounded-[6px] text-white flex items-center justify-center text-sm font-serif font-bold shadow-sm group-hover:scale-105 transition-transform">
            S
          </div>
          <h1 className="font-serif font-medium text-claude-text text-base tracking-tight">Skill Graph Builder</h1>
        </div>
      </div>

      <div className="px-4 mb-2">
        <button
          onClick={() => onChangeView('upload')}
          className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-all shadow-sm bg-white text-claude-text border border-claude-border hover:bg-gray-50 hover:border-claude-accent/30 active:scale-[0.98]"
        >
          <Upload size={16} className="text-claude-accent" />
          <span>New Scan</span>
        </button>
      </div>

      <div className="px-4 mb-3 space-y-2">
        <button
          onClick={onRunPass1}
          disabled={skillCount === 0 || Boolean(analysisProgress)}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold bg-claude-accent text-white disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Sparkles size={14} /> Analyze All (Pass 1)
        </button>
        <button
          onClick={onRunPass2}
          disabled={skillCount === 0 || Boolean(analysisProgress)}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold bg-gray-800 text-white disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Sparkles size={14} /> Deep Analyze (Pass 2)
        </button>
      </div>

      <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto">
        <div className="pt-4 pb-2 px-3 text-[11px] font-semibold text-[#8F8E8B] uppercase tracking-wider flex items-center gap-2">
          <span>Library</span>
        </div>

        <button
          onClick={() => onChangeView('dashboard')}
          disabled={skillCount === 0}
          className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
            currentView === 'dashboard'
              ? 'bg-[#E3E2DE] text-gray-900 font-medium'
              : 'text-[#5F5E5B] hover:bg-[#EAE9E4] hover:text-gray-900'
          } ${skillCount === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <div className="flex items-center gap-3">
            <LayoutDashboard size={18} strokeWidth={1.5} />
            <span>Overview</span>
          </div>
        </button>

        <button
          onClick={() => onChangeView('list')}
          disabled={skillCount === 0}
          className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
            currentView === 'list'
              ? 'bg-[#E3E2DE] text-gray-900 font-medium'
              : 'text-[#5F5E5B] hover:bg-[#EAE9E4] hover:text-gray-900'
          } ${skillCount === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <div className="flex items-center gap-3">
            <FileText size={18} strokeWidth={1.5} />
            <span>All Skills</span>
            {skillCount > 0 && (
              <span className="ml-auto text-[10px] bg-[#D8D7D4] px-1.5 py-0.5 rounded-full text-gray-700 font-semibold">{skillCount}</span>
            )}
          </div>
        </button>

        {analysisProgress && (
          <div className="mt-6 mx-2 p-3 bg-white border border-claude-border rounded-lg animate-fade-in shadow-[0_2px_8px_-2px_rgba(0,0,0,0.05)]">
            <div className="flex items-center gap-2 mb-2 text-xs font-medium text-claude-accent">
              <Loader2 size={12} className="animate-spin" />
              <span className="font-serif">{analysisProgress.phase === 'pass1' ? 'Running Pass 1...' : 'Running Pass 2...'}</span>
            </div>
            <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-claude-accent transition-all duration-300 ease-out"
                style={{ width: `${(analysisProgress.current / analysisProgress.total) * 100}%` }}
              ></div>
            </div>
            <div className="text-[10px] text-gray-400 mt-1.5 text-right font-mono">
              {analysisProgress.current} / {analysisProgress.total}
            </div>
          </div>
        )}
      </nav>

      <div className="p-4 border-t border-claude-border bg-[#FCFBF9]">
        <div className="flex items-center gap-3 text-claude-subtext text-xs hover:text-gray-900 transition-colors cursor-pointer group">
          <div className="w-8 h-8 rounded-full bg-[#EAE9E4] flex items-center justify-center text-gray-500 group-hover:bg-[#E3E2DE] transition-colors">
            <Settings size={14} />
          </div>
          <div>
            <div className="font-medium">Settings</div>
            <div className="opacity-70">v2.0.0</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
