import { BaseEdge, EdgeProps, getStraightPath } from "@xyflow/react";

export default function AnimatedStraightEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  style,
}: EdgeProps) {
  const [edgePath] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  const { sourceColor = "#ffb1c4", targetColor = "#98cbff" } =
    (data as Record<string, string> | undefined) ?? {};

  return (
    <g>
      <defs>
        <linearGradient
          id={`grad-${id}`}
          gradientUnits="userSpaceOnUse"
          x1={sourceX}
          y1={sourceY}
          x2={targetX}
          y2={targetY}
        >
          <stop offset="0%" stopColor={sourceColor} />
          <stop offset="100%" stopColor={targetColor} />
        </linearGradient>
      </defs>

      {/* Solid base track */}
      <BaseEdge
        path={edgePath}
        interactionWidth={10}
        style={{ ...style, stroke: "#353534", strokeWidth: 2.5 }}
      />

      {/* Flowing gradient packet */}
      <path
        d={edgePath}
        fill="none"
        stroke={`url(#grad-${id})`}
        strokeWidth={1.5}
        strokeDasharray="20 50"
        style={{
          animation: "flow-dash 6s linear infinite",
          pointerEvents: "none",
        }}
      />
    </g>
  );
}
