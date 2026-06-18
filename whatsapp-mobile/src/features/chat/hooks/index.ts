/**
 * Chat feature hooks.
 */
export { useChatStore } from '../chat.store';
export { useWhatsAppRealtime } from './useWhatsAppRealtime';
export { useWhatsAppCall } from './useWhatsAppCall';
export type { OutgoingCallPhase } from './useWhatsAppCall';
export { useIncomingWhatsAppCall } from './useIncomingWhatsAppCall';
export type { IncomingCallPhase, IncomingCallInfo } from './useIncomingWhatsAppCall';

// Add custom hooks as needed, e.g.:
// export { useConversations } from './useConversations';
// export { useMessages } from './useMessages';
