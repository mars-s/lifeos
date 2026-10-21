import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {z} from 'zod';
import {ownerSync} from './owner-sync';
import {localScope, localToolNeedsWrite, localToolSpecs as contracts, noteToolScopes, notesWriteScope} from './bridge-contract';

const tools = contracts.map(tool => ({...tool, schema: z.fromJSONSchema(
  tool.inputSchema as Parameters<typeof z.fromJSONSchema>[0]
)}));

export function registerLocalBridge(server: McpServer, env: Env, scopes: string[], origin: string) {
  for (const tool of tools) {
    const notes = noteToolScopes(tool.name);
    // A grant without the notes scopes never sees the note tools at all.
    if (!notes.every(scope => scopes.includes(scope))) continue;
    const required = ['things:read', localScope, ...notes, ...(localToolNeedsWrite(tool.name) ? ['things:write'] : [])];
    const resourceUri = tool.name === 'review_brain_dump_memory' ? 'ui://lifeos/cloud-memory-review-v1.html'
      : tool.name === 'render_proposal_review' ? 'ui://lifeos/cloud-proposal-review-v2.html' : undefined;
    const visibility = (tool as {meta?: {ui?: {visibility?: string[]}}}).meta?.ui?.visibility;
    server.registerTool(tool.name, {
      description: `${tool.description} Runs on your awake Mac.${notes.length ? ' Notes stay in Anytype on the Mac; this service passes them through in memory only.' : ' Raw captures remain in local storage.'} A timeout is not proof that a write failed.`,
      inputSchema: tool.schema,
      annotations: tool.annotations,
      _meta: {securitySchemes: [{type: 'oauth2', scopes: required}],
        // App-only tools (approve/reject) stay hidden from the model; only the card calls them.
        ...(visibility || resourceUri ? {ui: {...(resourceUri ? {resourceUri} : {}), ...(visibility ? {visibility} : {})}} : {}),
        ...(visibility?.length === 1 && visibility[0] === 'app' ? {'openai/visibility': 'private', 'openai/widgetAccessible': true} : {}),
        ...(resourceUri ? {'openai/outputTemplate': resourceUri} : {}),
      },
    }, async (args: unknown) => {
      if (!required.every(scope => scopes.includes(scope))) {
        return {isError: true, content: [{type: 'text' as const, text: 'Reconnect this existing LifeOS connection and approve local LifeOS tools. Existing Things-only grants remain unchanged.'}],
          _meta: {'mcp/www_authenticate': [`Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", error="insufficient_scope", scope="${required.join(' ')}"`]},
        };
      }
      // The Mac writes to Anytype only when this grant has notes:write (captures, interpretations,
      // journal prose and promotions included). Set here so a client value never wins.
      const grant = {notes_write: scopes.includes(notesWriteScope)};
      return await ownerSync(env).callLocalTool(tool.name, {...args as Record<string, unknown>, _lifeos_grant: grant}) as {
        content: {type: 'text'; text: string}[]; isError?: boolean; structuredContent?: Record<string, unknown>;
      };
    });
  }
}
