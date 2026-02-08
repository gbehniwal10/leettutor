import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createRoot } from "react-dom/client";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

// ---------------------------------------------------------------------------
// Theme mapping — maps data-theme attribute to colors for React Flow
// ---------------------------------------------------------------------------

const THEMES = {
  dark: {
    bg: "#1e1e1e",
    nodeBg: "#252526",
    nodeBorder: "#3e3e3e",
    text: "#d4d4d4",
    textSecondary: "#888888",
    accent: "#4ec9b0",
    accentBlue: "#0078d4",
    locked: "#555555",
    progressBg: "#3e3e3e",
    progressFill: "#4ec9b0",
    edgeLocked: "#3e3e3e",
    edgeNormal: "#569cd6",
    popoverBg: "#2d2d2d",
    hoverBg: "#3c3c3c",
  },
  sepia: {
    bg: "#fdf6e3",
    nodeBg: "#f5eed6",
    nodeBorder: "#d3c6a6",
    text: "#1e1e1e",
    textSecondary: "#4e626a",
    accent: "#2aa198",
    accentBlue: "#1c75b5",
    locked: "#b0a888",
    progressBg: "#d3c6a6",
    progressFill: "#2aa198",
    edgeLocked: "#d3c6a6",
    edgeNormal: "#1c75b5",
    popoverBg: "#eee8c8",
    hoverBg: "#d9d0b4",
  },
  "low-distraction": {
    bg: "#2b2b2b",
    nodeBg: "#313131",
    nodeBorder: "#404040",
    text: "#c0c0c0",
    textSecondary: "#999999",
    accent: "#8fbc8f",
    accentBlue: "#7a9abf",
    locked: "#555555",
    progressBg: "#404040",
    progressFill: "#8fbc8f",
    edgeLocked: "#404040",
    edgeNormal: "#7a9abf",
    popoverBg: "#383838",
    hoverBg: "#454545",
  },
};

function getThemeColors() {
  const theme = document.documentElement.getAttribute("data-theme") || "dark";
  return THEMES[theme] || THEMES.dark;
}

// ---------------------------------------------------------------------------
// Layout — topological sort + layer assignment
// ---------------------------------------------------------------------------

