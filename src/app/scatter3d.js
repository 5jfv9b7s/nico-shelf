/**
 * Pure 3D-scatter transformations. The chart is a projection of three numeric
 * dimensions, not a third independent measurement encoded as bubble area.
 *
 * Visibility, singer filters, zero/missing semantics, and duplicate suppression
 * are delegated to the proven 2D scatter data pipeline.
 */
import { createScatterData, metricValue, SCATTER_METRICS, transformMetric } from './scatter.js';

export const DEFAULT_3D_CAMERA = Object.freeze({ yaw: -0.62, pitch: 0.38, zoom: 1 });

export function createScatter3DData(videos, { x = 'views', y = 'mylists', z = 'comments', voice = '' } = {}) {
  if (!SCATTER_METRICS[z]) throw new Error('Unknown Z-axis metric');
  const xy = createScatterData(videos, { x, y, voice });
  const points = [];

  for (const point of xy.points) {
    const zValue = metricValue(point.video, z);
    if (zValue === null) continue;
    points.push({
      ...point,
      zValue,
      zPlot: transformMetric(zValue, z),
    });
  }

  return {
    x, y, z, voice, points,
    total: xy.total,
    eligible: xy.eligible,
    excluded: xy.excluded,
  };
}

/** Normalize an axis to [-1,1] without treating a constant metric as missing. */
export function axisBounds(points, key) {
  const values = points.map((point) => point[key]).filter(Number.isFinite);
  if (!values.length) return [0, 1];
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  return minimum === maximum ? [minimum - 0.5, maximum + 0.5] : [minimum, maximum];
}

export function normalizedPoint(point, bounds) {
  return ['x', 'y', 'z'].map((axis) => {
    const [low, high] = bounds[axis];
    const value = point[`${axis}Plot`];
    return 2 * (value - low) / (high - low) - 1;
  });
}

/**
 * Rotate around the vertical axis, then tilt; returns a camera depth for
 * painter's-algorithm ordering. No browser APIs, easy to unit-test.
 */
export function projectPoint([x, y, z], camera = DEFAULT_3D_CAMERA) {
  const yaw = Number.isFinite(camera.yaw) ? camera.yaw : DEFAULT_3D_CAMERA.yaw;
  const pitch = Number.isFinite(camera.pitch) ? camera.pitch : DEFAULT_3D_CAMERA.pitch;
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  const across = x * cosYaw + z * sinYaw;
  const depth = -x * sinYaw + z * cosYaw;
  return {
    x: across,
    y: y * cosPitch - depth * sinPitch,
    depth: y * sinPitch + depth * cosPitch,
  };
}
