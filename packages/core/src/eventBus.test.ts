import { describe, expect, it, mock } from "bun:test";
import { EventBus } from "./eventBus";

describe("EventBus", () => {
  it("should create an event bus", () => {
    const bus = new EventBus();
    expect(bus).toBeDefined();
  });

  it("should emit and receive events", () => {
    const bus = new EventBus<{ test: string }>();
    const handler = mock((data: string) => {});

    bus.on("test", handler);
    bus.emit("test", "hello");

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith("hello");
  });

  it("should support multiple handlers for same event", () => {
    const bus = new EventBus<{ test: string }>();
    const handler1 = mock((data: string) => {});
    const handler2 = mock((data: string) => {});

    bus.on("test", handler1);
    bus.on("test", handler2);
    bus.emit("test", "hello");

    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(1);
  });

  it("should unsubscribe handlers", () => {
    const bus = new EventBus<{ test: string }>();
    const handler = mock((data: string) => {});

    const unsubscribe = bus.on("test", handler);
    bus.emit("test", "first");

    unsubscribe();
    bus.emit("test", "second");

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith("first");
  });

  it("should handle errors in handlers gracefully", () => {
    const bus = new EventBus<{ test: string }>();
    const errorHandler = mock(() => {
      throw new Error("handler error");
    });
    const goodHandler = mock((data: string) => {});

    bus.on("test", errorHandler);
    bus.on("test", goodHandler);

    // Should not throw
    expect(() => bus.emit("test", "hello")).not.toThrow();

    expect(errorHandler).toHaveBeenCalledTimes(1);
    expect(goodHandler).toHaveBeenCalledTimes(1);
  });

  it("should support once() for one-time handlers", () => {
    const bus = new EventBus<{ test: string }>();
    const handler = mock((data: string) => {});

    bus.once("test", handler);
    bus.emit("test", "first");
    bus.emit("test", "second");

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith("first");
  });
});
