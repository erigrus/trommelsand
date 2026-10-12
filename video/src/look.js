// Colour script from docs/02-storyboard.md as keyframes over music time.
// Shots may override any value for their duration (see timeline.js).
//
// sunElev/sunAzim in degrees. Azimuth 90 = sun toward +x (the "east" every
// silhouette shot looks into); 0 = toward -z.

export const LOOK = [
  { t: 0.0, sunElev: -7, sunAzim: 85, sunColor: 0xff8a50, sunPower: 0.4, zenith: 0x0e1430, horizon: 0x4a3650, ambient: 0x1d2034, sand: 0xc08453, fog: 0.0011, haze: 0.5, night: 0.25, storm: 0, exposure: 0.9, contrast: 1.05, saturation: 0.9, lift: 0x0a0812, gain: 0xffffff, bloom: 0.25, shimmer: 0 },
  { t: 12.0, sunElev: -3, sunAzim: 85, sunColor: 0xff9050, sunPower: 0.6, zenith: 0x24304e, horizon: 0x9a6a5c, ambient: 0x3a3442, night: 0.05 },
  { t: 17.4, sunElev: 1.2, sunAzim: 85, sunColor: 0xffa860, sunPower: 1.0, zenith: 0x4a5c7e, horizon: 0xe8a066, ambient: 0x5a4a48, night: 0, haze: 0.8, bloom: 0.45 },
  { t: 38.0, sunElev: 7, sunAzim: 88, sunColor: 0xffc890, sunPower: 1.0, zenith: 0x6e86a8, horizon: 0xf0bc86, ambient: 0x786050, haze: 0.6, bloom: 0.35 },
  { t: 74.6, sunElev: 16, sunAzim: 95, sunColor: 0xffd8a8, zenith: 0x7e96b4, horizon: 0xf0c898, ambient: 0x887060, fog: 0.0009 },
  { t: 88.0, haze: 0.9, fog: 0.0014, horizon: 0xe6c49c },
  { t: 99.0, haze: 0.9, fog: 0.0014, horizon: 0xe6c49c },
  { t: 111.2, sunElev: 48, sunAzim: 110, sunColor: 0xfff0dc, sunPower: 1.15, zenith: 0x9ab2ca, horizon: 0xf2dcc0, ambient: 0x9a8a78, fog: 0.0008, haze: 0.5, exposure: 1.0, contrast: 1.12, saturation: 0.85, shimmer: 1.0 },
  { t: 145.0, shimmer: 1.0, saturation: 0.85 },
  { t: 150.0, sunElev: 40, sunColor: 0xe8c8a0, sunPower: 0.8, horizon: 0xc8a27a, zenith: 0x8a8e94, ambient: 0x786a5a, fog: 0.0018, haze: 1.0, saturation: 0.65, shimmer: 0.4 },
  { t: 170.5, sunElev: 38, sunAzim: 110, sunColor: 0xe8c8a0, sunPower: 0.8, horizon: 0xc8a27a, zenith: 0x8a8e94, fog: 0.0016, saturation: 0.7, shimmer: 0.2 },
  { t: 178.7, sunElev: 9, sunAzim: 92, sunColor: 0xffa050, sunPower: 1.05, zenith: 0x5e7296, horizon: 0xf0a060, ambient: 0x6a4c40, fog: 0.0010, haze: 0.8, saturation: 1.0, contrast: 1.1, shimmer: 0 },
  { t: 200.7, sunElev: 6, sunAzim: 90, sunColor: 0xff8a3a, sunPower: 1.15, zenith: 0x6a5e78, horizon: 0xf08a48, ambient: 0x6a4434, saturation: 1.15, bloom: 0.5 },
  { t: 234.0, storm: 0.0, fog: 0.0010 },
  { t: 237.5, storm: 0.9, sunPower: 0.35, horizon: 0x9a5a32, zenith: 0x5a3a26, ambient: 0x5a3a28, fog: 0.0016, saturation: 0.9, bloom: 0.3 },
  { t: 255.0, storm: 0.9, sunElev: 4, night: 0 },
  { t: 257.5, storm: 0.0, sunElev: -14, sunPower: 0.0, zenith: 0x080c22, horizon: 0x26304e, ambient: 0x24304a, sand: 0xa88a7a, night: 1, fog: 0.0007, haze: 0.2, exposure: 1.15, saturation: 0.8, lift: 0x04060e, bloom: 0.55 },
  { t: 300.0, night: 1, sunElev: -12 },
  { t: 310.4, sunElev: -4, sunAzim: 85, sunColor: 0xff9a70, sunPower: 0.4, zenith: 0x24304e, horizon: 0x8a5a66, ambient: 0x3a3442, night: 0.5, sand: 0xc08453, saturation: 0.9, lift: 0x0a0812 },
  { t: 316.0, sunElev: 1.5, sunColor: 0xffb880, sunPower: 0.8, zenith: 0x4c5c7c, horizon: 0xd8a890, ambient: 0x6a5a5a, night: 0.0, haze: 0.7, exposure: 1.0, saturation: 0.85 },
];
