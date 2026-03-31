import { describe, expect, it } from "vitest";
import { svgPathProperties } from "svg-path-properties";
import { createDefaultBubble } from "../../src/domain/defaults";
import { BUBBLE_TYPE_VALUES } from "../../src/domain/schema";
import { getBubbleBodyPath, getBubbleTailPath } from "../../src/ui/bubbleShapes";

const REGULAR_TAIL_TYPES = BUBBLE_TYPE_VALUES.filter(
  (type) => type !== "thought" && type !== "explosion",
);

const parseTailBaseEndpoints = (pathData: string) => {
  const numbers = pathData
    .match(/-?\d*\.?\d+/g)
    ?.map((value) => Number.parseFloat(value))
    .filter((value) => Number.isFinite(value));

  if (!numbers || numbers.length < 6) {
    throw new Error(`Unexpected tail path data: ${pathData}`);
  }

  return {
    left: { x: numbers[0], y: numbers[1] },
    right: { x: numbers[4], y: numbers[5] },
  };
};

const getMinimumDistanceToPath = (
  pathData: string,
  point: { x: number; y: number },
) => {
  const properties = new svgPathProperties(pathData);
  const totalLength = properties.getTotalLength();
  if (!Number.isFinite(totalLength) || totalLength <= 0.001) {
    return Number.POSITIVE_INFINITY;
  }

  const sampleCount = Math.max(240, Math.ceil(totalLength / 1.5));
  let minimumDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index <= sampleCount; index += 1) {
    const position = (index / sampleCount) * totalLength;
    const sampled = properties.getPointAtLength(position);
    const distance = Math.hypot(sampled.x - point.x, sampled.y - point.y);
    if (distance < minimumDistance) {
      minimumDistance = distance;
    }
  }
  return minimumDistance;
};

describe("bubble tail/body intersection", () => {
  it.each(REGULAR_TAIL_TYPES)(
    "keeps tail base endpoints on the body outline for %s",
    (bubbleType) => {
      const bubble = createDefaultBubble({
        bubbleType,
      });
      const bodyPath = getBubbleBodyPath(bubble);
      const tailPath = getBubbleTailPath(bubble);
      const endpoints = parseTailBaseEndpoints(tailPath);

      expect(getMinimumDistanceToPath(bodyPath, endpoints.left)).toBeLessThanOrEqual(2.1);
      expect(getMinimumDistanceToPath(bodyPath, endpoints.right)).toBeLessThanOrEqual(2.1);
    },
  );
});
