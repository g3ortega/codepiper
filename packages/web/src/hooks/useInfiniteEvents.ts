import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { Event } from "../types/api";

interface UseInfiniteEventsOptions {
  sessionId: string;
  source?: string;
  limit?: number;
  order?: "asc" | "desc";
  poll?: boolean;
  pollInterval?: number;
}

interface UseInfiniteEventsResult {
  events: Event[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
  sentinelRef: RefObject<HTMLDivElement>;
}

const PAGE_SIZE = 50;

/** Extract the min and max IDs from a list of events */
function getIdBounds(events: Event[]): { min: number; max: number } {
  let min = events[0].id;
  let max = events[0].id;
  for (let i = 1; i < events.length; i++) {
    if (events[i].id < min) min = events[i].id;
    if (events[i].id > max) max = events[i].id;
  }
  return { min, max };
}

export function useInfiniteEvents({
  sessionId,
  source,
  limit = PAGE_SIZE,
  order = "desc",
  poll = false,
  pollInterval = 3000,
}: UseInfiniteEventsOptions): UseInfiniteEventsResult {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef(false);
  const newestIdRef = useRef<number | null>(null);
  const oldestIdRef = useRef<number | null>(null);

  // Initial load
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        const response = await api.getEvents(sessionId, {
          source,
          limit,
          order,
        });

        if (cancelled) return;

        setEvents(response.events);
        setHasMore(response.hasMore);

        if (response.events.length > 0) {
          const { min, max } = getIdBounds(response.events);
          newestIdRef.current = max;
          oldestIdRef.current = min;
        }
      } catch (err) {
        if (!cancelled) console.error("Failed to load events:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [sessionId, source, limit, order]);

  // Load more (older events)
  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore || oldestIdRef.current === null) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);

    try {
      const response = await api.getEvents(sessionId, {
        source,
        before: oldestIdRef.current,
        limit,
        order,
      });

      if (response.events.length > 0) {
        const { min } = getIdBounds(response.events);
        oldestIdRef.current = min;

        setEvents((prev) => [...prev, ...response.events]);
      }
      setHasMore(response.hasMore);
    } catch (err) {
      console.error("Failed to load more events:", err);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [sessionId, source, limit, order, hasMore]);

  // IntersectionObserver for sentinel element
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loadingMoreRef.current) {
          loadMore();
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  // Polling for new events (since > newest id)
  useEffect(() => {
    if (!poll || loading) return;

    const interval = setInterval(async () => {
      if (newestIdRef.current === null) return;

      try {
        const response = await api.getEvents(sessionId, {
          source,
          since: newestIdRef.current,
          order: "asc",
        });

        if (response.events.length > 0) {
          const { min, max } = getIdBounds(response.events);
          newestIdRef.current = max;

          // If we haven't loaded any older events yet, also update oldest
          if (oldestIdRef.current === null) {
            oldestIdRef.current = min;
          }

          // For DESC order: prepend new events at the start
          // For ASC order: append new events at the end
          setEvents((prev) =>
            order === "desc"
              ? [...response.events.reverse(), ...prev]
              : [...prev, ...response.events]
          );
        }
      } catch {
        // Ignore polling errors
      }
    }, pollInterval);

    return () => clearInterval(interval);
  }, [sessionId, source, order, poll, pollInterval, loading]);

  return {
    events,
    loading,
    loadingMore,
    hasMore,
    loadMore,
    sentinelRef,
  };
}
