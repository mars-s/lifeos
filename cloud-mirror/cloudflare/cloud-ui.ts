import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {z} from 'zod';
import contracts from './ui-contracts.json';
import rendererInputs from './ui-tool-contracts.json';
import dayHTML from '../../src/lifeos/ui/day-plan-v1.html';
import weekHTML from '../../src/lifeos/ui/week-plan-v1.html';
import canvasHTML from '../../src/lifeos/ui/brain-dump-canvas-v3.html';
import proposalHTML from '../../src/lifeos/ui/proposal-review-v1.html';
import memoryHTML from '../../src/lifeos/ui/memory-review-v1.html';

const mimeType = 'text/html;profile=mcp-app';
const previewAnnotations = {
  readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false,
};
type JSONContract = Parameters<typeof z.fromJSONSchema>[0];
const daySchema = z.fromJSONSchema(contracts.DayPlanWidgetOutput as JSONContract);
const weekSchema = z.fromJSONSchema(contracts.WeekPlanWidgetOutput as JSONContract);
const canvasSchema = z.fromJSONSchema(contracts.BrainDumpCanvasOutput as JSONContract);

type PlanBlock = {start: string; end: string; duration_minutes: number};
function instant(value: string): number {
  if (!/^\d{4}-\d\d-\d\dT.+(?:Z|[+-]\d\d:\d\d)$/.test(value)) {
    throw new Error('Plan times require an explicit timezone.');
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error('Invalid plan time.');
  return time;
}
function windowBounds(start: string, end: string, blocks: PlanBlock[]) {
  const from = instant(start), to = instant(end);
  if (from >= to || to - from > 24 * 60 * 60 * 1000) throw new Error('Invalid day window.');
  for (const block of blocks) {
    const s = instant(block.start), e = instant(block.end);
    if (s < from || e > to || s >= e || (e - s) / 60000 !== block.duration_minutes) {
      throw new Error('Block timing does not match its duration or day window.');
    }
  }
}
function checkedDay(value: unknown) {
  const data = daySchema.parse(value) as {
    day_start: string; day_end: string; blocks: PlanBlock[]; [key: string]: unknown;
  };
  if (data.mutates_external_systems) throw new Error('Preview cannot claim external mutations.');
  windowBounds(data.day_start, data.day_end, data.blocks);
  return {...data, proposal_ready: false, mutates_external_systems: false, can_prepare_proposal: false};
}
function checkedWeek(value: unknown) {
  const data = weekSchema.parse(value) as {
    range_start: string; range_end: string;
    days: {day_start: string; day_end: string; blocks: PlanBlock[]}[];
    [key: string]: unknown;
  };
  if (data.mutates_external_systems) throw new Error('Preview cannot claim external mutations.');
  const from = instant(data.range_start), to = instant(data.range_end);
  if (from >= to) throw new Error('Invalid plan range.');
  let previous = from;
  for (const day of data.days) {
    windowBounds(day.day_start, day.day_end, day.blocks);
    if (instant(day.day_start) < previous || instant(day.day_end) > to) throw new Error('Day windows overlap or exceed the range.');
    previous = instant(day.day_end);
  }
  return {...data, proposal_ready: false, mutates_external_systems: false, can_prepare_proposal: false};
}
function checkedCanvas(value: unknown) {
  const data = canvasSchema.parse(value) as {
    nodes: {id: string; kind: string; x: number; width: number; html?: string | null;
      css?: string | null; javascript?: string | null; diagram?: string | null}[];
    [key: string]: unknown;
  };
  if (new Set(data.nodes.map(node => node.id)).size !== data.nodes.length) throw new Error('Duplicate canvas node IDs.');
  for (const node of data.nodes) {
    if (node.x + node.width - 1 > 12) throw new Error('Node extends past column 12.');
    const custom = Boolean(node.html || node.css || node.javascript);
    if ((node.kind === 'custom_html') !== custom) throw new Error('Custom content must belong to a custom_html node.');
    if ((node.kind === 'mermaid') !== Boolean(node.diagram)) throw new Error('Diagram source must belong to a mermaid node.');
  }
  return {...data, mutates_external_systems: false, can_prepare_proposal: false};
}

// Use the same reviewed HTML as the local service. Only the resource URI differs,
// so clients cannot reuse a local widget cached under the old approval contract.
export function registerCloudUI(server: McpServer, origin: string, canPrepare = false) {
  const resources = [
    {name: 'LifeOS cloud day preview', uri: 'ui://lifeos/cloud-day-plan-v1.html', html: dayHTML, domains: []},
    {name: 'LifeOS cloud week preview', uri: 'ui://lifeos/cloud-week-plan-v1.html', html: weekHTML, domains: []},
    {name: 'LifeOS cloud meeting canvas', uri: 'ui://lifeos/cloud-brain-dump-v1.html', html: canvasHTML, domains: ['https://cdn.jsdelivr.net']},
    {name: 'LifeOS cloud proposal review', uri: 'ui://lifeos/cloud-proposal-review-v1.html', html: proposalHTML, domains: []},
    {name: 'LifeOS cloud memory review', uri: 'ui://lifeos/cloud-memory-review-v1.html', html: memoryHTML, domains: []},
  ];
  for (const resource of resources) {
    const csp = {connectDomains: [], resourceDomains: resource.domains};
    server.registerResource(resource.name, resource.uri, {mimeType}, async () => ({
      contents: [{uri: resource.uri, mimeType, text: resource.html, _meta: {
        ui: {prefersBorder: false, domain: origin, csp},
        'openai/widgetDomain': origin,
        'openai/widgetCSP': {connect_domains: [], resource_domains: resource.domains},
      }}],
    }));
  }
  const tools = [
    {name: 'render_day_plan', uri: resources[0].uri, schema: daySchema, key: 'plan', parse: checkedDay,
      description: 'Show a supplied day plan as an interactive preview. Does not read Calendar, save a proposal or apply changes.'},
    {name: 'render_week_plan', uri: resources[1].uri, schema: weekSchema, key: 'plan', parse: checkedWeek,
      description: 'Show a supplied multi-day plan as an interactive preview. Does not read Calendar, save a proposal or apply changes.'},
    {name: 'render_brain_dump_canvas', uri: resources[2].uri, schema: canvasSchema, key: 'canvas', parse: checkedCanvas,
      description: 'Show a supplied meeting or brain-dump preview with transcript evidence, candidate tasks and Mermaid relationships. Does not save raw text or create tasks.'},
  ];
  for (const tool of tools) {
    const wrapper = z.object({[tool.key]: tool.schema}).strict();
    const inputSchema = tool.name === 'render_brain_dump_canvas' ? wrapper : z.union([
      wrapper, z.fromJSONSchema(rendererInputs[tool.name as keyof typeof rendererInputs] as JSONContract),
    ]);
    server.registerTool(tool.name, {
      description: tool.description,
      inputSchema, annotations: previewAnnotations,
      _meta: {ui: {resourceUri: tool.uri}, 'openai/outputTemplate': tool.uri},
    }, async (input: Record<string, unknown>) => {
      try {
        if (input.mutates_external_systems === true) throw new Error('Preview cannot claim external mutations.');
        const value = input[tool.key] ?? input.preview ?? Object.fromEntries(
          Object.entries(input).filter(([key, value]) => !['things_changes', 'calendar_changes', 'preview'].includes(key) && value !== null)
        );
        const output = {...tool.parse(value), can_prepare_proposal: canPrepare,
          ...(tool.key === 'plan' ? {proposal_ready: canPrepare} : {})};
        if (new TextEncoder().encode(JSON.stringify(output)).length > 128 * 1024) throw new Error('Preview too large.');
        return {content: [{type: 'text' as const, text: 'Preview only. Nothing has changed in Things or Calendar. Raw source is not saved by this renderer.'}], structuredContent: output};
      } catch {
        return {isError: true, content: [{type: 'text' as const, text: 'Invalid preview. Check the schema, unique IDs, explicit timezones and block durations.'}]};
      }
    });
  }
}
