export interface CameraState {
  x: number;
  y: number;
  heading: number;
}

export function createCameraState(x: number, y: number, heading: number): CameraState {
  return { x, y, heading };
}

export function shortestAngle(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta <= -Math.PI) {
    delta += Math.PI * 2;
  } else if (delta > Math.PI) {
    delta -= Math.PI * 2;
  }
  return delta;
}

/**
 * Smoothly follows the local kart. Position uses an exponential approach and
 * heading uses the shortest angular path, so the camera never snaps during
 * normal driving.
 */
export function smoothCamera(
  current: CameraState,
  target: CameraState,
  dtSeconds: number,
): CameraState {
  const positionK = 1 - Math.exp(-dtSeconds * 6);
  const headingK = 1 - Math.exp(-dtSeconds * 5);
  return {
    x: current.x + (target.x - current.x) * positionK,
    y: current.y + (target.y - current.y) * positionK,
    heading: current.heading + shortestAngle(current.heading, target.heading) * headingK,
  };
}

/**
 * Rotation that maps the kart's heading to screen-up, plus the scale that fits
 * a phone-sized viewport. `aheadPx` reserves a little extra space above the
 * kart so the road ahead is readable.
 */
export function cameraRotation(heading: number): number {
  return -(heading + Math.PI / 2);
}

export function cameraScale(width: number, height: number): number {
  return Math.max(0.45, Math.min(width / 560, height / 760));
}
