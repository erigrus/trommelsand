import * as THREE from 'three';
import michromaUrl from '@fontsource/michroma/files/michroma-latin-400-normal.woff2?url';

// Renders the title card into a transparent texture once. The Grade pass
// composites it and handles the sand dissolve.
export async function makeTitleTexture(width, height, { band = 'FUZZAN', title = 'TROMMELSAND' } = {}) {
  // Bundled font first; if the host blocks it, the Google Fonts copy linked in
  // index.html; failing both, the canvas falls back to a system sans.
  try {
    const face = new FontFace('Michroma', `url(${michromaUrl})`);
    await face.load();
    document.fonts.add(face);
  } catch {
    await document.fonts.load(`${Math.round(height * 0.085)}px Michroma`).catch(() => {});
  }

  const cv = document.createElement('canvas');
  cv.width = width;
  cv.height = height;
  const ctx = cv.getContext('2d');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const sand = '#f3d6a4';

  const big = Math.round(height * 0.085);
  ctx.font = `${big}px Michroma, 'Arial Narrow', sans-serif`;
  ctx.letterSpacing = `${Math.round(big * 0.32)}px`;
  ctx.fillStyle = sand;
  ctx.shadowColor = 'rgba(40,20,5,0.55)';
  ctx.shadowBlur = big * 0.25;
  ctx.fillText(title, width / 2 + big * 0.16, height * 0.5);

  const small = Math.round(height * 0.042);
  ctx.font = `${small}px Michroma, 'Arial Narrow', sans-serif`;
  ctx.letterSpacing = `${Math.round(small * 0.9)}px`;
  ctx.fillText(band, width / 2 + small * 0.45, height * 0.5 - big * 1.25);

  const tex = new THREE.CanvasTexture(cv);
  // sampled raw: the Grade pass works in display (sRGB) space
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}
