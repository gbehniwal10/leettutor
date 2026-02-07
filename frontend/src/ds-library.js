// Data Structure Shape Library for Excalidraw
// Pre-built templates that appear in the library panel for drag-and-drop.

let _seed = 100000;
const nextSeed = () => _seed++;

// ── Element Helpers ────────────────────────────────────────────

function mkBase(type, id, x, y, w, h, groupId, extra = {}) {
  return {
    id,
    type,
    x,
    y,
    width: w,
    height: h,
    strokeColor: "#1971c2",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    angle: 0,
    seed: nextSeed(),
    version: 1,
    versionNonce: nextSeed(),
    index: null,
    groupIds: [groupId],
    frameId: null,
    roundness: null,
    boundElements: null,
    isDeleted: false,
    locked: false,
    updated: 1700000000000,
    link: null,
    ...extra,
  };
}

function mkRect(id, x, y, w, h, gid, opts = {}) {
  return mkBase("rectangle", id, x, y, w, h, gid, {
    backgroundColor: opts.fill || "#d0ebff",
    roundness: opts.rounded ? { type: 3 } : null,
  });
}

function mkEllipse(id, x, y, w, h, gid, opts = {}) {
  return mkBase("ellipse", id, x, y, w, h, gid, {
    backgroundColor: opts.fill || "#d0ebff",
    roundness: { type: 2 },
  });
}

function mkText(id, x, y, content, gid, opts = {}) {
  const fontSize = opts.fontSize || 16;
  return mkBase("text", id, x, y, opts.width || content.length * fontSize * 0.6, opts.height || fontSize * 1.35, gid, {
    text: content,
    originalText: content,
    fontSize,
    fontFamily: 2,
    textAlign: opts.textAlign || "center",
    verticalAlign: opts.verticalAlign || "middle",
    lineHeight: 1.25,
    containerId: opts.containerId || null,
    autoResize: !opts.containerId,
    strokeColor: opts.color || "#1e1e1e",
    backgroundColor: "transparent",
  });
}

function mkArrow(id, x, y, points, gid) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return mkBase("arrow", id, x, y, Math.max(...xs) - Math.min(...xs) || 1, Math.max(...ys) - Math.min(...ys) || 1, gid, {
    points,
    lastCommittedPoint: null,
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: "arrow",
    elbowed: false,
  });
}

function mkLine(id, x, y, points, gid) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return mkBase("line", id, x, y, Math.max(...xs) - Math.min(...xs) || 1, Math.max(...ys) - Math.min(...ys) || 1, gid, {
    points,
    lastCommittedPoint: null,
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: null,
  });
}

function bind(container, textElem) {
  container.boundElements = [...(container.boundElements || []), { id: textElem.id, type: "text" }];
  textElem.containerId = container.id;
}

function libItem(id, name, elements) {
  return { id, status: "unpublished", created: 1700000000000, name, elements };
}

// ── 1. Array ───────────────────────────────────────────────────

function createArray() {
  const G = "ds-array";
  const W = 60, H = 50;
  const vals = ["1", "4", "7", "2", "9"];
  const els = [];

  for (let i = 0; i < 5; i++) {
    const x = i * W;
    const r = mkRect(`arr-r${i}`, x, 0, W, H, G);
    const t = mkText(`arr-v${i}`, x + 5, 5, vals[i], G, {
      containerId: r.id, width: W - 10, height: H - 10, fontSize: 20,
    });
    bind(r, t);
    els.push(r, t);

    // index label below
    els.push(mkText(`arr-i${i}`, x + W / 2 - 5, H + 6, String(i), G, {
      fontSize: 14, color: "#1971c2",
    }));
  }

  return libItem("ds-array", "Array", els);
}

// ── 2. Linked List ─────────────────────────────────────────────

function createLinkedList() {
  const G = "ds-ll";
  const NW = 80, NH = 45, GAP = 45;
  const vals = ["A", "B", "C"];
  const els = [];

  for (let i = 0; i < 3; i++) {
    const x = i * (NW + GAP);
    const r = mkRect(`ll-r${i}`, x, 0, NW, NH, G, { rounded: true });
    const t = mkText(`ll-t${i}`, x + 5, 5, vals[i], G, {
      containerId: r.id, width: NW - 10, height: NH - 10, fontSize: 18,
    });
    bind(r, t);
    els.push(r, t);

    if (i < 2) {
      els.push(mkArrow(`ll-a${i}`, x + NW, NH / 2, [[0, 0], [GAP, 0]], G));
    }
  }

  // null terminator
  const nullX = 2 * (NW + GAP) + NW + 8;
  els.push(mkText("ll-null", nullX, NH / 2 - 10, "null", G, {
    fontSize: 14, color: "#868e96",
  }));

  return libItem("ds-linked-list", "Linked List", els);
}

// ── 3. Binary Tree ─────────────────────────────────────────────

function createBinaryTree() {
  const G = "ds-bt";
  const S = 44, R = S / 2;
  const els = [];

  // node center positions [cx, cy]
  const nodes = [
    [160, 22], [80, 100], [240, 100],
    [40, 178], [120, 178], [200, 178], [280, 178],
  ];
  const labels = ["1", "2", "3", "4", "5", "6", "7"];
  const edges = [[0, 1], [0, 2], [1, 3], [1, 4], [2, 5], [2, 6]];

  // edges first (render behind nodes)
  for (const [pi, ci] of edges) {
    const [px, py] = nodes[pi];
    const [cx, cy] = nodes[ci];
    els.push(mkLine(`bt-e${pi}${ci}`, px, py + R, [
      [0, 0], [cx - px, cy - R - py - R],
    ], G));
  }

  // nodes
  for (let i = 0; i < nodes.length; i++) {
    const [cx, cy] = nodes[i];
    const e = mkEllipse(`bt-n${i}`, cx - R, cy - R, S, S, G);
    const t = mkText(`bt-t${i}`, cx - R + 2, cy - R + 2, labels[i], G, {
      containerId: e.id, width: S - 4, height: S - 4, fontSize: 18,
    });
    bind(e, t);
    els.push(e, t);
  }

  return libItem("ds-binary-tree", "Binary Tree", els);
}

