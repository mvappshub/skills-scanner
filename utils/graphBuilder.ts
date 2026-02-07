import { EdgeType, SkillGraph, SkillGraphEdge, SkillRecord, Stage } from '../types';

const STAGE_ORDER: Record<Stage, number> = {
  intake: 0,
  plan: 1,
  implement: 2,
  verify: 3,
  refactor: 4,
  security: 5,
  docs: 6,
  release: 7,
  other: 8,
};

function normalizeToken(token: string): string {
  return token.trim().toLowerCase();
}

function overlap(left: string[], right: string[]): string[] {
  const set = new Set(right.map(normalizeToken));
  return left
    .map(normalizeToken)
    .filter((token, index, all) => set.has(token) && token.length > 0 && all.indexOf(token) === index);
}

function normalizeTags(tags: string[]): string[] {
  return Array.from(new Set(tags.map(normalizeToken).filter(Boolean)));
}

function edgePriority(type: EdgeType): number {
  const order: Record<EdgeType, number> = {
    depends_on: 1,
    precedes: 2,
    complements: 3,
    alternative_to: 4,
  };
  return order[type];
}

function inferEdgeType(source: SkillRecord, target: SkillRecord): { type: EdgeType; via: string[] } | null {
  const artifactsToInputs = overlap(source.artifactsTags, target.inputsTags);
  const capabilitiesToInputs = overlap(source.capabilitiesTags, target.inputsTags);
  const sharedCapabilities = overlap(source.capabilitiesTags, target.capabilitiesTags);

  if (artifactsToInputs.length > 0) {
    return { type: 'depends_on', via: artifactsToInputs };
  }

  if (capabilitiesToInputs.length > 0 && STAGE_ORDER[target.stage] > STAGE_ORDER[source.stage]) {
    return { type: 'precedes', via: capabilitiesToInputs };
  }

  if (sharedCapabilities.length > 0 && source.stage !== target.stage) {
    return { type: 'complements', via: sharedCapabilities };
  }

  if (sharedCapabilities.length > 0 && source.stage === target.stage) {
    return { type: 'alternative_to', via: sharedCapabilities };
  }

  return null;
}

function logTagDebug(skills: SkillRecord[], edges: SkillGraphEdge[]) {
  if (!skills.length) return;

  const tagUsage = new Map<string, number>();
  const tagMatches = new Map<string, number>();

  for (const skill of skills) {
    const tags = normalizeTags([...skill.inputsTags, ...skill.artifactsTags, ...skill.capabilitiesTags]);
    for (const tag of tags) {
      tagUsage.set(tag, (tagUsage.get(tag) || 0) + 1);
    }
  }

  for (const edge of edges) {
    for (const tag of normalizeTags(edge.via)) {
      tagMatches.set(tag, (tagMatches.get(tag) || 0) + 1);
    }
  }

  const topTags = Array.from(tagUsage.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 20)
    .map(([tag, usageCount]) => ({
      tag,
      usageCount,
      matchCount: tagMatches.get(tag) || 0,
    }));

  console.log(`[graph] edges: ${edges.length}`);
  if (edges.length === 0) {
    console.warn('[graph] No edges - check tags');
  }
  console.log('[graph] top tags (usage + match count):');
  console.table(topTags);
}

function buildChains(adjacency: Record<string, string[]>): string[][] {
  const hasIncoming = new Set<string>();
  for (const targets of Object.values(adjacency)) {
    for (const target of targets) {
      hasIncoming.add(target);
    }
  }

  const starts = Object.keys(adjacency).filter((node) => !hasIncoming.has(node));
  const chains: string[][] = [];

  const dfs = (node: string, path: string[]) => {
    const next = adjacency[node] || [];
    if (!next.length) {
      chains.push(path);
      return;
    }

    for (const candidate of next.slice(0, 3)) {
      if (path.includes(candidate)) continue;
      dfs(candidate, [...path, candidate]);
    }
  };

  for (const start of starts.slice(0, 30)) {
    dfs(start, [start]);
  }

  return chains
    .filter((chain) => chain.length > 1)
    .sort((a, b) => b.length - a.length)
    .slice(0, 20);
}

export function buildSkillGraph(skills: SkillRecord[]): SkillGraph {
  const edgeMap = new Map<string, SkillGraphEdge>();
  const adjacency: Record<string, string[]> = {};
  const relatedBySkill: Record<string, string[]> = {};

  for (const skill of skills) {
    adjacency[skill.id] = [];
    relatedBySkill[skill.id] = [];
  }

  for (const source of skills) {
    for (const target of skills) {
      if (source.id === target.id) continue;

      const inferred = inferEdgeType(source, target);
      if (!inferred) continue;

      const key = `${source.id}->${target.id}`;
      const existing = edgeMap.get(key);
      if (!existing || edgePriority(inferred.type) < edgePriority(existing.type)) {
        edgeMap.set(key, {
          from: source.id,
          to: target.id,
          type: inferred.type,
          via: inferred.via,
        });
      }
    }
  }

  const edges = Array.from(edgeMap.values()).sort((a, b) => {
    if (a.from === b.from) return a.to.localeCompare(b.to);
    return a.from.localeCompare(b.from);
  });

  for (const edge of edges) {
    adjacency[edge.from].push(edge.to);
    relatedBySkill[edge.from].push(edge.to);
    relatedBySkill[edge.to].push(edge.from);
  }

  for (const key of Object.keys(adjacency)) {
    adjacency[key] = Array.from(new Set(adjacency[key]));
    relatedBySkill[key] = Array.from(new Set(relatedBySkill[key]));
  }

  logTagDebug(skills, edges);

  return {
    edges,
    adjacency,
    relatedBySkill,
    chains: buildChains(adjacency),
  };
}
