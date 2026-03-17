import type { Bubble } from "../domain/schema";
import { getBubbleBasePoints } from "../domain/helpers";

// Generate bubble body path based on type
export const getBubbleBodyPath = (bubble: Bubble): string => {
  const w = bubble.width;
  const h = bubble.height;
  const r = bubble.cornerRadius;

  switch (bubble.bubbleType) {
    case "round": {
      // Rounded rectangle - no tail notch in body
      const cr = Math.min(r, w * 0.3, h * 0.3);
      return `M ${cr} 0 L ${w - cr} 0 Q ${w} 0 ${w} ${cr} L ${w} ${h - cr} Q ${w} ${h} ${w - cr} ${h} L ${cr} ${h} Q 0 ${h} 0 ${h - cr} L 0 ${cr} Q 0 0 ${cr} 0 Z`;
    }

    case "ellipse":
      // Ellipse
      return `M ${w * 0.5} 0 A ${w * 0.5} ${h * 0.5} 0 1 1 ${w * 0.5} ${h} A ${w * 0.5} ${h * 0.5} 0 1 1 ${w * 0.5} 0 Z`;

    case "cloud": {
      // Cloud shape with adjustable bumpiness
      const b = bubble.bumpiness;
      const bh = h * (0.1 + b * 0.15); // bump height
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
      // Simple square
      return `M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z`;

    case "roundedSquare": {
      // Larger rounded corners
      const rr = Math.min(r * 2, w * 0.4, h * 0.4);
      return `M ${rr} 0 L ${w - rr} 0 Q ${w} 0 ${w} ${rr} L ${w} ${h - rr} Q ${w} ${h} ${w - rr} ${h} L ${rr} ${h} Q 0 ${h} 0 ${h - rr} L 0 ${rr} Q 0 0 ${rr} 0 Z`;
    }

    case "oval":
      // Tall oval
      return `M ${w * 0.5} 0 C ${w * 0.85} 0 ${w} ${h * 0.25} ${w} ${h * 0.5} C ${w} ${h * 0.75} ${w * 0.85} ${h} ${w * 0.5} ${h} C ${w * 0.15} ${h} 0 ${h * 0.75} 0 ${h * 0.5} C 0 ${h * 0.25} ${w * 0.15} 0 ${w * 0.5} 0 Z`;

    case "explosion": {
      // Star/explosion shape with individually adjustable spikes
      const spikes = bubble.spikeCount;
      const baseDepth = bubble.spikeDepth;
      const outerRadius = Math.min(w, h) * 0.48;
      const individualDepths = bubble.spikeDepths || [];
      let path = "";
      for (let i = 0; i < spikes * 2; i++) {
        const angle = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
        let radius: number;
        if (i % 2 === 0) {
          // Outer point (spike tip)
          const spikeIndex = i / 2;
          const spikeDepth = individualDepths[spikeIndex] ?? baseDepth;
          radius = outerRadius * (0.3 + spikeDepth * 0.7);
        } else {
          // Inner point (valley)
          radius = outerRadius * 0.25;
        }
        const x = w * 0.5 + Math.cos(angle) * radius;
        const y = h * 0.5 + Math.sin(angle) * radius;
        path += (i === 0 ? "M " : "L ") + `${x} ${y} `;
      }
      path += "Z";
      return path;
    }

    case "thought": {
      // Thought bubble - main cloud body
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
      // Jagged/sharp edges with adjustable jaggedness
      const j = bubble.jaggedness;
      const segX = w / j;
      const segY = h / j;
      let path = `M 0 0`;
      // Top edge
      for (let i = 1; i <= j; i++) {
        const zigzag = i % 2 === 1 ? -h * 0.05 : h * 0.05;
        path += ` L ${i * segX - segX * 0.5} ${zigzag} L ${i * segX} 0`;
      }
      // Right edge
      for (let i = 1; i <= j; i++) {
        const zigzag = i % 2 === 1 ? w * 0.05 : -w * 0.05;
        path += ` L ${w + zigzag} ${i * segY - segY * 0.5} L ${w} ${i * segY}`;
      }
      // Bottom edge
      for (let i = j - 1; i >= 0; i--) {
        const zigzag = i % 2 === 0 ? h * 0.05 : -h * 0.05;
        path += ` L ${i * segX + segX * 0.5} ${h + zigzag} L ${i * segX} ${h}`;
      }
      // Left edge
      for (let i = j - 1; i >= 0; i--) {
        const zigzag = i % 2 === 0 ? -w * 0.05 : w * 0.05;
        path += ` L ${zigzag} ${i * segY + segY * 0.5} L 0 ${i * segY}`;
      }
      path += " Z";
      return path;
    }

    case "bubbleRound": {
      // Perfect circle
      const radius = Math.min(w, h) * 0.5;
      const cx = w * 0.5;
      const cy = h * 0.5;
      return `M ${cx} ${cy - radius} A ${radius} ${radius} 0 1 1 ${cx} ${cy + radius} A ${radius} ${radius} 0 1 1 ${cx} ${cy - radius} Z`;
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

// Generate thought bubble trailing circles
export const getThoughtCircles = (
  bubble: Bubble,
): Array<{ cx: number; cy: number; r: number }> => {
  const count = bubble.thoughtCircles;
  const circles: Array<{ cx: number; cy: number; r: number }> = [];

  // Position circles trailing from the tail base
  const base = getBubbleBasePoints(bubble);
  const angleRad = ((bubble.tailBaseAngle + 180) * Math.PI) / 180; // Opposite direction
  const distance = Math.min(bubble.width, bubble.height) * 0.12;

  for (let i = 0; i < count; i++) {
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
export const getExplosionSpikePoints = (bubble: Bubble): Array<{ x: number; y: number; index: number; angle: number }> => {
  if (bubble.bubbleType !== "explosion") return [];
  
  const spikes = bubble.spikeCount;
  const w = bubble.width;
  const h = bubble.height;
  const outerRadius = Math.min(w, h) * 0.48;
  const baseDepth = bubble.spikeDepth;
  const individualDepths = bubble.spikeDepths || [];
  
  const points: Array<{ x: number; y: number; index: number; angle: number }> = [];
  
  for (let i = 0; i < spikes; i++) {
    const angle = (i / spikes) * Math.PI * 2 - Math.PI / 2;
    const spikeDepth = individualDepths[i] ?? baseDepth;
    const radius = outerRadius * (0.3 + spikeDepth * 0.7);
    
    points.push({
      x: w * 0.5 + Math.cos(angle) * radius,
      y: h * 0.5 + Math.sin(angle) * radius,
      index: i,
      angle: (angle * 180) / Math.PI + 90, // Convert to degrees, adjust to match tailBaseAngle convention
    });
  }
  
  return points;
};
