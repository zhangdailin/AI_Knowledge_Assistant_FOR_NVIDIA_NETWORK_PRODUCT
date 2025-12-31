import { describe, expect, it } from 'vitest';
import {
  bundleEdges,
  bundleEdgesByLayer,
  collapseBundle,
  expandBundle
} from '../src/utils/edge-bundling';
import type { Edge } from 'reactflow';

function createEdge(id: string, source: string, target: string): Edge {
  return {
    id,
    source,
    target,
    data: {}
  } as Edge;
}

describe('edge-bundling utilities', () => {
  it('bundles dense source-target pairs into aggregate edges', () => {
    const edges: Edge[] = Array.from({ length: 6 }, (_, index) =>
      createEdge(`edge-${index}`, 'IBLF-01', 'IBSP-01')
    );

    const { bundledEdges, bundleMap, stats } = bundleEdges(edges, { threshold: 3 });
    expect(bundleMap.size).toBe(1);

    const bundleEdge = bundledEdges.find(edge => edge.data?.type === 'bundle');
    expect(bundleEdge).toBeDefined();
    expect(bundleEdge?.label).toContain('6');
    expect(stats.originalCount).toBe(6);
    expect(stats.reduction.endsWith('%')).toBe(true);
  });

  it('expands and collapses bundle edges, toggling visibility of originals', () => {
    const edges: Edge[] = Array.from({ length: 5 }, (_, index) =>
      createEdge(`edge-b-${index}`, 'IBLF-02', 'IBSP-02')
    );
    const { bundledEdges, bundleMap } = bundleEdges(edges, { threshold: 2, keepOriginal: true });
    const bundleId = Array.from(bundleMap.keys())[0];

    const expanded = expandBundle(bundleId, bundledEdges, bundleMap);
    const expandedOriginals = expanded.filter(edge => edge.data?.bundleId === bundleId);
    expect(expandedOriginals.length).toBe(5);
    expect(expandedOriginals.every(edge => edge.data?.hidden === false)).toBe(true);

    const collapsed = collapseBundle(bundleId, expanded, bundleMap);
    const collapsedOriginals = collapsed.filter(edge => edge.data?.bundleId === bundleId);
    expect(collapsedOriginals.every(edge => edge.data?.hidden === true)).toBe(true);
  });

  it('aggregates edges by detected network layer labels', () => {
    const edges: Edge[] = Array.from({ length: 12 }, (_, index) =>
      createEdge(`layer-edge-${index}`, `IBSP-${index}`, `IBLF-${index}`)
    );
    const { bundleMap } = bundleEdgesByLayer(edges, 5);
    expect(bundleMap.size).toBe(1);
    const layerBundle = Array.from(bundleMap.values())[0];
    expect(layerBundle.count).toBe(12);
    expect(layerBundle.label).toContain('leaf');
  });
});
