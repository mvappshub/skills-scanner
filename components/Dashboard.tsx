import React from 'react';
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ScanStats, SkillGraph } from '../types';

interface DashboardProps {
  stats: ScanStats;
  graph: SkillGraph;
}

const Dashboard: React.FC<DashboardProps> = ({ stats, graph }) => {
  const metrics = graph.metrics;
  const stageData = Object.entries(stats.byStage).map(([name, value]) => ({ name, value }));
  const riskData = [
    { name: 'Safe', value: stats.byRisk.safe, color: '#10B981' },
    { name: 'Warning', value: stats.byRisk.warning, color: '#F59E0B' },
    { name: 'Danger', value: stats.byRisk.danger, color: '#EF4444' },
  ].filter((item) => item.value > 0);

  const flagData = Object.entries(stats.flagCounts)
    .map(([name, value]) => ({ name, value: Number(value) }))
    .sort((a, b) => Number(b.value) - Number(a.value))
    .slice(0, 8);

  const edgeTypeData = metrics.distributionByType;

  return (
    <div className="p-10 max-w-6xl mx-auto space-y-10 animate-fade-in pb-20">
      <div className="flex items-end justify-between border-b border-claude-border pb-6">
        <div>
          <h2 className="font-serif text-3xl text-gray-900 mb-2">Pipeline Overview</h2>
          <p className="text-claude-subtext text-base font-serif">Identity, validation, semantics and workflow graph quality.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
        <div className="bg-white p-6 rounded-xl border border-claude-border shadow-sm">
          <div className="text-claude-subtext text-xs font-semibold uppercase tracking-wider mb-2">Skills</div>
          <div className="text-4xl font-serif text-gray-900">{stats.total}</div>
        </div>
        <div className="bg-white p-6 rounded-xl border border-claude-border shadow-sm">
          <div className="text-claude-subtext text-xs font-semibold uppercase tracking-wider mb-2">Scripts</div>
          <div className="text-4xl font-serif text-gray-900">{stats.scriptsCount}</div>
        </div>
        <div className="bg-white p-6 rounded-xl border border-claude-border shadow-sm">
          <div className="text-claude-subtext text-xs font-semibold uppercase tracking-wider mb-2">MCP</div>
          <div className="text-4xl font-serif text-blue-600">{stats.mcpCount}</div>
        </div>
        <div className="bg-white p-6 rounded-xl border border-claude-border shadow-sm">
          <div className="text-claude-subtext text-xs font-semibold uppercase tracking-wider mb-2">Flagged Skills</div>
          <div className="text-4xl font-serif text-amber-600">{stats.flaggedCount}</div>
        </div>
        <div className="bg-white p-6 rounded-xl border border-claude-border shadow-sm">
          <div className="text-claude-subtext text-xs font-semibold uppercase tracking-wider mb-2">Graph Edges</div>
          <div className="text-4xl font-serif text-gray-900">{metrics.edgeCount}</div>
          <p className="text-xs text-gray-500 mt-2">Density {(metrics.density * 100).toFixed(2)}%</p>
          {metrics.edgeCount === 0 ? (
            <p className="text-xs text-amber-700 mt-1">No edges after stoplist/specificity/threshold/topK.</p>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="bg-white p-8 rounded-xl border border-claude-border shadow-sm flex flex-col">
          <h3 className="font-serif text-xl text-gray-900 mb-8">Stage Distribution</h3>
          <div style={{ width: '100%', height: 320, minHeight: 320 }}>
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <BarChart data={stageData} margin={{ left: 8 }}>
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="value" fill="#D97757" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-8 rounded-xl border border-claude-border shadow-sm flex flex-col">
          <h3 className="font-serif text-xl text-gray-900 mb-8">Risk Distribution</h3>
          <div style={{ width: '100%', height: 320, minHeight: 320 }}>
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <PieChart>
                <Pie data={riskData} cx="50%" cy="50%" innerRadius={70} outerRadius={100} paddingAngle={5} dataKey="value">
                  {riskData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="bg-white p-8 rounded-xl border border-claude-border shadow-sm">
          <h3 className="font-serif text-xl text-gray-900 mb-4">Flag Counts</h3>
          {flagData.length === 0 ? (
            <p className="text-sm text-gray-500">No flags detected.</p>
          ) : (
            <div className="space-y-2 text-sm">
              {flagData.map((item) => (
                <div key={item.name} className="flex items-center justify-between bg-[#F9F8F5] border border-[#ECEAE4] rounded px-3 py-2">
                  <span className="font-mono text-gray-700">{item.name}</span>
                  <span className="text-gray-500">{item.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white p-8 rounded-xl border border-claude-border shadow-sm">
          <h3 className="font-serif text-xl text-gray-900 mb-4">Edge Types</h3>
          {metrics.edgeCount === 0 ? (
            <p className="text-sm text-gray-500">No edges - constraints/threshold removed all candidates.</p>
          ) : (
            <div className="space-y-2 text-sm">
              {Object.entries(edgeTypeData).map(([name, value]) => (
                <div key={name} className="flex items-center justify-between bg-[#F9F8F5] border border-[#ECEAE4] rounded px-3 py-2">
                  <span className="font-mono text-gray-700">{name}</span>
                  <span className="text-gray-500">{value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="bg-white p-8 rounded-xl border border-claude-border shadow-sm">
          <h3 className="font-serif text-xl text-gray-900 mb-4">Top 10 Degree Nodes</h3>
          {metrics.topDegreeNodes.length === 0 ? (
            <p className="text-sm text-gray-500">No degree data yet.</p>
          ) : (
            <div className="space-y-2 text-sm">
              {metrics.topDegreeNodes.map((node) => (
                <div key={node.id} className="flex items-center justify-between bg-[#F9F8F5] border border-[#ECEAE4] rounded px-3 py-2">
                  <span className="font-mono text-gray-700 truncate mr-3">{node.id}</span>
                  <span className="text-gray-500 shrink-0">
                    deg {node.degree} | in {node.inDegree} | out {node.outDegree}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white p-8 rounded-xl border border-claude-border shadow-sm">
          <h3 className="font-serif text-xl text-gray-900 mb-4">Drop Reasons</h3>
          <div className="space-y-2 text-sm">
            {Object.entries(metrics.dropReasons).map(([name, value]) => (
              <div key={name} className="flex items-center justify-between bg-[#F9F8F5] border border-[#ECEAE4] rounded px-3 py-2">
                <span className="font-mono text-gray-700">{name}</span>
                <span className="text-gray-500">{value}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-3">
            threshold {metrics.threshold.toFixed(3)} | candidates {metrics.candidateCount}
          </p>
        </div>
      </div>

      <div className="bg-white p-8 rounded-xl border border-claude-border shadow-sm">
        <h3 className="font-serif text-xl text-gray-900 mb-4">Workflow View (beta)</h3>
        {graph.chains.length === 0 ? (
          <p className="text-sm text-gray-500">No chains yet. Run AI analysis to extract structured semantics first.</p>
        ) : (
          <div className="space-y-3">
            {graph.chains.slice(0, 8).map((chain, index) => (
              <div key={index} className="text-sm text-gray-700 bg-[#F9F8F5] px-3 py-2 rounded border border-[#ECEAE4] font-mono">
                {chain.join(' -> ')}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
