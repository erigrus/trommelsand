// Colour script from docs/02-storyboard.md as keyframes over music time.
// Shots may override any value for their duration (ctx.look in timeline.js).
// Partial keys inherit from the previous key; colours are sRGB hex.
//
// sunElev/sunAzim in degrees. Azimuth 90 = sun toward +x. The dunes' slip
// faces face +x, so looking toward +x is backlit (dark stoss slopes with
// glowing crest lines) and looking toward -x shows the sunlit slip faces.

export const LOOK = [
  // ---- intro: blue hour, guitar alone --------------------------------------
  { t: 0.0, sunElev: -7, sunAzim: 88, sunColor: 0xff8a50, sunPower: 0.45, zenith: 0x0a1230, horizon: 0x5a3c58, ambient: 0x1a1d34, sand: 0xc4864e,
    fog: 0.0007, haze: 0.6, night: 0.35, storm: 0, clouds: 0.55, exposure: 1.0, contrast: 1.1, saturation: 1.0, lift: 0x06060e, gain: 0xffffff,
    bloom: 0.35, shimmer: 0, rays: 0.4, shadowTint: [0.0, 0.03, 0.07], highTint: [0.05, 0.01, -0.02] },
  { t: 12.0, sunElev: -3, sunColor: 0xff9050, sunPower: 0.7, zenith: 0x1c2a52, horizon: 0xa8665a, ambient: 0x342e44, night: 0.08 },
  { t: 17.25, sunElev: -0.6, horizon: 0xd8805a, zenith: 0x2e3e66, night: 0.0 },
  // ---- bar 8: the sun breaks the horizon on the downbeat --------------------
  { t: 17.62, sunElev: 1.6, sunColor: 0xffa04a, sunPower: 1.25, zenith: 0x40557e, horizon: 0xf0985a, ambient: 0x4a3a40, haze: 0.8, bloom: 0.42, rays: 0.9, clouds: 0.45 },
  { t: 38.0, sunElev: 7, sunAzim: 92, sunColor: 0xffc080, sunPower: 1.2, zenith: 0x4f74a6, horizon: 0xf2b47e, ambient: 0x5e4c4c, haze: 0.6, bloom: 0.38, rays: 0.7, clouds: 0.3, saturation: 1.08 },
  { t: 74.0, sunElev: 15, sunColor: 0xffd4a0, zenith: 0x5a84b4, horizon: 0xf2c895, ambient: 0x6e5a52, fog: 0.0005, contrast: 1.14, saturation: 1.1 },
  // ---- A3: cymbals pull back (bars 33-39), the air goes hazy ---------------
  { t: 75.5, haze: 1.0, fog: 0.0012, horizon: 0xe8c8a0, zenith: 0x8a9cb4, contrast: 1.04, saturation: 0.95 },
  { t: 90.2, haze: 1.0, fog: 0.0012, horizon: 0xe8c8a0, zenith: 0x8a9cb4, contrast: 1.04, saturation: 0.95 },
  // bar 40: cymbals crash back, the haze clears in one bar
  { t: 91.4, sunElev: 26, sunColor: 0xffe2b8, sunPower: 1.2, zenith: 0x467ab6, horizon: 0xeac496, exposure: 0.9, haze: 0.6, fog: 0.0005, contrast: 1.15, saturation: 1.12 },
  // ---- A4: white noon, heat ---------------------------------------------------
  { t: 111.2, sunElev: 55, sunAzim: 115, sunColor: 0xfff0d8, sunPower: 1.2, zenith: 0x3a72bc, horizon: 0xd8c4a6, ambient: 0x7a6a5e, fog: 0.00045,
    haze: 0.32, exposure: 0.82, contrast: 1.2, saturation: 0.92, shimmer: 1.0, rays: 0.3, clouds: 0.0 },
  { t: 146.0, shimmer: 1.0, saturation: 0.92 },
  // ---- A5: something listens, colour drains ---------------------------------
  { t: 149.5, sunElev: 42, sunColor: 0xe6caa4, sunPower: 0.78, horizon: 0xc49c76, zenith: 0x8a8c90, ambient: 0x786a5c, fog: 0.0016, haze: 1.0,
    contrast: 1.06, saturation: 0.6, shimmer: 0.4 },
  { t: 166.0, sunElev: 40, sunPower: 0.7, exposure: 0.9, saturation: 0.5 },
  { t: 170.4, sunElev: 38, sunAzim: 110, exposure: 0.88, saturation: 0.55, shimmer: 0.1 },
  // ---- B1: time-lapse down to late afternoon ----------------------------------
  { t: 178.7, sunElev: 8, sunAzim: 88, sunColor: 0xff9a48, sunPower: 1.2, zenith: 0x54709c, horizon: 0xf09a5a, ambient: 0x684a40, fog: 0.0008,
    haze: 0.85, exposure: 1.0, saturation: 1.1, contrast: 1.14, shimmer: 0, rays: 0.8, clouds: 0.3 },
  // ---- B4: burning sunset ride --------------------------------------------------
  { t: 200.6, sunElev: 4.5, sunColor: 0xff7a34, sunPower: 1.35, zenith: 0x4e4672, horizon: 0xf07a3c, ambient: 0x6a4038, saturation: 1.2, bloom: 0.6, rays: 1.0, clouds: 0.55 },
  { t: 236.25, sunElev: 3.5, storm: 0.0, fog: 0.0008 },
  // ---- B5: inside the storm (the wall hits on the bar-99 downbeat) --------------
  { t: 236.7, storm: 0.88, sunPower: 0.45, horizon: 0x9a5430, zenith: 0x4a2c1c, ambient: 0x5a3a28, fog: 0.0016, saturation: 0.95, contrast: 1.18, bloom: 0.3, rays: 0.3, clouds: 0 },
  { t: 257.62, storm: 0.88, sunElev: 3.5, night: 0, exposure: 1.0 },
  // ---- eye of the storm (bass out at 4:17.6): night, two moons ---------------
  { t: 258.9, storm: 0.0, sunElev: -15, sunPower: 0.0, zenith: 0x050a20, horizon: 0x1e2a4c, ambient: 0x1c2646, sand: 0xa8866e, night: 1, fog: 0.0006,
    haze: 0.25, exposure: 1.25, saturation: 0.85, contrast: 1.12, lift: 0x03050c, bloom: 0.7, shadowTint: [0.0, 0.02, 0.08], highTint: [-0.01, 0.01, 0.04] },
  { t: 300.0, night: 1, sunElev: -12 },
  // ---- B7: dawn bleeds into the night sky --------------------------------------
  { t: 309.0, sunElev: -3.5, sunAzim: 88, sunColor: 0xff9a70, sunPower: 0.5, zenith: 0x1e2c50, horizon: 0x9a5a6c, ambient: 0x3a3448, night: 0.45,
    sand: 0xc4864e, saturation: 0.95, clouds: 0.5, lift: 0x06060e, shadowTint: [0.0, 0.03, 0.07], highTint: [0.05, 0.01, -0.02] },
  // ---- ring-out: pale dawn --------------------------------------------------------
  { t: 316.0, sunElev: 1.6, sunColor: 0xffb47c, sunPower: 0.95, zenith: 0x48587c, horizon: 0xe2a88c, ambient: 0x5e5058, night: 0.0, haze: 0.85,
    exposure: 1.0, saturation: 0.9, clouds: 0.6, rays: 0.7 },
];
