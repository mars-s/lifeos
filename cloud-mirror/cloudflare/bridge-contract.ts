import contracts from './local-tool-contracts.json';

export const localScope = 'lifeos:local';
export const localToolNames = new Set(contracts.map(tool => tool.name));
export const localToolNeedsWrite = (name: string) =>
  ['apply_approved_proposal', 'create_requested_task', 'update_requested_task', 'trash_requested_task'].includes(name);
export const localToolSpecs = contracts;
// Anytype notes: listed only for grants that carry these scopes (and lifeos:local, the bridge).
export const notesScope = 'notes';
export const notesWriteScope = 'notes:write';
const noteReads = ['notes_search', 'notes_read', 'notes_today', 'notes_list_types'];
const noteWrites = ['notes_add', 'notes_tag', 'notes_set_field', 'notes_move', 'notes_link_task', 'promote_notes_to_things'];
export const noteToolScopes = (name: string): string[] =>
  noteReads.includes(name) ? [notesScope] : noteWrites.includes(name) ? [notesScope, notesWriteScope] : [];
