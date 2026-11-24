export const DESKTOP_APPEARANCE_LABELS = Object.freeze({ portrait: '蓝小妹立绘', layered: '蓝小妹' });

export const layeredExpressions = {
  blink: { label: '闭眼', blink: true },
  shy: { label: '害羞', effect: 'blush' },
  smile: { effect: 'blush' },
  sleepy: { blink: true },
  pout: { label: '烦躁气泡', bubble: true },
  talk: { label: '张嘴', talking: true },
  teary: { label: '流汗', effect: 'sweat' },
  confused: { bubble: true },
  annoyed: { label: '黑脸', effect: 'shade' },
};

const waveMouthExpressions = new Set(['pout', 'surprised', 'confused']);

export function layeredOpenMouth(id) {
  return waveMouthExpressions.has(id) ? 2 : 1;
}

export function appearanceExpressions(info, appearance) {
  const items = [['normal', info.image], ...Object.entries(info.expressions)];
  return items.flatMap(([id, path]) => {
    const label = id === 'normal' ? '原始表情' :
      appearance === 'layered' ? layeredExpressions[id]?.label : info.expressionLabels[id] || id;
    return label ? [{ id, path, label, defaultSelected: info.idleExpressions.includes(id) }] : [];
  });
}
