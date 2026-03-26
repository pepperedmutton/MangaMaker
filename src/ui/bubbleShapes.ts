import { svgPathProperties } from "svg-path-properties";
import type { Bubble } from "../domain/schema";
import { getBubbleBasePoints } from "../domain/helpers";

type PathPoint = {
  x: number;
  y: number;
};

type OutlinePoint = [number, number];

const OUTLINE_SAMPLE_STEP = 2;
const OUTLINE_MIN_SAMPLES = 72;
const OUTLINE_MAX_SAMPLES = 960;
const OUTLINE_POINT_EPSILON = 0.2;

const toSquaredDistance = (left: OutlinePoint, right: OutlinePoint) => {
  const deltaX = left[0] - right[0];
  const deltaY = left[1] - right[1];
  return deltaX * deltaX + deltaY * deltaY;
};

const normalizeRing = (ring: OutlinePoint[]) => {
  const cleaned: OutlinePoint[] = [];
  const epsilonSquared = OUTLINE_POINT_EPSILON * OUTLINE_POINT_EPSILON;
  for (const point of ring) {
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
      continue;
    }
    const candidate: OutlinePoint = [point[0], point[1]];
    if (cleaned.length === 0) {
      cleaned.push(candidate);
      continue;
    }
    if (toSquaredDistance(cleaned[cleaned.length - 1], candidate) > epsilonSquared) {
      cleaned.push(candidate);
    }
  }
  if (
    cleaned.length >= 2 &&
    toSquaredDistance(cleaned[0], cleaned[cleaned.length - 1]) <= epsilonSquared
  ) {
    cleaned.pop();
  }
  return cleaned;
};

const sampleClosedPathRing = (pathData: string): OutlinePoint[] => {
  try {
    const properties = new svgPathProperties(pathData);
    const totalLength = properties.getTotalLength();
    if (!Number.isFinite(totalLength) || totalLength <= 0.001) {
      return [];
    }
    const sampleCount = Math.round(
      Math.max(
        OUTLINE_MIN_SAMPLES,
        Math.min(OUTLINE_MAX_SAMPLES, Math.ceil(totalLength / OUTLINE_SAMPLE_STEP)),
      ),
    );
    const positions = new Set<number>();
    for (let index = 0; index < sampleCount; index += 1) {
      positions.add((index / sampleCount) * totalLength);
    }
    let cursor = 0;
    for (const part of properties.getParts()) {
      positions.add(cursor);
      cursor += part.length;
      positions.add(cursor);
    }
    return normalizeRing(
      [...positions]
        .filter((value) => Number.isFinite(value) && value >= 0 && value <= totalLength)
        .sort((left, right) => left - right)
        .map((distance) => {
          const point = properties.getPointAtLength(distance);
          return [point.x, point.y] as OutlinePoint;
        }),
    );
  } catch {
    return [];
  }
};

const buildPathFromRing = (ring: OutlinePoint[]) => {
  if (ring.length < 3) {
    return "";
  }
  return ring
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point[0]} ${point[1]}`)
    .join(" ")
    .concat(" Z");
};

const toOutlinePoint = (x: number, y: number): OutlinePoint => [x, y];

const getNearestRingIndex = (ring: OutlinePoint[], point: OutlinePoint) => {
  let nearestIndex = -1;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < ring.length; index += 1) {
    const distance = toSquaredDistance(ring[index], point);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  }
  return nearestIndex;
};

const getForwardDistance = (ringLength: number, startIndex: number, endIndex: number) =>
  endIndex >= startIndex ? endIndex - startIndex : ringLength - startIndex + endIndex;

const collectForwardArc = (
  ring: OutlinePoint[],
  startIndex: number,
  endIndex: number,
  startPoint: OutlinePoint,
  endPoint: OutlinePoint,
) => {
  const points: OutlinePoint[] = [startPoint];
  if (ring.length === 0) {
    return points;
  }
  let index = startIndex;
  while (true) {
    index = (index + 1) % ring.length;
    if (index === endIndex) {
      break;
    }
    points.push(ring[index]);
  }
  points.push(endPoint);
  return points;
};

const buildPathFromPoints = (points: PathPoint[]) => {
  if (points.length === 0) {
    return "";
  }
  return `${points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ")} Z`;
};

