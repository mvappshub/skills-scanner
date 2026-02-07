import React, { useEffect, useMemo, useState } from 'react';
import Sidebar from './components/Sidebar';
import UploadArea from './components/UploadArea';
import Dashboard from './components/Dashboard';
import SkillList from './components/SkillList';
import SkillDetailPanel from './components/SkillDetailPanel';
import { AnalyzeProgress, ScanStats, SkillRecord } from './types';
import { buildSkillGraph } from './utils/graphBuilder';
import { scanFiles } from './utils/scannerLogic';
import { runPass1, runPass2 } from './utils/aiLogic';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<'upload' | 'dashboard' | 'list'>('upload');
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<AnalyzeProgress | null>(null);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedSkillId) return;
    if (!skills.some((skill) => skill.id === selectedSkillId)) {
      setSelectedSkillId(null);
    }
  }, [skills, selectedSkillId]);

  const handleScan = async (files: FileList) => {
    setIsScanning(true);
    setAnalysisProgress(null);
    setSelectedSkillId(null);

    try {
      const scanned = await scanFiles(files);
      setSkills(scanned);
      setCurrentView('dashboard');
      if (scanned.length === 0) {
        alert('No SKILL.md/skill.md files found.');
      }
    } catch (error) {
      console.error('Scanning failed:', error);
      alert('Scanning failed. See console for details.');
    } finally {
      setIsScanning(false);
    }
  };

  const replaceSkill = (updatedSkill: SkillRecord) => {
    setSkills((prev) => prev.map((skill) => (skill.id === updatedSkill.id ? updatedSkill : skill)));
  };

  const runSingleAnalysis = async (id: string, phase: 'pass1' | 'pass2') => {
    const source = skills.find((skill) => skill.id === id);
    if (!source) return;

    replaceSkill({ ...source, analysisStatus: 'analyzing' });

    const analyzed = phase === 'pass1' ? await runPass1(source) : await runPass2(source);
    replaceSkill(analyzed);
  };

  const runBulkAnalysis = async (phase: 'pass1' | 'pass2') => {
    if (!skills.length) return;

    const total = skills.length;
    setAnalysisProgress({ current: 0, total, phase });

    let current = 0;
    for (const skill of skills) {
      replaceSkill({ ...skill, analysisStatus: 'analyzing' });

      try {
        const analyzed = phase === 'pass1' ? await runPass1(skill) : await runPass2(skill);
        replaceSkill(analyzed);
      } catch (error) {
        console.warn(`Analysis failed for ${skill.id}`, error);
        replaceSkill({ ...skill, analysisStatus: 'failed' });
      }

      current += 1;
      setAnalysisProgress({ current, total, phase });
    }

    setAnalysisProgress(null);
  };

  const stats: ScanStats = useMemo(() => {
    const base: ScanStats = {
      total: skills.length,
      scriptsCount: 0,
      mcpCount: 0,
      byStage: {},
      byRisk: { safe: 0, warning: 0, danger: 0 },
      flaggedCount: 0,
      flagCounts: {},
    };

    for (const skill of skills) {
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
  }, [skills]);

  const graph = useMemo(() => buildSkillGraph(skills), [skills]);
  const skillsWithGraph = useMemo(
    () =>
      skills.map((skill) => ({
        ...skill,
        relatedSkills: graph.relatedBySkill[skill.id] ?? [],
      })),
    [skills, graph.relatedBySkill],
  );
  const selectedSkill = useMemo(
    () => skillsWithGraph.find((skill) => skill.id === selectedSkillId) ?? null,
    [skillsWithGraph, selectedSkillId],
  );

  return (
    <div className="flex h-screen w-full bg-claude-bg text-claude-text font-sans antialiased overflow-hidden selection:bg-claude-accent/20">
      <Sidebar
        currentView={currentView}
        onChangeView={(view) => setCurrentView(view as typeof currentView)}
        skillCount={skills.length}
        analysisProgress={analysisProgress}
        onRunPass1={() => runBulkAnalysis('pass1')}
        onRunPass2={() => runBulkAnalysis('pass2')}
      />

      <main className="flex-1 h-full overflow-hidden relative flex flex-col">
        {currentView === 'upload' && <UploadArea onScan={handleScan} isScanning={isScanning} />}

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
