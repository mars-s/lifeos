import {z} from 'zod';
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import collections from '../../integrations/oura-setup/health-collections.json';

export const healthScope = 'health:read';
type ReadResult = {ok:true;result:Record<string,unknown>} | {ok:false;reason:'connect'|'rate'|'invalid'|'unavailable'};
/** The Oura Worker's HealthReader entrypoint, reached only through the OURA_HEALTH service binding. */
export type HealthReader = {read(kind:string,args:Record<string,string>):Promise<ReadResult>};
export type HealthEnv = {OURA_HEALTH?:HealthReader};

export const healthToolName = (kind:string) => 'read_oura_' + kind.toLowerCase();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const range = {start_date:date.describe('YYYY-MM-DD'), end_date:date.describe('YYYY-MM-DD, at most 30 days after start_date')};
const paged = {...range, next_token:z.string().max(2048).optional()};
const failures:Record<string,string> = {
  connect:'Oura is not connected. The owner must reconnect it at https://lifeos-app-setup.lifeos-read-mirror-worker.workers.dev/oura/connect.',
  rate:'Oura read limit reached. Wait a minute before asking again.',
  invalid:'Invalid date range. Use YYYY-MM-DD, at most 30 days apart. Heart rate takes a single day.',
  unavailable:'Oura is temporarily unavailable. Do not retry automatically.',
};
const hints:Record<string,string> = {
  sleep:' Each sleep period includes average_hrv and HRV samples, plus heart rate and sleep stages.',
  daily_readiness:' Includes the readiness score and contributors such as hrv_balance and resting heart rate.',
  daily_sleep:' Daily sleep score and its contributors.',
  daily_activity:' Steps, calories, activity score and movement time.',
};

/** Read-only Oura tools. Listed only for grants that carry health:read, and never logged or stored. */
export function registerHealth(server:McpServer, env:HealthEnv, scopes:string[]) {
  if(!scopes.includes(healthScope)) return;
  const security = {securitySchemes:[{type:'oauth2',scopes:['things:read',healthScope]}]};
  for(const kind of collections) {
    const inputSchema = kind==='personal_info' ? {} : kind==='heartrate' ? range : paged;
    const span = kind==='personal_info' ? '' : kind==='heartrate' ? ' One calendar day per call: start_date must equal end_date.' : ' One page per call; pass next_token to continue.';
    server.registerTool(healthToolName(kind), {_meta:security,
      description:`Read the owner's Oura ${kind.replaceAll('_',' ')} records, fetched live from Oura.${hints[kind]??''}${span} Sensitive health data: use it only to answer the owner, never publish or share it.`,
      inputSchema, annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true}},
    async (args:Record<string,string>) => {
      const outcome:ReadResult = env.OURA_HEALTH ? await env.OURA_HEALTH.read(kind, args).catch(():ReadResult=>({ok:false,reason:'unavailable'})) : {ok:false,reason:'unavailable'};
      if(!outcome.ok) return {isError:true,content:[{type:'text' as const,text:failures[outcome.reason]??failures.unavailable}]};
      return {content:[{type:'text' as const,text:JSON.stringify(outcome.result)}],structuredContent:outcome.result};
    });
  }
}
