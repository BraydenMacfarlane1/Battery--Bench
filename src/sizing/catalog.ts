/** Small C&I cabinet sizes. Stacks are repeats of a single module. */
export const CATALOG_PACK_KWH = [40, 60, 80, 100] as const;

export type CatalogSnap = {
  pack_kwh: number;
  count: number;
  nameplate_kwh: number;
};

function stacksNeeded(requiredKwh: number, packKwh: number): number {
  const raw = requiredKwh / packKwh;
  const nearest = Math.round(raw);
  if (Math.abs(raw - nearest) < 1e-6) return Math.max(1, nearest);
  return Math.ceil(raw);
}

/**
 * Cover E_nameplate with the smallest stack of one module size.
 * Ties prefer the 60 kWh module (worked examples A and B). If 60 is not in the tie, prefer the larger module.
 */
export function coveringSnaps(requiredKwh: number): CatalogSnap[] {
  if (!(requiredKwh > 0)) return [];
  const options = CATALOG_PACK_KWH.map((pack) => {
    const count = stacksNeeded(requiredKwh, pack);
    const nameplate = pack * count;
    return {
      pack_kwh: pack,
      count,
      nameplate_kwh: nameplate,
      overshoot: nameplate - requiredKwh,
    };
  });
  const minOver = Math.min(...options.map((option) => option.overshoot));
  const tied = options.filter((option) => Math.abs(option.overshoot - minOver) < 1e-6);
  tied.sort((a, b) => {
    if (a.pack_kwh === 60) return -1;
    if (b.pack_kwh === 60) return 1;
    return b.pack_kwh - a.pack_kwh;
  });
  return tied.map(({ pack_kwh, count, nameplate_kwh }) => ({ pack_kwh, count, nameplate_kwh }));
}

export function snapCatalog(requiredKwh: number): CatalogSnap | null {
  return coveringSnaps(requiredKwh)[0] ?? null;
}
