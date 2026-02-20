/**
 * Event bus for inter-component communication
 */

type Handler<T> = (data: T) => void;
type Unsubscribe = () => void;

export class EventBus<EventMap extends Record<string, any> = Record<string, any>> {
  private handlers: Map<keyof EventMap, Set<Handler<any>>> = new Map();

  on<K extends keyof EventMap>(event: K, handler: Handler<EventMap[K]>): Unsubscribe {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }

    this.handlers.get(event)?.add(handler);

    return () => {
      const handlers = this.handlers.get(event);
      if (handlers) {
        handlers.delete(handler);
      }
    };
  }

  once<K extends keyof EventMap>(event: K, handler: Handler<EventMap[K]>): Unsubscribe {
    const wrappedHandler = (data: EventMap[K]) => {
      handler(data);
      unsubscribe();
    };

    const unsubscribe = this.on(event, wrappedHandler);
    return unsubscribe;
  }

  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
    const handlers = this.handlers.get(event);
    if (!handlers) return;

    for (const handler of handlers) {
      try {
        handler(data);
      } catch (error) {
        console.error(`Error in event handler for ${String(event)}:`, error);
      }
    }
  }

  removeAllListeners<K extends keyof EventMap>(event?: K): void {
    if (event) {
      this.handlers.delete(event);
    } else {
      this.handlers.clear();
    }
  }
}
