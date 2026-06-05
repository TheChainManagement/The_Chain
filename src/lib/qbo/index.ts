/**
 * QBO adapter barrel (Block 6).
 *
 * Public surface for the QuickBooks Online native adapter: the adapter itself,
 * its client + transport seam, capabilities, and the pure mappers. Callers
 * (Server Actions, workflow steps) import from here, not the internal files.
 */

export { QboSourceAdapter } from './adapter';
export { QBO_CAPABILITIES } from './capabilities';
export { QboClient, type QboConnection, type QboEnvironment } from './client';
export {
  HttpQboTransport,
  type QboRequest,
  type QboResponse,
  type QboTransport,
} from './transport';
export * from './types';
