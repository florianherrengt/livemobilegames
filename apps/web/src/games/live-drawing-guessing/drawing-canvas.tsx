import { Box } from "@mui/material";
import {
  LIVE_DRAWING_GUESSING_CONSTANTS,
  type LiveDrawingStrokeState,
} from "@phone-party/protocol";
import { useCallback, useEffect, useRef } from "react";

import { primeGameFeedback } from "../../feedback.js";

const SEND_POINT_THRESHOLD = 8;
const SEND_INTERVAL_MS = 40;

export interface StrokeBatch {
  strokeId: string;
  color: string;
  points: number[];
  complete: boolean;
}

export function DrawingCanvas({
  strokes,
  interactive,
  ariaLabel,
  testId,
  color,
  phase,
  turnNumber,
  onStrokeBatch,
}: {
  strokes: readonly LiveDrawingStrokeState[];
  interactive: boolean;
  ariaLabel: string;
  testId?: string;
  color: string;
  phase?: string;
  turnNumber?: number;
  onStrokeBatch: (batch: StrokeBatch) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;
  const colorRef = useRef(color);
  colorRef.current = color;
  const onStrokeBatchRef = useRef(onStrokeBatch);
  onStrokeBatchRef.current = onStrokeBatch;
  const activePointerRef = useRef<number | null>(null);
  const draftRef = useRef<{
    strokeId: string;
    color: string;
    points: number[];
    sentCount: number;
    lastSentAt: number;
  } | null>(null);
  const interactiveRef = useRef(interactive);
  interactiveRef.current = interactive;

  useEffect(() => {
    if (!interactive) {
      // A transport drop can disable the canvas without a browser
      // pointer-cancel event. Discard the unsent local gesture so a fresh
      // pointer can start drawing after reconnection.
      activePointerRef.current = null;
      draftRef.current = null;
    }
  }, [interactive]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) {
      return;
    }
    let frame = 0;
    const updateSize = (): void => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
    };
    const draw = (): void => {
      const ctx = canvas.getContext("2d");
      const rect = canvas.getBoundingClientRect();
      if (ctx && rect.width > 0 && rect.height > 0) {
        const dpr = window.devicePixelRatio || 1;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, rect.width, rect.height);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, rect.width, rect.height);
        const lineWidth =
          (LIVE_DRAWING_GUESSING_CONSTANTS.BRUSH_WIDTH /
            LIVE_DRAWING_GUESSING_CONSTANTS.CANVAS_SIZE) *
          rect.width;
        for (const stroke of strokesRef.current) {
          drawStroke(ctx, stroke, rect.width, rect.height, lineWidth);
        }
        const draft = draftRef.current;
        if (draft) {
          drawPoints(ctx, draft.color, draft.points, rect.width, rect.height, lineWidth);
        }
      }
      frame = window.requestAnimationFrame(draw);
    };
    updateSize();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(updateSize);
      observer.observe(container);
      frame = window.requestAnimationFrame(draw);
      return () => {
        window.cancelAnimationFrame(frame);
        observer.disconnect();
      };
    }
    window.addEventListener("resize", updateSize);
    frame = window.requestAnimationFrame(draw);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateSize);
    };
  }, []);

  const pointFromEvent = useCallback((event: React.PointerEvent): [number, number] => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) {
      return [0, 0];
    }
    const size = LIVE_DRAWING_GUESSING_CONSTANTS.CANVAS_SIZE;
    const x = Math.round(((event.clientX - rect.left) / rect.width) * size);
    const y = Math.round(((event.clientY - rect.top) / rect.height) * size);
    return [Math.max(0, Math.min(size, x)), Math.max(0, Math.min(size, y))];
  }, []);

  const sendBatch = useCallback((complete: boolean): void => {
    const draft = draftRef.current;
    if (!draft) {
      return;
    }
    const points = draft.points.slice(draft.sentCount);
    if (points.length === 0 && !complete) {
      return;
    }
    onStrokeBatchRef.current({
      strokeId: draft.strokeId,
      color: draft.color,
      points,
      complete,
    });
    draft.sentCount = draft.points.length;
    draft.lastSentAt = Date.now();
  }, []);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>): void => {
      if (!interactiveRef.current || activePointerRef.current !== null) {
        // One finger only: additional touch points are ignored.
        return;
      }
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }
      event.preventDefault();
      void primeGameFeedback();
      activePointerRef.current = event.pointerId;
      const [x, y] = pointFromEvent(event);
      draftRef.current = {
        strokeId: generateStrokeId(),
        color: colorRef.current,
        points: [x, y],
        sentCount: 0,
        lastSentAt: 0,
      };
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic or unsupported pointers may not support capture.
      }
    },
    [pointFromEvent],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>): void => {
      const draft = draftRef.current;
      if (!interactiveRef.current || event.pointerId !== activePointerRef.current || !draft) {
        return;
      }
      event.preventDefault();
      const [x, y] = pointFromEvent(event);
      draft.points.push(x, y);
      const pending = draft.points.length - draft.sentCount;
      if (
        pending >= SEND_POINT_THRESHOLD ||
        (Date.now() - draft.lastSentAt >= SEND_INTERVAL_MS && pending >= 2)
      ) {
        sendBatch(false);
      }
    },
    [pointFromEvent, sendBatch],
  );

  const finishStroke = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>): void => {
      if (!interactiveRef.current || event.pointerId !== activePointerRef.current) {
        return;
      }
      event.preventDefault();
      const [x, y] = pointFromEvent(event);
      const draft = draftRef.current;
      if (draft) {
        draft.points.push(x, y);
        sendBatch(true);
      }
      activePointerRef.current = null;
      draftRef.current = null;
    },
    [pointFromEvent, sendBatch],
  );

  return (
    <Box
      ref={containerRef}
      data-testid={testId}
      data-interactive={interactive}
      data-strokes={strokes.length}
      data-phase={phase}
      data-turn={turnNumber}
      sx={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        touchAction: "none",
        userSelect: "none",
        WebkitUserSelect: "none",
        overscrollBehavior: "none",
        bgcolor: "#ffffff",
        borderRadius: 1,
      }}
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={ariaLabel}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        onPointerDown={interactive ? handlePointerDown : undefined}
        onPointerMove={interactive ? handlePointerMove : undefined}
        onPointerUp={interactive ? finishStroke : undefined}
        onPointerCancel={interactive ? finishStroke : undefined}
        onContextMenu={(event) => event.preventDefault()}
      />
    </Box>
  );
}

function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: LiveDrawingStrokeState,
  width: number,
  height: number,
  lineWidth: number,
): void {
  drawPoints(ctx, stroke.color, stroke.points, width, height, lineWidth);
}

function drawPoints(
  ctx: CanvasRenderingContext2D,
  color: string,
  points: readonly number[],
  width: number,
  height: number,
  lineWidth: number,
): void {
  if (points.length < 2) {
    return;
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, lineWidth);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let index = 0; index < points.length; index += 2) {
    const x = ((points[index] ?? 0) / LIVE_DRAWING_GUESSING_CONSTANTS.CANVAS_SIZE) * width;
    const y = ((points[index + 1] ?? 0) / LIVE_DRAWING_GUESSING_CONSTANTS.CANVAS_SIZE) * height;
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
}

let strokeCounter = 0;

function generateStrokeId(): string {
  strokeCounter += 1;
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `stroke-${Date.now()}-${strokeCounter}`;
}
