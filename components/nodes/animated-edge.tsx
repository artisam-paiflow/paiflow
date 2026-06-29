import {
  BaseEdge,
  EdgeLabelRenderer,
  EdgeProps,
  getStraightPath,
  useReactFlow,
} from "@xyflow/react";

export default function AnimatedStraightEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  style,
  selected,
}: EdgeProps) {
  const { deleteElements } = useReactFlow();
  const [edgePath, labelX, labelY] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  const { sourceColor = "#ffb1c4", targetColor = "#98cbff" } =
    (data as Record<string, string> | undefined) ?? {};

  return (
    <>
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

        {/* Solid base track. A wide invisible interaction band makes the thin
            line easy to click/select so it can be deleted (issue #244). */}
        <BaseEdge
          path={edgePath}
          interactionWidth={20}
          style={{
            ...style,
            stroke: selected ? "#ffb1c4" : "#353534",
            strokeWidth: selected ? 3.5 : 2.5,
          }}
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

      {/* Click-to-delete affordance, shown once the edge is selected. Keyboard
          deletion (Delete/Backspace) is handled by React Flow's deleteKeyCode. */}
      {selected && (
        <EdgeLabelRenderer>
          <button
            type="button"
            aria-label="Delete connection"
            className="nodrag nopan hover:border-error hover:text-error flex h-5 w-5 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-zinc-300 shadow transition-colors"
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "all",
            }}
            onClick={(e) => {
              e.stopPropagation();
              void deleteElements({ edges: [{ id }] });
            }}
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[14px] leading-none">
              close
            </span>
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
