/**
 * Format-neutral event surfaces. Tournaments, leagues and the formats the spec
 * still has queued (day round, box league) compose from here rather than from
 * each other.
 */

export { EventListScaffold } from './components/EventListScaffold';
export type { EventListSection } from './components/EventListScaffold';

export { EventCreationWizard } from './components/EventCreationWizard';
export type { EventCreationWizardProps } from './components/EventCreationWizard';
export { EventFormatPicker } from './components/EventFormatPicker';

export {
  EVENT_KINDS,
  TOURNAMENT_EVENT_KINDS,
  eventKindDescriptor,
  type EventKind,
  type EventEngine,
  type EventKindDescriptor,
} from './eventKinds';