// ── 4. Graph ───────────────────────────────────────────────────

function createGraph() {
  const G = "ds-graph";
  const S = 44, R = S / 2;
  const els = [];

  const verts = [
    [80, 22], [250, 22], [20, 160], [160, 160], [310, 160],
  ];
  const labels = ["A", "B", "C", "D", "E"];
  const edges = [[0, 1], [0, 2], [0, 3], [3, 4], [1, 4]];

  for (let i = 0; i < edges.length; i++) {
    const [ai, bi] = edges[i];
    const [ax, ay] = verts[ai];
    const [bx, by] = verts[bi];
    els.push(mkLine(`gr-e${i}`, ax, ay, [[0, 0], [bx - ax, by - ay]], G));
  }

  for (let i = 0; i < verts.length; i++) {
    const [cx, cy] = verts[i];
    const e = mkEllipse(`gr-n${i}`, cx - R, cy - R, S, S, G);
    const t = mkText(`gr-t${i}`, cx - R + 2, cy - R + 2, labels[i], G, {
      containerId: e.id, width: S - 4, height: S - 4, fontSize: 18,
    });
    bind(e, t);
    els.push(e, t);
  }

  return libItem("ds-graph", "Graph", els);
}

// ── 5. Stack ───────────────────────────────────────────────────

function createStack() {
  const G = "ds-stack";
  const W = 110, H = 45;
  const vals = ["D", "C", "B", "A"]; // top → bottom
  const els = [];

  for (let i = 0; i < 4; i++) {
    const y = i * H;
    const r = mkRect(`st-r${i}`, 0, y, W, H, G);
    const t = mkText(`st-t${i}`, 5, y + 5, vals[i], G, {
      containerId: r.id, width: W - 10, height: H - 10, fontSize: 18,
    });
    bind(r, t);
    els.push(r, t);
  }

  els.push(mkText("st-top", W + 10, 10, "top", G, { fontSize: 14, color: "#1971c2" }));
  els.push(mkText("st-btm", W + 10, 3 * H + 10, "bottom", G, { fontSize: 14, color: "#1971c2" }));

  return libItem("ds-stack", "Stack", els);
}

// ── 6. Queue ───────────────────────────────────────────────────

function createQueue() {
  const G = "ds-queue";
  const W = 65, H = 45;
  const vals = ["A", "B", "C", "D"];
  const els = [];

  for (let i = 0; i < 4; i++) {
    const x = i * W;
    const r = mkRect(`qu-r${i}`, x, 0, W, H, G);
    const t = mkText(`qu-t${i}`, x + 5, 5, vals[i], G, {
      containerId: r.id, width: W - 10, height: H - 10, fontSize: 18,
    });
    bind(r, t);
    els.push(r, t);
  }

  els.push(mkText("qu-front", 0, H + 6, "front", G, { fontSize: 14, color: "#1971c2" }));
  els.push(mkText("qu-rear", 3 * W + 5, H + 6, "rear", G, { fontSize: 14, color: "#1971c2" }));

  return libItem("ds-queue", "Queue", els);
}

// ── 7. Hash Map ────────────────────────────────────────────────

function createHashMap() {
  const G = "ds-hm";
  const IDX_W = 40, ENTRY_W = 80, H = 45, AGAP = 30;
  const els = [];

  const buckets = [
    [["a", "1"]],
    [],
    [["b", "2"], ["c", "3"]],
    [["d", "4"]],
  ];

  for (let i = 0; i < 4; i++) {
    const y = i * H;

    // index cell
    const ir = mkRect(`hm-i${i}`, 0, y, IDX_W, H, G, { fill: "#a5d8ff" });
    const it = mkText(`hm-it${i}`, 2, y + 2, String(i), G, {
      containerId: ir.id, width: IDX_W - 4, height: H - 4, fontSize: 16,
    });
    bind(ir, it);
    els.push(ir, it);

    let cx = IDX_W;
    for (let j = 0; j < buckets[i].length; j++) {
      const [key, val] = buckets[i][j];

      // arrow
      els.push(mkArrow(`hm-a${i}${j}`, cx, y + H / 2, [[0, 0], [AGAP, 0]], G));
      cx += AGAP;

      // entry
      const er = mkRect(`hm-e${i}${j}`, cx, y, ENTRY_W, H, G, { rounded: true });
      const et = mkText(`hm-et${i}${j}`, cx + 2, y + 2, `${key}: ${val}`, G, {
        containerId: er.id, width: ENTRY_W - 4, height: H - 4, fontSize: 16,
      });
      bind(er, et);
      els.push(er, et);
      cx += ENTRY_W;
    }
  }

  return libItem("ds-hashmap", "Hash Map", els);
}

// ── Export ──────────────────────────────────────────────────────

export const DS_LIBRARY_ITEMS = [
  createArray(),
  createLinkedList(),
  createBinaryTree(),
  createGraph(),
  createStack(),
  createQueue(),
  createHashMap(),
];
