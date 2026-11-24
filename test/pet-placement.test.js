import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PetPlacement } from '../src/pet-placement.js';

function fixture(scale = 1.25) {
  const window = new EventEmitter();
  let actual = { x: 500, y: 300, width: 270, height: 572 }, moves = 0;
  window.isDestroyed = () => false;
  window.getBounds = () => ({ ...actual });
  window.setBounds = bounds => {
    ++moves;
    // Reproduce the reported native rounding: a move adds a pixel even when
    // the cursor hasn't moved. Explicit sizes must keep it from accumulating.
    actual = { ...bounds, width: bounds.width + (scale % 1 ? 1 : 0), height: bounds.height + (scale % 1 ? 1 : 0) };
    window.emit('resize');
  };
  const displays = [
    { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
    { id: 2, workArea: { x: -2048, y: -200, width: 2048, height: 1112 } },
  ];
  const screen = {
    cursor: { x: 600, y: 500 },
    getCursorScreenPoint() { return { ...this.cursor }; },
    getPrimaryDisplay: () => displays[0],
    getDisplayNearestPoint: point => displays[point.x < 0 ? 1 : 0],
    getDisplayMatching: bounds => displays[bounds.x < 0 ? 1 : 0],
  };
  return { window, screen, placement: new PetPlacement(window, screen, actual), moves: () => moves };
}

for (const scale of [1, 1.25, 1.5, 1.75, 2, 2.5, 3]) {
  test(`300 drag frames at ${scale * 100}% never accumulate native window growth`, () => {
    const { placement, screen, window, moves } = fixture(scale);
    placement.startDrag();
    for (let i = 0; i < 300; i++) {
      screen.cursor = { x: 600 - i * 2, y: 500 - i / 2 };
      placement.moveDrag();
      const bounds = window.getBounds();
      assert.ok(Math.abs(bounds.width - 270) <= 1);
      assert.ok(Math.abs(bounds.height - 572) <= 1);
      assert.equal(bounds.x, Math.round(500 - i * 2));
    }
    const count = moves();
    for (let i = 0; i < 300; i++) placement.moveDrag();
    assert.equal(moves(), count, 'stationary pointer must not move the native window');
    placement.endDrag();
    assert.equal(placement.bounds.width, 270);
    assert.equal(placement.bounds.height, 572);
  });
}

test('cross-monitor drag follows absolute cursor, then keeps all controls on the destination screen', () => {
  const { placement, screen } = fixture();
  placement.startDrag();
  screen.cursor = { x: -150, y: 100 };
  placement.moveDrag();
  assert.deepEqual(placement.bounds, { x: -250, y: -100, width: 270, height: 572 });
  placement.endDrag();
  assert.deepEqual(placement.bounds, { x: -270, y: -100, width: 270, height: 572 });
  placement.reset();
  assert.deepEqual(placement.bounds, { x: 1620, y: 448, width: 270, height: 572 });
});

test('resize, moveTo, display changes and reset never reuse an inflated native size', () => {
  const { placement, window } = fixture();
  placement.moveTo(-900, 50);
  placement.resize({ width: 210, height: 482 });
  assert.deepEqual(placement.bounds, { x: -900, y: 140, width: 210, height: 482 });
  placement.displaysChanged();
  placement.reset();
  assert.deepEqual(placement.bounds, { x: 1680, y: 538, width: 210, height: 482 });
  assert.ok(Math.abs(window.getBounds().width - 210) <= 1);
});

test('the portrait can reach both screen edges while its window stays on-screen', () => {
  const { placement, screen, window } = fixture(1);
  placement.setArtworkInsets(270, 72);
  placement.startDrag();
  screen.cursor = { x: 600, y: 10 };
  placement.moveDrag();
  assert.equal(placement.bounds.y, -190);
  assert.equal(placement.lift, 190);
  assert.deepEqual(window.getBounds(), { x: 500, y: 0, width: 270, height: 572 });
  screen.cursor = { x: -500, y: -200 };
  placement.moveDrag();
  placement.endDrag();
  assert.equal(placement.bounds.y, -400);
  assert.equal(placement.lift, 200);
  assert.equal(window.getBounds().y, -200);
  assert.equal(window.getBounds().height, 838);
  placement.moveTo(-600, -900);
  assert.equal(placement.bounds.y + 270, -188);
  placement.moveTo(600, 1500);
  assert.equal(placement.bounds.y + 572 - 72, 1028);
  assert.equal(placement.lift, -60);
  assert.deepEqual(window.getBounds(), { x: 600, y: 468, width: 270, height: 572 });
  placement.moveTo(-600, -900);
  placement.setArtworkInsets(0, 0);
  assert.equal(placement.lift, 0);
  assert.deepEqual(window.getBounds(), { x: -600, y: -200, width: 270, height: 572 });
});

test('asynchronous DPI resize restores the owned size with bounded retries', async () => {
  const { placement, window } = fixture();
  window.setBounds({ x: 500, y: 300, width: 800, height: 900 });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(Math.abs(window.getBounds().width - 270) <= 1);
  assert.ok(Math.abs(window.getBounds().height - 572) <= 1);
  placement.cancelDrag();
  placement.moveDrag();
  assert.equal(placement.bounds.x, 500);
});
