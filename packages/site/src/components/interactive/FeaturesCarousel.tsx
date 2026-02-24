import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface Feature {
  icon: string;
  title: string;
  description: string;
  color: string;
  claudeOnly?: boolean;
}

interface Props {
  features: Feature[];
}

const GAP = 24; // px — matches Tailwind gap-6
const AUTO_PLAY_MS = 4000;
const TRANSITION_MS = 500;

function getCardsPerView(): number {
  if (typeof window === "undefined") return 3;
  if (window.innerWidth >= 1024) return 3;
  if (window.innerWidth >= 768) return 2;
  return 1;
}

const colorMap: Record<string, { bg: string; text: string }> = {
  primary: { bg: "rgba(6, 182, 212, 0.1)", text: "#06b6d4" },
  secondary: { bg: "rgba(139, 92, 246, 0.1)", text: "#8b5cf6" },
  emerald: { bg: "rgba(16, 185, 129, 0.1)", text: "#10b981" },
  amber: { bg: "rgba(245, 158, 11, 0.1)", text: "#f59e0b" },
};

function IconBox({ html, color }: { html: string; color: string }) {
  return (
    <div
      className="w-10 h-10 rounded-lg flex items-center justify-center mb-4 transition-colors duration-200"
      style={{
        backgroundColor: colorMap[color]?.bg,
        color: colorMap[color]?.text,
      }}
      aria-hidden="true"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: SVGs are hardcoded string literals, not user input
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export default function FeaturesCarousel({ features }: Props) {
  const total = features.length;
  const [cardsPerView, setCardsPerView] = useState(3);
  const [isPaused, setIsPaused] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [animate, setAnimate] = useState(true);

  // Position in extended array — real cards start at index `cloneCount`
  const cloneCount = cardsPerView;
  const [position, setPosition] = useState(cardsPerView);
  const posRef = useRef(cardsPerView);

  // Logical index: which real card is first visible (0 to total-1)
  const currentIndex = (((position - cloneCount) % total) + total) % total;

  // Extended features: [last N clones] + [real cards] + [first N clones]
  // Clones enable seamless wrap — the track slides into clones, then silently
  // resets position to the equivalent real cards (no visible jump).
  const extendedFeatures = useMemo(
    () => [...features.slice(-cloneCount), ...features, ...features.slice(0, cloneCount)],
    [features, cloneCount]
  );

  const touchRef = useRef({
    startX: 0,
    startY: 0,
    lastX: 0,
    lastTime: 0,
    locked: false,
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wheelDelta = useRef(0);
  const wheelTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Responsive cardsPerView ──
  useEffect(() => {
    const update = () => {
      const newCPV = getCardsPerView();
      setCardsPerView((oldCPV) => {
        if (oldCPV !== newCPV) {
          const logIdx = (((posRef.current - oldCPV) % total) + total) % total;
          const newPos = logIdx + newCPV;
          posRef.current = newPos;
          setAnimate(false);
          setPosition(newPos);
          requestAnimationFrame(() => setAnimate(true));
        }
        return newCPV;
      });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [total]);

  // ── Reduced motion ──
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // ── Navigation ──
  const next = useCallback(() => {
    if (isTransitioning) return;
    setIsTransitioning(true);
    setAnimate(true);
    const newPos = posRef.current + 1;
    posRef.current = newPos;
    setPosition(newPos);
    setTimeout(() => {
      if (newPos >= cloneCount + total) {
        const resetPos = newPos - total;
        posRef.current = resetPos;
        setAnimate(false);
        setPosition(resetPos);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setAnimate(true);
            setIsTransitioning(false);
          });
        });
      } else {
        setIsTransitioning(false);
      }
    }, TRANSITION_MS);
  }, [isTransitioning, cloneCount, total]);

  const prev = useCallback(() => {
    if (isTransitioning) return;
    setIsTransitioning(true);
    setAnimate(true);
    const newPos = posRef.current - 1;
    posRef.current = newPos;
    setPosition(newPos);
    setTimeout(() => {
      if (newPos < cloneCount) {
        const resetPos = newPos + total;
        posRef.current = resetPos;
        setAnimate(false);
        setPosition(resetPos);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setAnimate(true);
            setIsTransitioning(false);
          });
        });
      } else {
        setIsTransitioning(false);
      }
    }, TRANSITION_MS);
  }, [isTransitioning, cloneCount, total]);

  const goTo = useCallback(
    (index: number) => {
      if (isTransitioning) return;
      setIsTransitioning(true);
      setAnimate(true);
      const newPos = index + cloneCount;
      posRef.current = newPos;
      setPosition(newPos);
      setTimeout(() => setIsTransitioning(false), TRANSITION_MS);
    },
    [isTransitioning, cloneCount]
  );

  // ── Auto-play ──
  useEffect(() => {
    if (prefersReducedMotion || isPaused) {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      return;
    }
    timerRef.current = setInterval(next, AUTO_PLAY_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPaused, prefersReducedMotion, next]);

  // ── Keyboard navigation ──
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
      }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [next, prev]);

  // ── Touch drag with velocity-based momentum ──
  const getCardWidth = useCallback(() => {
    const track = trackRef.current;
    if (!track) return 300;
    return track.offsetWidth / cardsPerView;
  }, [cardsPerView]);

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchRef.current = {
      startX: t.clientX,
      startY: t.clientY,
      lastX: t.clientX,
      lastTime: Date.now(),
      locked: false,
    };
    setIsDragging(true);
    setIsPaused(true);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const ref = touchRef.current;
    const t = e.touches[0];
    const dx = t.clientX - ref.startX;
    const dy = t.clientY - ref.startY;

    if (!ref.locked && Math.abs(dx) + Math.abs(dy) > 10) {
      ref.locked = true;
      if (Math.abs(dy) > Math.abs(dx)) {
        setIsDragging(false);
        setDragOffset(0);
        return;
      }
    }

    if (!(ref.locked && isDragging)) return;
    e.preventDefault();

    ref.lastX = t.clientX;
    ref.lastTime = Date.now();
    setDragOffset(dx);
  };

  const onTouchEnd = () => {
    if (!isDragging) return;
    const ref = touchRef.current;
    const elapsed = Math.max(1, Date.now() - ref.lastTime);
    const velocity = (ref.lastX - ref.startX) / elapsed;
    const cardW = getCardWidth();
    const threshold = cardW * 0.2;
    const swipedFar = Math.abs(dragOffset) > threshold;
    const flicked = Math.abs(velocity) > 0.3;

    if (swipedFar || flicked) {
      if (dragOffset < 0 || velocity < -0.3) next();
      else prev();
    }

    setDragOffset(0);
    setIsDragging(false);
  };

  // ── Trackpad / mouse wheel horizontal scrolling ──
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const WHEEL_THRESHOLD = 80;
    const onWheel = (e: WheelEvent) => {
      const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : 0;
      if (dx === 0) return;
      e.preventDefault();
      wheelDelta.current += dx;
      if (wheelTimeout.current) clearTimeout(wheelTimeout.current);
      wheelTimeout.current = setTimeout(() => {
        wheelDelta.current = 0;
      }, 200);
      if (Math.abs(wheelDelta.current) >= WHEEL_THRESHOLD) {
        if (wheelDelta.current > 0) next();
        else prev();
        wheelDelta.current = 0;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [next, prev]);

  // ── Layout calculations ──
  const cardWidthPercent = 100 / cardsPerView;
  const gapOffset = (GAP * (cardsPerView - 1)) / cardsPerView;
  const translateX = -(position * cardWidthPercent);
  const gapTranslate = position * GAP;
  const dragPx = isDragging ? dragOffset : 0;

  const arrowStyle: React.CSSProperties = {
    background: "rgba(22, 27, 34, 0.9)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    boxShadow: "0 4px 16px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.04) inset",
  };

  return (
    <section
      ref={containerRef}
      className="group/carousel"
      aria-label="Feature carousel"
      aria-roledescription="carousel"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <div className="flex items-center">
        {/* Prev Arrow */}
        <div className="hidden lg:flex shrink-0 w-14 items-center justify-center">
          <button
            type="button"
            onClick={prev}
            aria-label="Previous features"
            className="w-10 h-10 rounded-full flex items-center justify-center opacity-0 group-hover/carousel:opacity-100 transition-all duration-200 cursor-pointer hover:scale-110"
            style={arrowStyle}
          >
            <svg
              className="w-4 h-4 text-[#6b7280] group-hover/carousel:text-[#d1d5db] transition-colors"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        </div>

        {/* Card Track */}
        <div ref={trackRef} className="overflow-hidden flex-1 min-w-0">
          <div
            className="flex"
            style={{
              gap: `${GAP}px`,
              transform: `translateX(calc(${translateX}% - ${gapTranslate}px + ${dragPx}px))`,
              transition:
                isDragging || !animate || prefersReducedMotion
                  ? "none"
                  : `transform ${TRANSITION_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`,
            }}
          >
            {extendedFeatures.map((feature, i) => (
              <div
                key={i}
                className="feature-card group relative p-6 rounded-xl border border-border bg-card/60 backdrop-blur-sm hover:-translate-y-1 transition-all duration-200"
                data-color={feature.color}
                style={{
                  flexShrink: 0,
                  width: `calc(${cardWidthPercent}% - ${gapOffset}px)`,
                }}
              >
                <IconBox html={feature.icon} color={feature.color} />

                <div className="flex items-center gap-2 mb-2">
                  <h3 className="text-base font-semibold text-foreground">{feature.title}</h3>
                  {feature.claudeOnly && (
                    <span
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium border"
                      style={{
                        backgroundColor: "rgba(245, 158, 11, 0.08)",
                        color: "rgba(245, 158, 11, 0.7)",
                        borderColor: "rgba(245, 158, 11, 0.15)",
                      }}
                    >
                      <svg className="w-2 h-2" fill="currentColor" viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="4" />
                      </svg>
                      Claude Code
                    </span>
                  )}
                </div>

                <p className="text-sm text-muted leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Next Arrow */}
        <div className="hidden lg:flex shrink-0 w-14 items-center justify-center">
          <button
            type="button"
            onClick={next}
            aria-label="Next features"
            className="w-10 h-10 rounded-full flex items-center justify-center opacity-0 group-hover/carousel:opacity-100 transition-all duration-200 cursor-pointer hover:scale-110"
            style={arrowStyle}
          >
            <svg
              className="w-4 h-4 text-[#6b7280] group-hover/carousel:text-[#d1d5db] transition-colors"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Dots */}
      <div
        className="flex items-center justify-center gap-1.5 mt-8"
        role="tablist"
        aria-label="Slide controls"
      >
        {Array.from({ length: total }, (_, i) => (
          <button
            type="button"
            key={i}
            onClick={() => goTo(i)}
            role="tab"
            aria-selected={i === currentIndex}
            aria-label={`Go to slide ${i + 1}`}
            className="transition-all duration-300 rounded-full cursor-pointer"
            style={{
              width: i === currentIndex ? 24 : 8,
              height: 8,
              backgroundColor: i === currentIndex ? "#06b6d4" : "rgba(255, 255, 255, 0.1)",
              border: "none",
              padding: 0,
            }}
          />
        ))}
      </div>

      {/* Screen reader announcement for slide changes */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        Showing slide {currentIndex + 1} of {total}: {features[currentIndex]?.title}
      </div>
    </section>
  );
}
