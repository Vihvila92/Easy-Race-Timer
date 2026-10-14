export type DomainEventName =
  | 'TimingEventRecorded'
  | 'CorrectionApplied'
  | 'EntryChanged'
  | 'ResultsInvalidated'
  | 'ConsentChanged'

export class DomainBus {
  private readonly handlers = new Map<DomainEventName, Set<(payload: unknown) => void>>()

  on(name: DomainEventName, handler: (payload: unknown) => void): () => void {
    const set = this.handlers.get(name) ?? new Set()
    set.add(handler)
    this.handlers.set(name, set)
    return () => set.delete(handler)
  }

  emit(name: DomainEventName, payload: unknown): void {
    for (const handler of this.handlers.get(name) ?? []) handler(payload)
  }
}