const buildSmoothClosedPath = (
  points: PathPoint[],
  smoothness: number,
  pointSmoothness?: number[],
) => {
  if (points.length < 3) {
    return buildPathFromPoints(points);
  }
  const clampedSmoothness = Math.max(0, Math.min(1, smoothness));
  const hasPerPointSmoothness = pointSmoothness && pointSmoothness.length > 0;
  const getCornerSmoothness = (index: number) => {
    if (!hasPerPointSmoothness) {
      return clampedSmoothness;
    }
    const raw = pointSmoothness[index] ?? pointSmoothness[pointSmoothness.length - 1] ?? clampedSmoothness;
    return Math.max(0, Math.min(1, raw));
  };
  if (
    clampedSmoothness <= 0.01 &&
    (!hasPerPointSmoothness || pointSmoothness.every((value) => Math.max(0, Math.min(1, value)) <= 0.01))
  ) {
    return buildPathFromPoints(points);
  }

  const corners = points.map((point, index) => {
    const radiusRatio = 0.34 * getCornerSmoothness(index);
    const previous = points[(index - 1 + points.length) % points.length];
    const next = points[(index + 1) % points.length];
    return {
      point,
      inPoint: {
        x: point.x + (previous.x - point.x) * radiusRatio,
        y: point.y + (previous.y - point.y) * radiusRatio,
      },
      outPoint: {
        x: point.x + (next.x - point.x) * radiusRatio,
        y: point.y + (next.y - point.y) * radiusRatio,
      },
    };
  });

  let path = `M ${corners[0].outPoint.x} ${corners[0].outPoint.y} `;
  for (let index = 1; index <= corners.length; index += 1) {
    const corner = corners[index % corners.length];
    path +=
      `L ${corner.inPoint.x} ${corner.inPoint.y} ` +
      `Q ${corner.point.x} ${corner.point.y} ${corner.outPoint.x} ${corner.outPoint.y} `;
  }
  return `${path}Z`;
};

const buildRoundRectPath = (width: number, height: number, radius: number) => {
  const r = Math.max(0, Math.min(radius, width * 0.5, height * 0.5));
  return (
    `M ${r} 0 ` +
    `L ${width - r} 0 ` +
    `Q ${width} 0 ${width} ${r} ` +
    `L ${width} ${height - r} ` +
    `Q ${width} ${height} ${width - r} ${height} ` +
    `L ${r} ${height} ` +
    `Q 0 ${height} 0 ${height - r} ` +
    `L 0 ${r} ` +
    `Q 0 0 ${r} 0 Z`
  );
};

const buildRegularPolygonPath = (
  sides: number,
  width: number,
  height: number,
  rotation = -Math.PI / 2,
) => {
  const cx = width * 0.5;
  const cy = height * 0.5;
  const radiusX = width * 0.48;
  const radiusY = height * 0.48;
  const points: PathPoint[] = [];

  for (let index = 0; index < sides; index += 1) {
    const angle = rotation + (index / sides) * Math.PI * 2;
    points.push({
      x: cx + Math.cos(angle) * radiusX,
      y: cy + Math.sin(angle) * radiusY,
    });
  }

  return buildPathFromPoints(points);
};

const buildWavyEllipsePath = (
  width: number,
  height: number,
  segments: number,
  amplitude: number,
  lobes: number,
) => {
  const cx = width * 0.5;
  const cy = height * 0.5;
  const baseRadiusX = width * 0.45;
  const baseRadiusY = height * 0.45;
  const points: PathPoint[] = [];

  for (let index = 0; index < segments; index += 1) {
    const t = (index / segments) * Math.PI * 2;
    const wave = 1 + Math.sin(t * lobes) * amplitude;
    points.push({
      x: cx + Math.cos(t) * baseRadiusX * wave,
      y: cy + Math.sin(t) * baseRadiusY * wave,
    });
  }

  return buildPathFromPoints(points);
};

