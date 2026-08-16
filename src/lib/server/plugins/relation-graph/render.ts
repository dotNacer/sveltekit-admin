import type { PluginPageContext } from '../../plugin.js';
import { NODE_R } from './layout.js';
import type { LaidOutGraph, LaidOutNode } from './layout.js';
import type { GraphEdge } from './walk.js';

export const PAN_ZOOM_SCRIPT =
  '(function(){var vp=document.querySelector(".ska-rg-viewport");var g=document.querySelector(".ska-rg-canvas");if(!vp||!g)return;var s=1,x=0,y=0,px=0,py=0,drag=false;function apply(){g.setAttribute("transform","translate("+x+" "+y+") scale("+s+")");}vp.addEventListener("pointerdown",function(e){drag=true;px=e.clientX;py=e.clientY;vp.setPointerCapture(e.pointerId);});vp.addEventListener("pointerup",function(){drag=false;});vp.addEventListener("pointermove",function(e){if(!drag)return;x+=e.clientX-px;y+=e.clientY-py;px=e.clientX;py=e.clientY;apply();});vp.addEventListener("wheel",function(e){e.preventDefault();var n=e.deltaY<0?s*1.1:s/1.1;if(n<0.4)n=0.4;if(n>3)n=3;s=n;apply();},{passive:false});})();';

const STYLES = `.ska-rg{padding:1rem 1.5rem 2rem;flex:1}
.ska-rg__title{font-size:1.25rem;margin-bottom:0.5rem}
.ska-rg__hint{color:#64748b;margin-bottom:0.75rem}
.ska-rg-viewport{overflow:auto;border:1px solid #e2e8f0;border-radius:8px;background:#fff;min-height:320px;cursor:grab}
.ska-rg-node__label{font-size:12px;fill:#1e293b;max-width:160px}
.ska-rg-node--root circle{fill:var(--ska-primary);stroke:var(--ska-primary)}
.ska-rg-node--root .ska-rg-node__label{fill:#fff}
.ska-rg-node circle{fill:#fff;stroke:var(--ska-primary);stroke-width:2}
.ska-rg-node--opaque circle{stroke:#94a3b8;stroke-dasharray:4 3;fill:#f8fafc}
.ska-rg-node--opaque .ska-rg-node__label{fill:#94a3b8}
.ska-rg-edge{stroke:var(--ska-primary);stroke-width:1.5;fill:none}
.ska-rg-edge--m2m{stroke-dasharray:6 4;stroke:#64748b}
.ska-rg-edge__label{font-size:10px;fill:#64748b}
.ska-rg-node__graph{font-size:10px;fill:var(--ska-primary)}`;

function loopPath(n: LaidOutNode): string {
  const { x, y } = n;
  const r = NODE_R;
  return `M ${x} ${y - r} C ${x + 40} ${y - 52}, ${x + 40} ${y + 52}, ${x} ${y + r}`;
}

function edgeSvg(
  edge: GraphEdge,
  byKey: Map<string, LaidOutNode>,
  esc: (s: string) => string
): string {
  const from = byKey.get(edge.from)!;
  const to = byKey.get(edge.to)!;
  const label = esc(edge.field);
  const isM2m = edge.kind === 'm2m';
  const cls = isM2m ? 'ska-rg-edge ska-rg-edge--m2m' : 'ska-rg-edge';
  const marker = isM2m ? '' : ' marker-end="url(#ska-rg-arrow)"';
  if (from.key === to.key) {
    const d = loopPath(from);
    return `<path class="${cls}" d="${d}"${marker}></path><text class="ska-rg-edge__label" x="${from.x + 44}" y="${from.y}">${label}</text>`;
  }
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  return `<line class="${cls}" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"${marker}></line><text class="ska-rg-edge__label" x="${mx}" y="${my}">${label}</text>`;
}

function nodeSvg(n: LaidOutNode, esc: (s: string) => string): string {
  const rootCls = n.depth === 0 ? ' ska-rg-node--root' : '';
  const opaqueCls = n.opaque ? ' ska-rg-node--opaque' : '';
  const title = `<title>${esc(n.label)}</title>`;
  const circle = `<circle cx="${n.x}" cy="${n.y}" r="${NODE_R}"></circle>`;
  const text = `<text class="ska-rg-node__label" x="${n.x}" y="${n.y + NODE_R + 14}" text-anchor="middle">${esc(n.label)}</text>`;
  const editInner = `${title}${circle}${text}`;
  const editLink =
    !n.opaque && n.href ? `<a href="${esc(n.href)}">${editInner}</a>` : editInner;
  const graphLink = n.graphHref
    ? `<a class="ska-rg-node__graph" href="${esc(n.graphHref)}"><text class="ska-rg-node__graph" x="${n.x}" y="${n.y + NODE_R + 28}" text-anchor="middle">Graph</text></a>`
    : '';
  return `<g class="ska-rg-node${rootCls}${opaqueCls}">${editLink}${graphLink}</g>`;
}

export function renderGraphPage(ctx: PluginPageContext, laidOut: LaidOutGraph) {
  const esc = ctx.escapeHtml;
  const root = laidOut.nodes.find((n) => n.depth === 0)!;
  const byKey = new Map(laidOut.nodes.map((n) => [n.key, n]));
  const hint =
    laidOut.edges.length === 0
      ? '<p class="ska-rg__hint">No related records in scope.</p>'
      : '';
  const edges = laidOut.edges.map((e) => edgeSvg(e, byKey, esc)).join('');
  const nodes = laidOut.nodes.map((n) => nodeSvg(n, esc)).join('');
  const html = `<div class="ska-rg"><h1 class="ska-rg__title">${esc(root.model)} · ${esc(root.label)}</h1>${hint}<div class="ska-rg-viewport"><svg width="${laidOut.width}" height="${laidOut.height}" viewBox="${esc(laidOut.viewBox)}"><defs><marker id="ska-rg-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--ska-primary)"></path></marker></defs><g class="ska-rg-canvas">${edges}${nodes}</g></svg></div></div>`;
  return { html, styles: STYLES, scripts: PAN_ZOOM_SCRIPT };
}
