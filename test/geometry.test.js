import test from 'node:test';
import assert from 'node:assert/strict';
import { bottomRightPosition, keepWindowReachable, petWindowSize } from '../src/geometry.js';


test('pet window reserves a fixed toolbar row below the portrait', () => {
  assert.deepEqual(petWindowSize({ width: 183, height: 270 }), { width: 210, height: 482 });
  assert.deepEqual(petWindowSize({ width: 244, height: 360 }), { width: 270, height: 572 });
});

test('reset position uses the primary display work area in logical window units', () => {
  assert.deepEqual(bottomRightPosition({ x: 0, y: 0, width: 1920, height: 1040 }, { width: 270, height: 524 }), { x: 1620, y: 496 });
  assert.deepEqual(bottomRightPosition({ x: -1280, y: 0, width: 1280, height: 720 }, { width: 270, height: 524 }), { x: -300, y: 176 });
});

test('drag clamping keeps the entire pet window on its current display', () => {
  const window = { width: 270, height: 524 };
  const secondary = { x: -1920, y: -120, width: 1920, height: 1080 };
  assert.deepEqual(keepWindowReachable(-5000, -4000, window, secondary), { x: -1920, y: -120 });
  assert.deepEqual(keepWindowReachable(5000, 5000, window, secondary), { x: -270, y: 436 });
});