// Generate bubble body path based on type
export const getBubbleBodyPath = (
  bubble: Bubble,
  liveSpikePositions?: Array<{ x: number; y: number }> | null,
): string => {
  const w = bubble.width;
  const h = bubble.height;
  const r = bubble.cornerRadius;

  switch (bubble.bubbleType) {
    case "round": {
      const cr = Math.min(r, w * 0.3, h * 0.3);
      return buildRoundRectPath(w, h, cr);
    }

    case "ellipse":
      return `M ${w * 0.5} 0 A ${w * 0.5} ${h * 0.5} 0 1 1 ${w * 0.5} ${h} A ${w * 0.5} ${h * 0.5} 0 1 1 ${w * 0.5} 0 Z`;

    case "cloud": {
      const b = bubble.bumpiness;
      const bh = h * (0.1 + b * 0.15);
      return (
        `M ${w * 0.25} ${bh} ` +
        `Q ${w * 0.05} 0 ${w * 0.3} ${bh * 0.5} ` +
        `Q ${w * 0.45} 0 ${w * 0.5} ${bh * 0.8} ` +
        `Q ${w * 0.55} 0 ${w * 0.7} ${bh * 0.5} ` +
        `Q ${w * 0.95} 0 ${w * 0.75} ${bh} ` +
        `Q ${w} ${h * 0.3} ${w * 0.8} ${h * 0.5} ` +
        `Q ${w * 0.9} ${h * 0.8} ${w * 0.65} ${h * 0.85} ` +
        `Q ${w * 0.5} ${h} ${w * 0.35} ${h * 0.85} ` +
        `Q ${w * 0.1} ${h * 0.8} ${w * 0.2} ${h * 0.5} ` +
        `Q 0 ${h * 0.3} ${w * 0.25} ${bh} Z`
      );
    }

    case "square":
      return `M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z`;

    case "roundedSquare": {
      const rr = Math.min(r * 2, w * 0.4, h * 0.4);
      return buildRoundRectPath(w, h, rr);
    }

    case "oval":
      return `M ${w * 0.5} 0 C ${w * 0.85} 0 ${w} ${h * 0.25} ${w} ${h * 0.5} C ${w} ${h * 0.75} ${w * 0.85} ${h} ${w * 0.5} ${h} C ${w * 0.15} ${h} 0 ${h * 0.75} 0 ${h * 0.5} C 0 ${h * 0.25} ${w * 0.15} 0 ${w * 0.5} 0 Z`;

    case "explosion": {
      const spikes = bubble.spikeCount;
      const baseDepth = bubble.spikeDepth;
      const outerRadius = Math.min(w, h) * 0.48;
      const individualDepths = bubble.spikeDepths || [];
      const individualPositions = bubble.spikePositions || [];
      const useLive = liveSpikePositions && liveSpikePositions.length === spikes;
      let path = "";

      for (let i = 0; i < spikes * 2; i += 1) {
        const angle = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
        let px: number;
        let py: number;
        if (i % 2 === 0) {
          const spikeIndex = i / 2;
          if (useLive) {
            px = liveSpikePositions[spikeIndex].x;
            py = liveSpikePositions[spikeIndex].y;
          } else if (individualPositions[spikeIndex]) {
            px = individualPositions[spikeIndex].x;
            py = individualPositions[spikeIndex].y;
          } else {
            const spikeDepth = individualDepths[spikeIndex] ?? baseDepth;
            const radius = outerRadius * (0.3 + spikeDepth * 0.7);
            px = w * 0.5 + Math.cos(angle) * radius;
            py = h * 0.5 + Math.sin(angle) * radius;
          }
        } else {
          const radius = outerRadius * 0.25;
          px = w * 0.5 + Math.cos(angle) * radius;
          py = h * 0.5 + Math.sin(angle) * radius;
        }
        path += `${i === 0 ? "M" : "L"} ${px} ${py} `;
      }
      return `${path}Z`;
    }

    case "thought": {
      return (
        `M ${w * 0.25} ${h * 0.2} Q ${w * 0.1} ${h * 0.1} ${w * 0.25} 0 ` +
        `Q ${w * 0.4} 0 ${w * 0.5} ${h * 0.08} ` +
        `Q ${w * 0.6} 0 ${w * 0.75} 0 ` +
        `Q ${w * 0.9} ${h * 0.1} ${w * 0.8} ${h * 0.25} ` +
        `Q ${w * 0.95} ${h * 0.4} ${w * 0.85} ${h * 0.55} ` +
        `Q ${w * 0.9} ${h * 0.75} ${w * 0.7} ${h * 0.8} ` +
        `Q ${w * 0.55} ${h * 0.95} ${w * 0.4} ${h * 0.85} ` +
        `Q ${w * 0.2} ${h * 0.9} ${w * 0.15} ${h * 0.7} ` +
        `Q ${w * 0.05} ${h * 0.5} ${w * 0.2} ${h * 0.35} ` +
        `Q ${w * 0.05} ${h * 0.25} ${w * 0.25} ${h * 0.2} Z`
      );
    }

    case "jagged": {
      const j = bubble.jaggedness;
      const segX = w / j;
      const segY = h / j;
      let path = "M 0 0";
      for (let i = 1; i <= j; i += 1) {
        const zigzag = i % 2 === 1 ? -h * 0.05 : h * 0.05;
        path += ` L ${i * segX - segX * 0.5} ${zigzag} L ${i * segX} 0`;
      }
      for (let i = 1; i <= j; i += 1) {
        const zigzag = i % 2 === 1 ? w * 0.05 : -w * 0.05;
        path += ` L ${w + zigzag} ${i * segY - segY * 0.5} L ${w} ${i * segY}`;
      }
      for (let i = j - 1; i >= 0; i -= 1) {
        const zigzag = i % 2 === 0 ? h * 0.05 : -h * 0.05;
        path += ` L ${i * segX + segX * 0.5} ${h + zigzag} L ${i * segX} ${h}`;
      }
      for (let i = j - 1; i >= 0; i -= 1) {
        const zigzag = i % 2 === 0 ? -w * 0.05 : w * 0.05;
        path += ` L ${zigzag} ${i * segY + segY * 0.5} L 0 ${i * segY}`;
      }
      return `${path} Z`;
    }

    case "bubbleRound": {
      const radius = Math.min(w, h) * 0.5;
      const cx = w * 0.5;
      const cy = h * 0.5;
      return `M ${cx} ${cy - radius} A ${radius} ${radius} 0 1 1 ${cx} ${cy + radius} A ${radius} ${radius} 0 1 1 ${cx} ${cy - radius} Z`;
    }

    case "whisper":
      return buildWavyEllipsePath(w, h, 30, 0.025, 5);

    case "scream": {
      const points: PathPoint[] = [];
      const spikes = 16;
      const cx = w * 0.5;
      const cy = h * 0.5;
      const baseRadius = Math.min(w, h) * 0.5;
      for (let index = 0; index < spikes * 2; index += 1) {
        const angle = (index / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
        const tipScale = index % 2 === 0 ? 0.48 + Math.sin(index * 1.31) * 0.06 : 0.26;
        const radius = baseRadius * tipScale;
        points.push({
          x: cx + Math.cos(angle) * radius,
          y: cy + Math.sin(angle) * radius,
        });
      }
      return buildPathFromPoints(points);
    }

    case "burstSoft":
      return buildWavyEllipsePath(w, h, 40, 0.09, 6);

    case "hexagon":
      return buildRegularPolygonPath(6, w, h);

    case "octagon":
      return buildRegularPolygonPath(8, w, h);

    case "diamond":
      return buildPathFromPoints([
        { x: w * 0.5, y: 0 },
        { x: w, y: h * 0.5 },
        { x: w * 0.5, y: h },
        { x: 0, y: h * 0.5 },
      ]);

    case "heart":
      return (
        `M ${w * 0.5} ${h * 0.92} ` +
        `C ${w * 0.08} ${h * 0.66} ${w * 0.02} ${h * 0.38} ${w * 0.24} ${h * 0.24} ` +
        `C ${w * 0.38} ${h * 0.1} ${w * 0.5} ${h * 0.18} ${w * 0.5} ${h * 0.3} ` +
        `C ${w * 0.5} ${h * 0.18} ${w * 0.62} ${h * 0.1} ${w * 0.76} ${h * 0.24} ` +
        `C ${w * 0.98} ${h * 0.38} ${w * 0.92} ${h * 0.66} ${w * 0.5} ${h * 0.92} Z`
      );

    case "bracket":
      return buildPathFromPoints([
        { x: w * 0.12, y: 0 },
        { x: w * 0.88, y: 0 },
        { x: w, y: h * 0.2 },
        { x: w, y: h * 0.4 },
        { x: w * 0.86, y: h * 0.5 },
        { x: w, y: h * 0.6 },
        { x: w, y: h * 0.8 },
        { x: w * 0.88, y: h },
        { x: w * 0.12, y: h },
        { x: 0, y: h * 0.8 },
        { x: 0, y: h * 0.6 },
        { x: w * 0.14, y: h * 0.5 },
        { x: 0, y: h * 0.4 },
        { x: 0, y: h * 0.2 },
      ]);

    case "caption":
      return buildPathFromPoints([
        { x: w * 0.08, y: 0 },
        { x: w, y: 0 },
        { x: w, y: h * 0.82 },
        { x: w * 0.92, y: h },
        { x: 0, y: h },
        { x: 0, y: h * 0.18 },
      ]);

    case "speed":
      return buildPathFromPoints([
        { x: w * 0.12, y: 0 },
        { x: w, y: 0 },
        { x: w * 0.88, y: h },
        { x: 0, y: h },
      ]);

    case "cloudDense":
      return buildWavyEllipsePath(w, h, 48, 0.14, 8);

    case "balloonTall":
      return (
        `M ${w * 0.5} 0 ` +
        `C ${w * 0.84} ${h * 0.02} ${w} ${h * 0.28} ${w} ${h * 0.54} ` +
        `C ${w} ${h * 0.82} ${w * 0.78} ${h} ${w * 0.5} ${h} ` +
        `C ${w * 0.22} ${h} 0 ${h * 0.82} 0 ${h * 0.54} ` +
        `C 0 ${h * 0.28} ${w * 0.16} ${h * 0.02} ${w * 0.5} 0 Z`
      );

    case "balloonWide":
      return buildRoundRectPath(w, h, Math.min(h * 0.48, w * 0.32));

    case "wave": {
      const points: PathPoint[] = [];
      const waves = 6;
      for (let i = 0; i <= waves; i += 1) {
        points.push({
          x: (i / waves) * w,
          y: i % 2 === 0 ? h * 0.04 : -h * 0.02,
        });
      }
      for (let i = 1; i <= waves; i += 1) {
        points.push({
          x: w + (i % 2 === 0 ? w * 0.04 : -w * 0.02),
          y: (i / waves) * h,
        });
      }
      for (let i = waves - 1; i >= 0; i -= 1) {
        points.push({
          x: (i / waves) * w,
          y: h + (i % 2 === 0 ? h * 0.04 : -h * 0.02),
        });
      }
      for (let i = waves - 1; i >= 1; i -= 1) {
        points.push({
          x: i % 2 === 0 ? w * 0.04 : -w * 0.02,
          y: (i / waves) * h,
        });
      }
      return buildPathFromPoints(points);
    }

    case "rough": {
      const points: PathPoint[] = [];
      const steps = 18;
      for (let index = 0; index < steps; index += 1) {
        const angle = (index / steps) * Math.PI * 2 - Math.PI / 2;
        const jitter = 1 + Math.sin(index * 2.3) * 0.12 + Math.cos(index * 1.7) * 0.06;
        points.push({
          x: w * 0.5 + Math.cos(angle) * w * 0.45 * jitter,
          y: h * 0.5 + Math.sin(angle) * h * 0.45 * jitter,
        });
      }
      return buildPathFromPoints(points);
    }

    case "droplet":
      return (
        `M ${w * 0.5} 0 ` +
        `C ${w * 0.82} ${h * 0.12} ${w} ${h * 0.42} ${w * 0.5} ${h} ` +
        `C 0 ${h * 0.42} ${w * 0.18} ${h * 0.12} ${w * 0.5} 0 Z`
      );

    case "arrow":
      return buildPathFromPoints([
        { x: w * 0.04, y: h * 0.24 },
        { x: w * 0.64, y: h * 0.24 },
        { x: w * 0.64, y: 0 },
        { x: w, y: h * 0.5 },
        { x: w * 0.64, y: h },
        { x: w * 0.64, y: h * 0.76 },
        { x: w * 0.04, y: h * 0.76 },
      ]);

    case "pinched":
      return (
        `M ${w * 0.5} 0 ` +
        `C ${w * 0.82} 0 ${w} ${h * 0.2} ${w * 0.78} ${h * 0.5} ` +
        `C ${w} ${h * 0.8} ${w * 0.82} ${h} ${w * 0.5} ${h} ` +
        `C ${w * 0.18} ${h} 0 ${h * 0.8} ${w * 0.22} ${h * 0.5} ` +
        `C 0 ${h * 0.2} ${w * 0.18} 0 ${w * 0.5} 0 Z`
      );

    case "doubleOutline":
      return buildRoundRectPath(w, h, Math.min(r * 1.2, w * 0.32, h * 0.32));

    case "electric":
      return buildPathFromPoints([
        { x: w * 0.08, y: 0 },
        { x: w * 0.32, y: h * 0.08 },
        { x: w * 0.54, y: 0 },
        { x: w * 0.78, y: h * 0.12 },
        { x: w, y: h * 0.04 },
        { x: w * 0.9, y: h * 0.34 },
        { x: w, y: h * 0.56 },
        { x: w * 0.86, y: h * 0.76 },
        { x: w * 0.94, y: h },
        { x: w * 0.62, y: h * 0.9 },
        { x: w * 0.42, y: h },
        { x: w * 0.2, y: h * 0.88 },
        { x: 0, y: h },
        { x: w * 0.1, y: h * 0.62 },
        { x: w * 0.02, y: h * 0.42 },
        { x: w * 0.14, y: h * 0.2 },
      ]);

    case "custom": {
      const points = bubble.customPoints;
      if (!points || points.length < 3) {
        return `M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z`;
      }
      const normalizedPoints = points.map((point) => ({
        x: Math.max(0, Math.min(w, point.x)),
        y: Math.max(0, Math.min(h, point.y)),
      }));
      const pointSmoothness =
        bubble.customPointSmoothness.length > 0 ? bubble.customPointSmoothness : undefined;
      return buildSmoothClosedPath(normalizedPoints, bubble.customSmoothness, pointSmoothness);
    }

    default:
      return `M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z`;
  }
};

// Generate tail path for bubble (separate from body)
export const getBubbleTailPath = (bubble: Bubble): string => {
  const base = getBubbleBasePoints(bubble);

  return (
    `M ${base.left.x - bubble.x} ${base.left.y - bubble.y} ` +
    `L ${bubble.tailTip.x - bubble.x} ${bubble.tailTip.y - bubble.y} ` +
    `L ${base.right.x - bubble.x} ${base.right.y - bubble.y} Z`
  );
};

// Tail outer contour only (no closing edge to bubble body), used to avoid an inner seam.
export const getBubbleTailStrokePath = (bubble: Bubble): string => {
  const base = getBubbleBasePoints(bubble);
  return (
    `M ${base.left.x - bubble.x} ${base.left.y - bubble.y} ` +
    `L ${bubble.tailTip.x - bubble.x} ${bubble.tailTip.y - bubble.y} ` +
    `L ${base.right.x - bubble.x} ${base.right.y - bubble.y}`
  );
};

export const getBubbleRegularTailStrokeOutlinePath = (
  bubble: Bubble,
  liveSpikePositions?: Array<{ x: number; y: number }> | null,
): string => {
  if (!bubble.showTail || bubble.bubbleType === "thought" || bubble.bubbleType === "explosion") {
    return getBubbleBodyPath(bubble, liveSpikePositions);
  }

  const bodyRing = sampleClosedPathRing(getBubbleBodyPath(bubble, liveSpikePositions));
  if (bodyRing.length < 3) {
    return getBubbleBodyPath(bubble, liveSpikePositions);
  }
  const tailBase = getBubbleBasePoints(bubble);
  const leftPoint = toOutlinePoint(
    tailBase.left.x - bubble.x,
    tailBase.left.y - bubble.y,
  );
  const rightPoint = toOutlinePoint(
    tailBase.right.x - bubble.x,
    tailBase.right.y - bubble.y,
  );
  const tipPoint = toOutlinePoint(
    bubble.tailTip.x - bubble.x,
    bubble.tailTip.y - bubble.y,
  );
  const leftIndex = getNearestRingIndex(bodyRing, leftPoint);
  const rightIndex = getNearestRingIndex(bodyRing, rightPoint);
  if (leftIndex < 0 || rightIndex < 0 || leftIndex === rightIndex) {
    return getBubbleBodyPath(bubble, liveSpikePositions);
  }
  const forwardDistance = getForwardDistance(bodyRing.length, leftIndex, rightIndex);
  const backwardDistance = bodyRing.length - forwardDistance;
  const outlineRing =
    forwardDistance <= backwardDistance
      ? normalizeRing([
          ...collectForwardArc(bodyRing, rightIndex, leftIndex, rightPoint, leftPoint),
          tipPoint,
        ])
      : normalizeRing([
          ...collectForwardArc(bodyRing, leftIndex, rightIndex, leftPoint, rightPoint),
          tipPoint,
        ]);
  const outlinePath = buildPathFromRing(outlineRing);
  return outlinePath.length > 0 ? outlinePath : getBubbleBodyPath(bubble, liveSpikePositions);
};

// Generate thought bubble trailing circles
export const getThoughtCircles = (
  bubble: Bubble,
): Array<{ cx: number; cy: number; r: number }> => {
  const count = bubble.thoughtCircles;
  const circles: Array<{ cx: number; cy: number; r: number }> = [];

  const base = getBubbleBasePoints(bubble);
  const angleRad = ((bubble.tailBaseAngle + 180) * Math.PI) / 180;
  const distance = Math.min(bubble.width, bubble.height) * 0.12;

  for (let i = 0; i < count; i += 1) {
    const factor = (i + 1) / (count + 1);
    circles.push({
      cx: base.center.x - bubble.x + Math.cos(angleRad) * distance * (i + 1) * 1.5,
      cy: base.center.y - bubble.y + Math.sin(angleRad) * distance * (i + 1) * 1.5,
      r: 10 * (1 - factor * 0.6),
    });
  }

  return circles;
};

// Get explosion bubble spike control points for dragging
export const getExplosionSpikePoints = (
  bubble: Bubble,
  livePositions?: Array<{ x: number; y: number }> | null,
): Array<{ x: number; y: number; index: number; angle: number }> => {
  if (bubble.bubbleType !== "explosion") {
    return [];
  }

  if (livePositions && livePositions.length === bubble.spikeCount) {
    return livePositions.map((pos, i) => {
      const angle = (i / bubble.spikeCount) * Math.PI * 2 - Math.PI / 2;
      return {
        x: pos.x,
        y: pos.y,
        index: i,
        angle: (angle * 180) / Math.PI + 90,
      };
    });
  }

  const spikes = bubble.spikeCount;
  const w = bubble.width;
  const h = bubble.height;
  const outerRadius = Math.min(w, h) * 0.48;
  const baseDepth = bubble.spikeDepth;
  const individualDepths = bubble.spikeDepths || [];
  const individualPositions = bubble.spikePositions || [];

  const points: Array<{ x: number; y: number; index: number; angle: number }> = [];

  for (let i = 0; i < spikes; i += 1) {
    const angle = (i / spikes) * Math.PI * 2 - Math.PI / 2;

    if (individualPositions[i]) {
      points.push({
        x: individualPositions[i].x,
        y: individualPositions[i].y,
        index: i,
        angle: (angle * 180) / Math.PI + 90,
      });
    } else {
      const spikeDepth = individualDepths[i] ?? baseDepth;
      const radius = outerRadius * (0.3 + spikeDepth * 0.7);

      points.push({
        x: w * 0.5 + Math.cos(angle) * radius,
        y: h * 0.5 + Math.sin(angle) * radius,
        index: i,
        angle: (angle * 180) / Math.PI + 90,
      });
    }
  }

  return points;
};
