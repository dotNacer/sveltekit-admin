import { describe, it, expect, vi } from 'vitest';
import { escapeHtml } from '../../../../src/lib/server/views/html.js';
import { NODE_R, PAD, layout } from '../../../../src/lib/server/plugins/relation-graph/layout.js';
import {
  PAN_ZOOM_SCRIPT,
  installRelationGraphPanZoom,
  renderGraphPage,
  type PanZoomCanvas
} from '../../../../src/lib/server/plugins/relation-graph/render.js';
import type { PluginPageContext } from '../../../../src/lib/server/plugin.js';
import type { GraphNode } from '../../../../src/lib/server/plugins/relation-graph/walk.js';

function node(over: Partial<GraphNode> & Pick<GraphNode, 'key'>): GraphNode {
  const [model, id] = over.key.split(':');
  return {
    model,
    id,
    label: String(id),
    opaque: false,
    href: `/admin/${model.toLowerCase()}/${id}`,
    graphHref: null,
    depth: 0,
    ...over
  };
}

function ctx(): Pick<PluginPageContext, 'escapeHtml'> {
  return { escapeHtml };
}

describe('renderGraphPage', () => {
  it('renders title, hint when there are no edges, and one node', () => {
    const laid = layout({
      nodes: [node({ key: 'User:1', label: 'Ada <x>', depth: 0 })],
      edges: []
    });
    const page = renderGraphPage(ctx() as PluginPageContext, laid);
    expect(page.html).toContain('class="ska-rg"');
    expect(page.html).toContain('<h1 class="ska-rg__title">');
    expect(page.html).toContain('User · Ada &lt;x&gt;');
    expect(page.html).toContain('No related records in scope.');
    expect(page.html).toContain('class="ska-rg-viewport"');
    expect(page.html).toContain('class="ska-rg-canvas"');
    expect(page.html).toContain(`r="${NODE_R}"`);
    expect(page.scripts).toBe(PAN_ZOOM_SCRIPT);
    expect(page.scripts).not.toMatch(/fetch\(/);
    expect(page.styles).toContain('.ska-rg');
  });

  it('sizes the SVG to the viewport width, not the layout pixel box', () => {
    const laid = layout({
      nodes: [
        node({ key: 'User:1', label: 'Ada', depth: 0 }),
        node({ key: 'Post:p1', label: 'Hello', depth: 1 }),
        node({ key: 'Tag:2', label: 'js', depth: 2 })
      ],
      edges: []
    });
    const page = renderGraphPage(ctx() as PluginPageContext, laid);
    expect(page.html).toContain(`viewBox="${laid.viewBox}"`);
    expect(page.html).toMatch(/<svg[^>]*class="ska-rg-svg"/);
    expect(page.html).toMatch(/<svg[^>]*width="100%"/);
    expect(page.html).not.toMatch(new RegExp(`<svg[^>]*width="${laid.width}"`));
    expect(page.html).not.toMatch(new RegExp(`<svg[^>]*height="${laid.height}"`));
    expect(page.styles).toContain('.ska-rg-svg{display:block;width:100%;height:auto}');
    expect(page.styles).toContain('flex-direction:column;height:calc(100vh - 4rem)');
    expect(page.styles).toContain('min-height:0;flex:1');
    expect(page.styles).not.toContain('min-height:calc(100vh');
  });

  it('escapes labels, fields, and hrefs; in-scope node is an edit link', () => {
    const laid = layout({
      nodes: [
        node({ key: 'User:1', label: 'Ada', depth: 0, href: '/admin/user/1', graphHref: '/admin/user/1/graph' }),
        node({
          key: 'Post:p1',
          label: 'Hi "there"',
          depth: 1,
          href: '/admin/post/p1" onclick="alert(1)',
          graphHref: null
        })
      ],
      edges: [{ from: 'Post:p1', to: 'User:1', field: 'author<script>', kind: 'fk' }]
    });
    const page = renderGraphPage(ctx() as PluginPageContext, laid);
    expect(page.html).toContain('author&lt;script&gt;');
    expect(page.html).toContain('Hi &quot;there&quot;');
    expect(page.html).toContain('href="/admin/post/p1&quot; onclick=&quot;alert(1)"');
    expect(page.html).not.toContain('onclick="alert(1)"');
    expect(page.html).toContain('marker-end');
    expect(page.html).toContain('class="ska-rg-node__graph"');
    expect(page.html).not.toContain('ska-rg__hint');
  });

  it('opaque node has no edit <a> and uses the opaque class', () => {
    const laid = layout({
      nodes: [
        node({ key: 'User:1', label: 'Ada', depth: 0 }),
        node({
          key: 'User:99',
          label: '#99',
          depth: 1,
          opaque: true,
          href: null,
          graphHref: null
        })
      ],
      edges: [{ from: 'User:99', to: 'User:1', field: 'author', kind: 'fk' }]
    });
    const page = renderGraphPage(ctx() as PluginPageContext, laid);
    expect(page.html).toContain('ska-rg-node--opaque');
    expect(page.html).toMatch(/ska-rg-node--opaque[\s\S]*#99/);
    expect(page.html).not.toMatch(/<a[^>]*href="\/admin\/user\/99"/);
  });

  it('m2m edges have no arrow marker; reflexive FK is a path loop', () => {
    const laid = layout({
      nodes: [node({ key: 'Category:1', label: 'Root', depth: 0 })],
      edges: [
        { from: 'Category:1', to: 'Category:1', field: 'parent', kind: 'fk' },
        { from: 'Category:1', to: 'Category:1', field: 'friends', kind: 'm2m' }
      ]
    });
    const page = renderGraphPage(ctx() as PluginPageContext, laid);
    expect(page.html).toContain('<path');
    expect(page.html).toContain('ska-rg-edge--m2m');
    expect(page.html).toContain(`cx="${PAD}"`);
    const m2mEdge = page.html.match(/<path[^>]*class="[^"]*ska-rg-edge--m2m[^"]*"[^>]*>/);
    expect(m2mEdge).toBeTruthy();
    expect(m2mEdge![0]).not.toContain('marker-end');
  });
});

describe('installRelationGraphPanZoom', () => {
  function harness() {
    const listeners: Record<string, (e: Record<string, unknown>) => void> = {};
    const captured: number[] = [];
    const vp = {
      addEventListener: (type: string, fn: (e: Record<string, unknown>) => void) => {
        listeners[type] = fn;
      },
      setPointerCapture: (id: number) => {
        captured.push(id);
      }
    };
    const g = { setAttribute: vi.fn() };
    installRelationGraphPanZoom(vp, g);
    return { listeners, captured, g };
  }

  it('does not capture or pan when the pointer is on a link', () => {
    const { listeners, captured, g } = harness();
    listeners.pointerdown({
      target: { closest: (sel: string) => (sel === 'a' ? {} : null) },
      clientX: 10,
      clientY: 10,
      pointerId: 1
    });
    expect(captured).toEqual([]);
    listeners.pointermove({ clientX: 40, clientY: 10 });
    expect(g.setAttribute).not.toHaveBeenCalled();
  });

  it('pans after pointerdown outside a link and clamps wheel zoom', () => {
    const { listeners, captured, g } = harness();
    listeners.pointerdown({ clientX: 0, clientY: 0, pointerId: 2 });
    expect(captured).toEqual([2]);
    listeners.pointerup({});
    listeners.pointerdown({ target: {}, clientX: 0, clientY: 0, pointerId: 3 });
    expect(captured).toEqual([2, 3]);
    listeners.pointerup({});
    listeners.pointerdown({
      target: { closest: () => null },
      clientX: 10,
      clientY: 10,
      pointerId: 7
    });
    expect(captured).toEqual([2, 3, 7]);
    listeners.pointermove({ clientX: 40, clientY: 16 });
    expect(g.setAttribute).toHaveBeenCalledWith('transform', 'translate(30 6) scale(1)');
    listeners.pointerup({});
    listeners.pointermove({ clientX: 80, clientY: 16 });
    expect(g.setAttribute).toHaveBeenCalledTimes(1);
    const preventDefault = vi.fn();
    listeners.wheel({ deltaY: -1, clientX: 30, clientY: 6, preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(g.setAttribute).toHaveBeenLastCalledWith('transform', 'translate(30 6) scale(1.1)');
    for (let i = 0; i < 20; i++) listeners.wheel({ deltaY: -1, clientX: 30, clientY: 6, preventDefault });
    expect(g.setAttribute).toHaveBeenLastCalledWith('transform', 'translate(30 6) scale(3)');
    for (let i = 0; i < 40; i++) listeners.wheel({ deltaY: 1, clientX: 30, clientY: 6, preventDefault });
    expect(g.setAttribute).toHaveBeenLastCalledWith('transform', 'translate(30 6) scale(0.4)');
  });

  it('zooms toward the pointer, not the graph origin', () => {
    const { listeners, g } = harness();
    const preventDefault = vi.fn();
    listeners.wheel({ deltaY: -1, clientX: 100, clientY: 50, preventDefault });
    expect(g.setAttribute).toHaveBeenCalledWith('transform', 'translate(-10 -5) scale(1.1)');
  });

  it('maps the pointer through the SVG screen CTM when present', () => {
    const g = {
      setAttribute: vi.fn(),
      ownerSVGElement: {
        createSVGPoint() {
          const pt = {
            x: 0,
            y: 0,
            matrixTransform() {
              return { x: 200, y: 80 };
            }
          };
          return pt;
        },
        getScreenCTM() {
          return { inverse() { return {}; } };
        }
      }
    };
    const listeners: Record<string, (e: Record<string, unknown>) => void> = {};
    installRelationGraphPanZoom(
      {
        addEventListener: (type, fn) => {
          listeners[type] = fn as (e: Record<string, unknown>) => void;
        },
        setPointerCapture: vi.fn()
      },
      g
    );
    listeners.wheel({ deltaY: -1, clientX: 1, clientY: 1, preventDefault: vi.fn() });
    expect(g.setAttribute).toHaveBeenCalledWith('transform', 'translate(-20 -8) scale(1.1)');
  });

  it('falls back to client coordinates when the CTM is missing', () => {
    const cases = [
      { ownerSVGElement: undefined },
      { ownerSVGElement: {} },
      { ownerSVGElement: { getScreenCTM: () => ({ inverse() { return {}; } }) } },
      { ownerSVGElement: { createSVGPoint: () => ({}), getScreenCTM: () => null } },
      { ownerSVGElement: { createSVGPoint: () => ({}) } }
    ];
    for (const extra of cases) {
      const listeners: Record<string, (e: Record<string, unknown>) => void> = {};
      const g = { setAttribute: vi.fn(), ...extra };
      installRelationGraphPanZoom(
        {
          addEventListener: (type, fn) => {
            listeners[type] = fn as (e: Record<string, unknown>) => void;
          },
          setPointerCapture: vi.fn()
        },
        g as PanZoomCanvas
      );
      listeners.wheel({ deltaY: -1, clientX: 100, clientY: 50, preventDefault: vi.fn() });
      expect(g.setAttribute).toHaveBeenCalledWith('transform', 'translate(-10 -5) scale(1.1)');
    }
    const { listeners, g } = harness();
    listeners.wheel({ deltaY: -1, clientX: 100, clientY: 50 });
    expect(g.setAttribute).toHaveBeenCalled();
  });

  it('no-ops when the viewport or canvas is missing', () => {
    expect(() => installRelationGraphPanZoom(null, { setAttribute: vi.fn() })).not.toThrow();
    expect(() =>
      installRelationGraphPanZoom(
        { addEventListener: vi.fn(), setPointerCapture: vi.fn() },
        null
      )
    ).not.toThrow();
  });

  it('inlines the installer into PAN_ZOOM_SCRIPT', () => {
    expect(PAN_ZOOM_SCRIPT).toContain('ska-rg-viewport');
    expect(PAN_ZOOM_SCRIPT).toContain(installRelationGraphPanZoom.toString());
  });
});
