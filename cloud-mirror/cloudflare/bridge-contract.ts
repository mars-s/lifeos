import contracts from './local-tool-contracts.json';

export const localScope = 'lifeos:local';
export const localToolNames = new Set(contracts.map(tool => tool.name));
export const localToolNeedsWrite = (name: string) =>
  ['apply_approved_proposal', 'create_requested_task', 'update_requested_task', 'trash_requested_task'].includes(name);
export const localToolSpecs = contracts;