function computeLayout(categories) {
  if (!categories || categories.length === 0) return { nodes: [], edges: [] };

  const catMap = {};
  for (const cat of categories) catMap[cat.id] = cat;

  // Topological sort via Kahn's algorithm
  const inDegree = {};
  const adj = {};
  for (const cat of categories) {
    inDegree[cat.id] = (cat.prerequisites || []).length;
    adj[cat.id] = [];
  }
  for (const cat of categories) {
    for (const pre of cat.prerequisites || []) {
      if (adj[pre]) adj[pre].push(cat.id);
    }
  }

  const queue = [];
  for (const cat of categories) {
    if (inDegree[cat.id] === 0) queue.push(cat.id);
  }

  const layers = {};
  const depth = {};
  while (queue.length > 0) {
    const id = queue.shift();
    const d = depth[id] || 0;
    if (!layers[d]) layers[d] = [];
    layers[d].push(id);
    for (const child of adj[id]) {
      depth[child] = Math.max(depth[child] || 0, d + 1);
      inDegree[child]--;
      if (inDegree[child] === 0) queue.push(child);
    }
  }

  // Position nodes
  const NODE_WIDTH = 220;
  const NODE_HEIGHT = 90;
  const H_GAP = 40;
  const V_GAP = 60;

  const nodes = [];
  const maxLayers = Object.keys(layers).length;

  for (let d = 0; d < maxLayers; d++) {
    const layerIds = layers[d] || [];
    const layerWidth = layerIds.length * NODE_WIDTH + (layerIds.length - 1) * H_GAP;
    const startX = -layerWidth / 2;

    for (let i = 0; i < layerIds.length; i++) {
      const catId = layerIds[i];
      const cat = catMap[catId];
      nodes.push({
        id: catId,
        type: "categoryNode",
        position: {
          x: startX + i * (NODE_WIDTH + H_GAP),
          y: d * (NODE_HEIGHT + V_GAP),
        },
        data: { category: cat },
      });
    }
  }

  // Edges
  const edges = [];
  for (const cat of categories) {
    for (const pre of cat.prerequisites || []) {
      edges.push({
        id: `${pre}->${cat.id}`,
        source: pre,
        target: cat.id,
        type: "smoothstep",
        data: { targetId: cat.id },
      });
    }
  }

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// CategoryNode — custom node component
// ---------------------------------------------------------------------------

function CategoryNode({ data, id }) {
  const { category, progress, allCategories, isUnlocked, onNodeClick, colors } = data;
  const problems = category.problems || [];
  const totalCount = problems.length;

  let solvedCount = 0;
  if (progress) {
    for (const pid of problems) {
      if (progress.problems && progress.problems[pid]?.solved) solvedCount++;
    }
  }

  const pct = totalCount > 0 ? Math.round((solvedCount / totalCount) * 100) : 0;
  const isCompleted = solvedCount === totalCount && totalCount > 0;
  const isInProgress = solvedCount > 0 && !isCompleted;

  let borderColor = colors.nodeBorder;
  let borderStyle = "solid";
  let opacity = 1;

  if (!isUnlocked) {
    borderStyle = "dashed";
    opacity = 0.5;
    borderColor = colors.locked;
  } else if (isCompleted) {
    borderColor = colors.accent;
  } else if (isInProgress) {
    borderColor = colors.accentBlue;
  }

  const handleClick = useCallback(() => {
    if (onNodeClick) onNodeClick(id);
  }, [id, onNodeClick]);

  return (
    <div
      onClick={handleClick}
      style={{
        background: colors.nodeBg,
        border: `2px ${borderStyle} ${borderColor}`,
        borderRadius: 8,
        padding: "10px 14px",
        width: 220,
        opacity,
        cursor: isUnlocked ? "pointer" : "not-allowed",
        transition: "border-color 0.2s, opacity 0.2s",
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: colors.nodeBorder, width: 8, height: 8 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        {!isUnlocked && <span style={{ fontSize: 14 }}>&#128274;</span>}
        {isCompleted && <span style={{ color: colors.accent, fontSize: 14 }}>&#10003;</span>}
        <span style={{ fontWeight: 600, fontSize: 13, color: colors.text, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {category.title}
        </span>
      </div>
      <div style={{ fontSize: 11, color: colors.textSecondary, marginBottom: 6 }}>
        {solvedCount}/{totalCount} solved
      </div>
      <div style={{ height: 5, background: colors.progressBg, borderRadius: 3, overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: colors.progressFill,
            borderRadius: 3,
            transition: "width 0.3s ease",
          }}
        />
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: colors.nodeBorder, width: 8, height: 8 }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProblemPopover — shown when a node is expanded
// ---------------------------------------------------------------------------

function ProblemPopover({ category, progress, position, onSelectProblem, onClose, colors }) {
  const ref = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        onClose();
      }
    }
    function handleKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  const problems = category.problems || [];

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        left: position.x,
        top: position.y,
        zIndex: 200,
        background: colors.popoverBg,
        border: `1px solid ${colors.nodeBorder}`,
        borderRadius: 8,
        padding: 12,
        minWidth: 220,
        maxWidth: 300,
        boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 14, color: colors.text, marginBottom: 8 }}>
        {category.title}
      </div>
      {problems.map((pid) => {
        const solved = progress?.problems?.[pid]?.solved;
        return (
          <div
            key={pid}
            onClick={() => onSelectProblem(pid)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 8px",
              borderRadius: 4,
              cursor: "pointer",
              fontSize: 13,
              color: colors.text,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = colors.hoverBg)}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <span style={{ color: solved ? colors.accent : "transparent", fontSize: 13, width: 16, textAlign: "center" }}>
              {solved ? "\u2713" : "\u00B7"}
            </span>
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {pid.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CustomControls — zoom buttons with animated transitions
// ---------------------------------------------------------------------------

const controlBtnStyle = (colors) => ({
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 28,
  height: 28,
  background: colors.nodeBg,
  color: colors.text,
  border: `1px solid ${colors.nodeBorder}`,
  borderBottom: "none",
  cursor: "pointer",
  fontSize: 16,
  lineHeight: 1,
  padding: 0,
});

function CustomControls({ onZoomIn, onZoomOut, onFitView, colors }) {
  return (
    <div style={{
      position: "absolute",
      bottom: 10,
      left: 10,
      zIndex: 10,
      borderRadius: 6,
      overflow: "hidden",
      border: `1px solid ${colors.nodeBorder}`,
    }}>
      <button onClick={onZoomIn} title="Zoom in" style={{ ...controlBtnStyle(colors), borderTop: "none" }}
        onMouseEnter={(e) => (e.currentTarget.style.background = colors.hoverBg)}
        onMouseLeave={(e) => (e.currentTarget.style.background = colors.nodeBg)}>+</button>
      <button onClick={onZoomOut} title="Zoom out" style={controlBtnStyle(colors)}
        onMouseEnter={(e) => (e.currentTarget.style.background = colors.hoverBg)}
        onMouseLeave={(e) => (e.currentTarget.style.background = colors.nodeBg)}>&minus;</button>
      <button onClick={onFitView} title="Fit view" style={{ ...controlBtnStyle(colors), borderBottom: `1px solid ${colors.nodeBorder}` }}
        onMouseEnter={(e) => (e.currentTarget.style.background = colors.hoverBg)}
        onMouseLeave={(e) => (e.currentTarget.style.background = colors.nodeBg)}>&#x2922;</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SkillTreeIsland — main React component
// ---------------------------------------------------------------------------

function SkillTreeIsland() {
  const [categories, setCategories] = useState([]);
  const [progress, setProgress] = useState({ problems: {} });
  const [colors, setColors] = useState(getThemeColors);
  const [expandedNodeId, setExpandedNodeId] = useState(null);
  const [popoverPos, setPopoverPos] = useState({ x: 0, y: 0 });
  const onProblemSelectRef = useRef(null);

  const nodeTypes = useMemo(() => ({ categoryNode: CategoryNode }), []);

  // Compute unlock states
  const unlockMap = useMemo(() => {
    const map = {};
    const catMap = {};
    for (const cat of categories) catMap[cat.id] = cat;

    for (const cat of categories) {
      const prereqs = cat.prerequisites || [];
      if (prereqs.length === 0) {
        map[cat.id] = true;
        continue;
      }
      let allMet = true;
      for (const pre of prereqs) {
        const preCat = catMap[pre];
        if (!preCat) continue;
        const hasSolved = (preCat.problems || []).some(
          (pid) => progress.problems?.[pid]?.solved
        );
        if (!hasSolved) {
          allMet = false;
          break;
        }
      }
      map[cat.id] = allMet;
    }
    return map;
  }, [categories, progress]);

  // Compute layout once when categories change
  const layout = useMemo(() => computeLayout(categories), [categories]);

  // Enrich nodes with runtime data
  const enrichedNodes = useMemo(() => {
    return layout.nodes.map((n) => ({
      ...n,
      data: {
        ...n.data,
        progress,
        allCategories: categories,
        isUnlocked: unlockMap[n.id] ?? true,
        onNodeClick: (nodeId) => {
          if (!unlockMap[nodeId]) return;
          setExpandedNodeId((prev) => (prev === nodeId ? null : nodeId));
        },
        colors,
      },
    }));
  }, [layout.nodes, progress, categories, unlockMap, colors]);

  // Enrich edges with locked/unlocked styling
  const enrichedEdges = useMemo(() => {
    return layout.edges.map((e) => {
      const targetUnlocked = unlockMap[e.data.targetId] ?? true;
      return {
        ...e,
        animated: false,
        style: {
          stroke: targetUnlocked ? colors.edgeNormal : colors.edgeLocked,
          strokeWidth: 2,
          strokeDasharray: targetUnlocked ? undefined : "6 3",
          opacity: targetUnlocked ? 1 : 0.4,
        },
      };
    });
  }, [layout.edges, unlockMap, colors]);

  const [nodes, setNodes, onNodesChange] = useNodesState(enrichedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(enrichedEdges);

  const { fitView, zoomIn, zoomOut } = useReactFlow();

  // Animated reveal: snap to wide overview, then smoothly zoom in
  const animateZoomIn = useCallback(() => {
    // Snap to the wide overview instantly
    fitView({ padding: 0.4, duration: 0 });
    // Then smoothly zoom into the close-up view
    setTimeout(() => fitView({ padding: 0.02, duration: 800 }), 300);
  }, [fitView]);

  // Keep nodes/edges in sync
  const prevNodeCount = useRef(0);
  useEffect(() => {
    setNodes(enrichedNodes);
    // Only animate on initial load (0 → N nodes), not on every re-render
    if (prevNodeCount.current === 0 && enrichedNodes.length > 0) {
      // Wait for React Flow to measure and render nodes before fitting
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          animateZoomIn();
        });
      });
    }
    prevNodeCount.current = enrichedNodes.length;
  }, [enrichedNodes, setNodes, animateZoomIn]);
  useEffect(() => setEdges(enrichedEdges), [enrichedEdges, setEdges]);

  // Re-fit when the container becomes visible (fitView doesn't work on hidden elements)
  useEffect(() => {
    const root = document.getElementById("skill-tree-root");
    if (!root) return;
    const observer = new MutationObserver(() => {
      if (!root.classList.contains("hidden") && enrichedNodes.length > 0) {
        // Wait two frames for layout, then animate
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            animateZoomIn();
          });
        });
      }
    });
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [animateZoomIn, enrichedNodes.length]);

  // Track node positions for popover placement
  const onNodeClick = useCallback(
    (_event, node) => {
      if (!unlockMap[node.id]) return;
      if (expandedNodeId === node.id) {
        setExpandedNodeId(null);
        return;
      }
      // Position popover relative to the flow container
      const container = document.getElementById("skill-tree-root");
      if (container) {
        const rect = container.getBoundingClientRect();
        const nodeX = _event.clientX - rect.left + 20;
        const nodeY = _event.clientY - rect.top;
        setPopoverPos({ x: nodeX, y: nodeY });
      }
      setExpandedNodeId(node.id);
    },
    [expandedNodeId, unlockMap]
  );

  // Sync theme
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setColors(getThemeColors());
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  // Expose bridge API
  useEffect(() => {
    window.skillTreeBridge = {
      updateProgress: (progressData) => {
        setProgress(progressData || { problems: {} });
      },
      setTheme: (_theme) => {
        setColors(getThemeColors());
      },
      setOnProblemSelect: (callback) => {
        onProblemSelectRef.current = callback;
      },
      setCategories: (cats) => {
        setCategories(cats || []);
      },
    };
    return () => {
      delete window.skillTreeBridge;
    };
  }, []);

  const expandedCategory = useMemo(() => {
    if (!expandedNodeId) return null;
    return categories.find((c) => c.id === expandedNodeId) || null;
  }, [expandedNodeId, categories]);

  const handleSelectProblem = useCallback(
    (problemId) => {
      setExpandedNodeId(null);
      if (onProblemSelectRef.current) {
        onProblemSelectRef.current(problemId);
      }
    },
    []
  );

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onPaneClick={() => setExpandedNodeId(null)}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll
        proOptions={{ hideAttribution: true }}
        style={{ background: colors.bg }}
      >
        <Background color={colors.nodeBorder} gap={20} size={1} />
        <CustomControls
          onZoomIn={() => zoomIn({ duration: 300 })}
          onZoomOut={() => zoomOut({ duration: 300 })}
          onFitView={() => fitView({ padding: 0.02, duration: 400 })}
          colors={colors}
        />
      </ReactFlow>
      {expandedCategory && (
        <ProblemPopover
          category={expandedCategory}
          progress={progress}
          position={popoverPos}
          onSelectProblem={handleSelectProblem}
          onClose={() => setExpandedNodeId(null)}
          colors={colors}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

const rootEl = document.getElementById("skill-tree-root");
if (rootEl) {
  const root = createRoot(rootEl);
  root.render(
    <ReactFlowProvider>
      <SkillTreeIsland />
    </ReactFlowProvider>
  );
}
