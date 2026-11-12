/**
 * Dependency-free interactive canvas renderer for the 3-axis scatter plot.
 * - Pointer drag: rotate; wheel / +/-: zoom; click: open a video.
 * - The rendering module never reads or writes Supabase and never stores data.
 * - A chart is re-mounted after main content is replaced by the app renderer.
 */
import { colorForCharacter, UNCLASSIFIED_COLOR } from '../app/character-colors.js';
import { createScatter3DData, axisBounds, normalizedPoint, projectPoint, DEFAULT_3D_CAMERA } from '../app/scatter3d.js';
import { readableMetric, SCATTER_METRICS } from '../app/scatter.js';

let stopPreviousChart = () => {};

const AXIS_COLORS = ['#6EDCCB', '#C7A4FF', '#FFD18A'];
const clamp = (value, lower, upper) => Math.min(upper, Math.max(lower, value));

function describePoint(point, result) {
  const singer = point.voices.join('・') || '歌唱者未判定';
  const metrics = ['x', 'y', 'z'].map((axis) =>
    `${SCATTER_METRICS[result[axis]].label}: ${readableMetric(point[`${axis}Value`], result[axis])}`);
  return `${point.video.title || point.id}\n${singer}\n${metrics.join('\n')}`;
}

function drawAxes(ctx, position, width, height) {
  const corners = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
    corners.push([x, y, z]);
  }
  // Draw 12 edges of a faint reference cube for spatial orientation.
  ctx.strokeStyle = '#4A637D';
  ctx.lineWidth = 1;
  for (let a = 0; a < corners.length; a++) {
    for (let b = a + 1; b < corners.length; b++) {
      const difference = corners[a].filter((value, i) => value !== corners[b][i]).length;
      if (difference !== 1) continue;
      const from = position(corners[a]);
      const to = position(corners[b]);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.globalAlpha = 0.33;
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  const origin = [-1, -1, -1];
  const names = ['X', 'Y', 'Z'];
  const ends = [[1, -1, -1], [-1, 1, -1], [-1, -1, 1]];
  ctx.font = 'bold 14px system-ui, sans-serif';
  ends.forEach((end, index) => {
    const from = position(origin);
    const to = position(end);
    ctx.strokeStyle = AXIS_COLORS[index];
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.fillStyle = AXIS_COLORS[index];
    ctx.fillText(names[index], clamp(to.x + 6, 6, width - 17), clamp(to.y - 7, 16, height - 5));
  });
}

function makeRenderer(canvas, tooltip, result, camera) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const bounds = {
    x: axisBounds(result.points, 'xPlot'),
    y: axisBounds(result.points, 'yPlot'),
    z: axisBounds(result.points, 'zPlot'),
  };
  let screenPoints = [];
  let highlighted = null;

  function resize() {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(300, Math.floor(canvas.getBoundingClientRect().width || 860));
    const height = clamp(Math.round(width * 0.65), 365, 620);
    const desiredHeight = `${height}px`;
    if (canvas.style.height !== desiredHeight) canvas.style.height = desiredHeight;
    const bitmapWidth = Math.round(width * ratio);
    const bitmapHeight = Math.round(height * ratio);
    if (canvas.width !== bitmapWidth) canvas.width = bitmapWidth;
    if (canvas.height !== bitmapHeight) canvas.height = bitmapHeight;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { width, height };
  }

  function draw() {
    const { width, height } = resize();
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#102239';
    ctx.fillRect(0, 0, width, height);

    const scale = Math.min(width * 0.315, height * 0.32) * camera.zoom;
    const position = (coordinates) => {
      const projected = projectPoint(coordinates, camera);
      return { x: width * 0.50 + projected.x * scale, y: height * 0.52 - projected.y * scale, depth: projected.depth };
    };
    drawAxes(ctx, position, width, height);

    // Order from back to front to make the 3D relationship visible.
    screenPoints = result.points.map((point) => ({
      point,
      ...position(normalizedPoint(point, bounds)),
    })).sort((a, b) => a.depth - b.depth);

    screenPoints.forEach((entry) => {
      const { point, x, y } = entry;
      const focused = point.id === highlighted;
      const duet = point.voices.length > 1;
      const radius = focused ? 6.5 : duet ? 4.5 : 3.5;
      ctx.globalAlpha = focused ? 1 : 0.77;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = point.colorVoice ? colorForCharacter(point.colorVoice) : UNCLASSIFIED_COLOR;
      ctx.fill();
      ctx.strokeStyle = focused || duet ? '#FFFFFF' : '#173048';
      ctx.lineWidth = focused ? 2 : duet ? 1.3 : 0.55;
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
  }

  function nearest(pointerX, pointerY) {
    // Reverse render order so a foreground point wins when circles overlap.
    for (let i = screenPoints.length - 1; i >= 0; i--) {
      const dot = screenPoints[i];
      const dx = dot.x - pointerX;
      const dy = dot.y - pointerY;
      if (dx * dx + dy * dy < 110) return dot;
    }
    return null;
  }

  function showHover(dot, localX, localY) {
    const id = dot?.point.id || null;
    if (id !== highlighted) {
      highlighted = id;
      draw();
    }
    canvas.style.cursor = dot ? 'pointer' : 'grab';
    tooltip.hidden = !dot;
    if (!dot) return;
    tooltip.textContent = describePoint(dot.point, result);
    tooltip.style.left = `${clamp(localX + 12, 8, canvas.clientWidth - 180)}px`;
    tooltip.style.top = `${clamp(localY + 14, 6, canvas.clientHeight - 92)}px`;
  }

  draw();
  return { draw, nearest, showHover };
}

/** Run after rendering the scatter page. Always disposes the prior chart. */
export function mountScatter3D({ root, state, rows, onOpenVideo }) {
  stopPreviousChart();
  stopPreviousChart = () => {};
  const canvas = root.querySelector('#scatter-3d-canvas');
  const tooltip = root.querySelector('#scatter-3d-tooltip');
  if (!canvas || !tooltip) return;

  const { x, y, z, voice } = state.scatter;
  const result = createScatter3DData(rows, { x, y, z, voice });
  const camera = state.scatter.camera || { ...DEFAULT_3D_CAMERA };
  state.scatter.camera = camera;
  const renderer = makeRenderer(canvas, tooltip, result, camera);
  if (!renderer) return;

  let drag = null;
  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    canvas.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event) => {
    const rect = canvas.getBoundingClientRect();
    if (drag && drag.id === event.pointerId) {
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 1) {
        camera.yaw += dx * 0.009;
        camera.pitch = clamp(camera.pitch - dy * 0.009, -1.4, 1.4);
        drag.moved = true;
        renderer.showHover(null, 0, 0);
        renderer.draw();
      }
      drag.x = event.clientX;
      drag.y = event.clientY;
      return;
    }
    renderer.showHover(renderer.nearest(event.clientX - rect.left, event.clientY - rect.top),
      event.clientX - rect.left, event.clientY - rect.top);
  };
  const onPointerUp = (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    const moved = drag.moved;
    drag = null;
    if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (moved || event.type === 'pointercancel') return;
    const rect = canvas.getBoundingClientRect();
    const dot = renderer.nearest(event.clientX - rect.left, event.clientY - rect.top);
    if (dot) onOpenVideo(dot.point.id);
  };
  const onWheel = (event) => {
    event.preventDefault();
    camera.zoom = clamp(camera.zoom * (event.deltaY > 0 ? 0.90 : 1.10), 0.6, 2.2);
    renderer.draw();
  };
  const onKeyDown = (event) => {
    const change = { ArrowLeft: [-0.12, 0], ArrowRight: [0.12, 0], ArrowUp: [0, 0.12], ArrowDown: [0, -0.12] }[event.key];
    if (change) {
      event.preventDefault();
      camera.yaw += change[0];
      camera.pitch = clamp(camera.pitch + change[1], -1.4, 1.4);
      renderer.draw();
    } else if (event.key === '+' || event.key === '-') {
      event.preventDefault();
      camera.zoom = clamp(camera.zoom * (event.key === '+' ? 1.1 : 0.9), 0.6, 2.2);
      renderer.draw();
    }
  };
  const onPointerLeave = () => { if (!drag) renderer.showHover(null, 0, 0); };

  const listeners = [
    ['pointerdown', onPointerDown], ['pointermove', onPointerMove],
    ['pointerup', onPointerUp], ['pointercancel', onPointerUp],
    ['pointerleave', onPointerLeave], ['keydown', onKeyDown],
  ];
  for (const [name, listener] of listeners) canvas.addEventListener(name, listener);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  const observer = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => renderer.draw()) : null;
  observer?.observe(canvas);

  stopPreviousChart = () => {
    observer?.disconnect();
    for (const [name, listener] of listeners) canvas.removeEventListener(name, listener);
    canvas.removeEventListener('wheel', onWheel);
    stopPreviousChart = () => {};
  };
}
