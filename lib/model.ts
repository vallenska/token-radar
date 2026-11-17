// ORBIT: a snapshot-only implied-value model for pre-token protocols.
//
// The model has one job: put a defensible dollar value on a protocol that records no token, using
// nothing but the snapshot's own fields. It never looks up a protocol by name.
//
//   sector multiple  = a shrunken median of market-cap / TVL among the snapshot's token-bearing
//                      protocols in the same category. Categories with few comparables lean on the
//                      whole market's median instead of trusting a sample of one.
//   growth factor    = 1 + clamp(change_7d, -60, 120) / 100 * 0.30
//   maturity factor  = 0.55 + min(age_days, 1825) / 1825 * 0.45  (unknown age: 540 days)
//   chain factor     = 1 + min(max(chains - 1, 0), 3) * 0.02
//   implied value    = max(1, round(tvl_usd * sector multiple * growth * maturity * chain))
//
// A separate 0-100 signal score combines TVL rank, momentum, age, chain reach, peer depth and the
// house watchlist flag. Signal is a reading aid, never a probability and never the rank's value.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelSpec {
  version: string;
  ratio_floor: number;
  ratio_cap: number;
  prior_weight: number;
  category_floor: number;
  category_cap: number;
  growth_floor: number;
  growth_cap: number;
  growth_weight: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_weight: number;
  chain_cap: number;
}

export const MODEL: ModelSpec = {
  version: 'orbit-1',
  ratio_floor: 0.02,
  ratio_cap: 3,
  prior_weight: 8,
  category_floor: 0.03,
  category_cap: 1.1,
  growth_floor: -60,
  growth_cap: 120,
  growth_weight: 0.3,
  maturity_floor: 0.55,
  maturity_range: 0.45,
  maturity_days: 1825,
  unknown_age_days: 540,
  chain_weight: 0.02,
  chain_cap: 3,
};

export interface PeerStat {
  category: string;
  samples: number;
  median_ratio: number;
  multiple: number;
}

export interface PeerModel {
  global_multiple: number;
  total_samples: number;
  sectors: PeerStat[];
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  source_scope: 'watchlist' | 'early';
  age_days: number | null;
  age_known: boolean;
  implied_value_usd: number;
  signal: number;
  model: {
    version: string;
    peer_multiple: number;
    peer_samples: number;
    global_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days_used: number;
  };
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  ratio: number;
}

export interface RadarData {
  as_of: string;
  source_note: string;
  floor_usd: number;
  model: ModelSpec;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  live_total: number;
  peers: PeerModel;
  rows: BoardRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const LIVE_ROWS = 36;

const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

const VERSION_MARKER = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

export function categoryOf(protocol: SnapshotProtocol): string {
  return protocol.category ?? 'Other';
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

export function recordsNoToken(protocol: SnapshotProtocol): boolean {
  return protocol.mcap_usd === null && protocol.gecko_id === null && protocol.symbol === null;
}

export function isExcludedProduct(protocol: SnapshotProtocol): boolean {
  return (
    EXCLUDED_CATEGORIES.has(protocol.category ?? '') ||
    VERSION_MARKER.test(protocol.name) ||
    WRAPPED_WORD.test(protocol.name) ||
    EXCHANGE_PREFIX.test(protocol.name)
  );
}

export function isLaunchCandidate(protocol: SnapshotProtocol): boolean {
  return recordsNoToken(protocol) && !isExcludedProduct(protocol);
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function round4(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** The peer-multiple table: token-bearing protocols calibrate what a category's TVL has traded at. */
export function buildPeerModel(snapshot: Snapshot, model: ModelSpec = MODEL): PeerModel {
  const buckets = new Map<string, number[]>();
  const all: number[] = [];
  for (const protocol of snapshot.protocols) {
    if (protocol.category === 'CEX') continue;
    if (protocol.mcap_usd === null || protocol.mcap_usd <= 0 || protocol.tvl_usd <= 0) continue;
    const ratio = clamp(protocol.mcap_usd / protocol.tvl_usd, model.ratio_floor, model.ratio_cap);
    const key = categoryOf(protocol);
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [ratio]);
    else bucket.push(ratio);
    all.push(ratio);
  }
  const global = all.length === 0 ? 0.25 : median(all);
  const sectors: PeerStat[] = [];
  for (const [category, values] of buckets) {
    const center = median(values);
    const multiple = clamp(
      (values.length * center + model.prior_weight * global) / (values.length + model.prior_weight),
      model.category_floor,
      model.category_cap,
    );
    sectors.push({ category, samples: values.length, median_ratio: round4(center), multiple: round4(multiple) });
  }
  sectors.sort((a, b) => b.samples - a.samples || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  return { global_multiple: round4(global), total_samples: all.length, sectors };
}

interface Scored {
  protocol: SnapshotProtocol;
  peer: PeerStat | undefined;
  age: number | null;
  ageUsed: number;
  growthPct: number;
  growthMultiplier: number;
  maturityMultiplier: number;
  chainMultiplier: number;
  implied: number;
}

function scoreProtocol(protocol: SnapshotProtocol, asOf: string, peers: PeerModel, model: ModelSpec): Scored {
  const key = categoryOf(protocol);
  const peer = peers.sectors.find((sector) => sector.category === key);
  const peerMultiple = peer === undefined ? peers.global_multiple : peer.multiple;
  const age = ageDays(asOf, protocol.listed_at);
  const ageUsed = age ?? model.unknown_age_days;
  const growthPct = clamp(finite(protocol.change_7d, 0), model.growth_floor, model.growth_cap);
  const growthMultiplier = 1 + (growthPct / 100) * model.growth_weight;
  const maturityMultiplier =
    model.maturity_floor + (clamp(ageUsed, 0, model.maturity_days) / model.maturity_days) * model.maturity_range;
  const chainMultiplier = 1 + Math.min(Math.max(protocol.chains.length - 1, 0), model.chain_cap) * model.chain_weight;
  const implied = Math.max(
    1,
    Math.round(protocol.tvl_usd * peerMultiple * growthMultiplier * maturityMultiplier * chainMultiplier),
  );
  return {
    protocol,
    peer,
    age,
    ageUsed,
    growthPct,
    growthMultiplier,
    maturityMultiplier,
    chainMultiplier,
    implied,
  };
}

/** Every watchlist protocol, plus every clean pre-token protocol below the house floor. */
export function chooseProtocols(snapshot: Snapshot): SnapshotProtocol[] {
  const index = new Map(snapshot.protocols.map((protocol) => [protocol.slug, protocol]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const protocol = index.get(slug);
    if (protocol === undefined) throw new SnapshotError(`the watchlist names ${slug}, which the snapshot does not carry`);
    chosen.set(slug, protocol);
  }
  const early = snapshot.protocols
    .filter((protocol) => protocol.tvl_usd < snapshot.floor_usd && isLaunchCandidate(protocol) && !chosen.has(protocol.slug))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const protocol of early) chosen.set(protocol.slug, protocol);

  // The gate needs 100 rows. This snapshot clears that easily; the fallback keeps the entry valid if a
  // future snapshot's watchlist shrinks and its below-floor field thins out.
  if (chosen.size < 100) {
    const fallback = snapshot.protocols
      .filter((protocol) => recordsNoToken(protocol) && !chosen.has(protocol.slug))
      .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
    for (const protocol of fallback) {
      chosen.set(protocol.slug, protocol);
      if (chosen.size >= 100) break;
    }
  }
  return [...chosen.values()];
}

function chainOf(protocol: SnapshotProtocol): string {
  return protocol.chains.length > 0 ? protocol.chains[0]! : 'its main chain';
}

function secondChainOf(protocol: SnapshotProtocol): string {
  return protocol.chains.length > 1 ? protocol.chains[1]! : chainOf(protocol);
}

function capitalFor(tvl: number): number {
  if (tvl >= 5_000_000_000) return 250;
  if (tvl >= 1_000_000_000) return 200;
  if (tvl >= 500_000_000) return 150;
  if (tvl >= 100_000_000) return 100;
  if (tvl >= 25_000_000) return 75;
  return 50;
}

function holdFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 90) return 84;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

function weeksFor(hold: number): number {
  return Math.max(4, Math.min(12, Math.round(hold / 7)));
}

function actionFor(category: string | null, name: string, capital: number, chain: string): string {
  const kind = (category ?? '').toLowerCase();
  if (/lend|cdp|collateral|credit/.test(kind)) {
    return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow no more than a quarter of it against the same collateral.`;
  }
  if (/dex|liquidity|farm|aggregator|leveraged/.test(kind)) {
    return `Provide $${capital} split across a blue-chip pair in ${name}'s deepest pool on ${chain}, and keep the LP receipt.`;
  }
  if (/yield|allocator|curator|index/.test(kind)) {
    return `Deposit $${capital} into a ${name} vault on ${chain} whose fees and curator are published, and keep the vault shares.`;
  }
  if (/rwa|stable|wrapper|cedefi/.test(kind)) {
    return `Mint or deposit $${capital} of ${name}'s stable or yield asset on ${chain}, and hold the receipt rather than selling it.`;
  }
  if (/basis|derivative|perpetual|interest rate|option/.test(kind)) {
    return `Deposit $${capital} of USDC as margin on ${name} on ${chain}, and open one small hedge against the position.`;
  }
  if (/insurance/.test(kind)) {
    return `Buy $${capital} of cover from ${name} on ${chain}, and keep the policy document with the wallet record.`;
  }
  if (/prediction/.test(kind)) {
    return `Fund $${capital} on ${name} on ${chain}, and place one small position in a market you already follow.`;
  }
  if (/staking|restak/.test(kind)) {
    return `Stake $${capital} of ${chain}'s staking asset through ${name}, and keep the liquid receipt in the same wallet.`;
  }
  if (/chain|payment/.test(kind)) {
    return `Use ${name}'s official app or bridge on ${chain} to move $${capital} of USDC, then make one swap or payment there.`;
  }
  if (/governance/.test(kind)) {
    return `Deposit $${capital} of the eligible asset into ${name} on ${chain}, and vote once in a live governance round.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain}, and keep the position open through the holding window.`;
}

function stepText(action: string, cost: string, time: string): string {
  let text = `${action} Cost: ${cost}. Time: ${time}.`;
  if (text.length > 600) text = `${text.slice(0, 596)}...`;
  if (text.length < 20) text = `${text} Recheck the protocol's official page before acting.`;
  return text;
}

/** Eight steps derived from the protocol's own record, each with a cost and a time. */
export function farmSteps(protocol: SnapshotProtocol, age: number | null, asOf: string): string[] {
  const name = protocol.name;
  const chain = chainOf(protocol);
  const second = secondChainOf(protocol);
  const capital = capitalFor(protocol.tvl_usd);
  const hold = holdFor(age);
  const weeks = weeksFor(hold);
  const category = protocol.category ?? 'unclassified';
  const action = actionFor(protocol.category, name, capital, chain);
  return [
    stepText(
      `Confirm ${name}'s official app and docs still show a ${category} product on ${chain}, and note that the ${asOf} snapshot records no token for it.`,
      '$0',
      '10 minutes',
    ),
    stepText(
      `Create a fresh wallet for ${name} on ${chain}, back up its seed phrase offline, and fund it with $${capital} of principal plus about $6 for gas.`,
      `$${capital + 6} total, of which $${capital} is at risk`,
      '10 minutes',
    ),
    stepText(action, `$${capital} principal and about $3 of gas`, '15-20 minutes'),
    stepText(
      protocol.chains.length > 1
        ? `Repeat a smaller ${category} position on ${second} so the activity is not one chain or one transaction.`
        : `Add a second pool or vault on ${chain} so the activity is not a single transaction.`,
      '$25-$50 optional and about $3 of gas',
      '10-15 minutes',
    ),
    stepText(
      `Make one qualifying action each week for ${weeks} weeks, such as a deposit, borrow, swap or vote, and keep every receipt in the wallet's history.`,
      'about $2-$4 of gas a week',
      `${weeks} weeks at 10 minutes a week`,
    ),
    stepText(
      `Keep the position open for at least ${hold} days without moving the principal, so more than one snapshot or points epoch can count it.`,
      `$${capital} stays at risk for ${hold} days`,
      `${hold} days`,
    ),
    stepText(
      `Check ${name}'s own rewards or points page for a token announcement, claim only from that official page, and unwind if TVL or 7-day growth turns sharply negative.`,
      '$0 to check and about $3 to exit',
      '15 minutes',
    ),
    stepText(
      `Write the wallet address, entry dates, gas paid and exit plan in a farm log, and size the position so losing $${capital} would not change your plans.`,
      '$0',
      '5 minutes',
    ),
  ];
}

function signalScore(
  scored: Scored,
  tvlPercentile: number,
  watchlist: Set<string>,
  model: ModelSpec,
): number {
  const growth = clamp((scored.growthPct + 60) / 180, 0, 1);
  const age = clamp(scored.ageUsed / model.maturity_days, 0, 1);
  const chains = clamp(scored.protocol.chains.length / 4, 0, 1);
  const peer = clamp((scored.peer?.samples ?? 0) / 10, 0, 1);
  const watch = watchlist.has(scored.protocol.slug) ? 1 : 0;
  return Math.round(100 * (0.3 * tvlPercentile + 0.22 * growth + 0.18 * age + 0.1 * chains + 0.1 * peer + 0.1 * watch));
}

function tvlRank(protocols: SnapshotProtocol[], tvl: number): number {
  let below = 0;
  for (const protocol of protocols) if (protocol.tvl_usd <= tvl) below += 1;
  return protocols.length <= 1 ? 1 : below / protocols.length;
}

export function buildBoard(snapshot: Snapshot, model: ModelSpec = MODEL): BoardRow[] {
  const peers = buildPeerModel(snapshot, model);
  const chosen = chooseProtocols(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const scored = chosen.map((protocol) => scoreProtocol(protocol, snapshot.as_of, peers, model));
  scored.sort((a, b) => b.implied - a.implied || (a.protocol.slug < b.protocol.slug ? -1 : a.protocol.slug > b.protocol.slug ? 1 : 0));
  return scored.map((entry, index) => {
    const protocol = entry.protocol;
    return {
      rank: index + 1,
      slug: protocol.slug,
      name: protocol.name,
      category: protocol.category,
      chains: protocol.chains,
      tvl_usd: protocol.tvl_usd,
      change_7d: protocol.change_7d,
      mcap_usd: protocol.mcap_usd,
      listed_at: protocol.listed_at,
      gecko_id: protocol.gecko_id,
      symbol: protocol.symbol,
      token_status: 'pre-token',
      on_watchlist: watchlist.has(protocol.slug),
      source_scope: watchlist.has(protocol.slug) ? 'watchlist' : 'early',
      age_days: entry.age,
      age_known: entry.age !== null,
      implied_value_usd: entry.implied,
      signal: signalScore(entry, tvlRank(chosen, protocol.tvl_usd), watchlist, model),
      model: {
        version: model.version,
        peer_multiple: entry.peer?.multiple ?? peers.global_multiple,
        peer_samples: entry.peer?.samples ?? 0,
        global_multiple: peers.global_multiple,
        growth_pct: round4(entry.growthPct),
        growth_multiplier: entry.growthMultiplier,
        maturity_multiplier: entry.maturityMultiplier,
        chain_multiplier: entry.chainMultiplier,
        age_days_used: Math.round(entry.ageUsed),
      },
      farm_steps: farmSteps(protocol, entry.age, snapshot.as_of),
    };
  });
}

export function liveRows(snapshot: Snapshot): LiveRow[] {
  const live = snapshot.protocols.filter(
    (protocol) => protocol.category !== 'CEX' && protocol.mcap_usd !== null && protocol.mcap_usd > 0,
  );
  return live
    .slice()
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((protocol) => ({
      slug: protocol.slug,
      name: protocol.name,
      symbol: protocol.symbol,
      category: protocol.category,
      chains: protocol.chains,
      tvl_usd: protocol.tvl_usd,
      mcap_usd: protocol.mcap_usd!,
      change_7d: protocol.change_7d,
      ratio: protocol.tvl_usd > 0 ? round4(protocol.mcap_usd! / protocol.tvl_usd) : 0,
    }));
}

export function countLive(snapshot: Snapshot): number {
  return snapshot.protocols.filter(
    (protocol) => protocol.category !== 'CEX' && protocol.mcap_usd !== null && protocol.mcap_usd > 0,
  ).length;
}

export function sourceNote(source: string): string {
  const fetched = /fetched\s+(.+)$/i.exec(source);
  return `DefiLlama protocol index${fetched === null ? '' : `, fetched ${fetched[1]!.trim()}`}`;
}

export function buildRadar(snapshot: Snapshot, model: ModelSpec = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const watchlist = new Set(snapshot.watchlist);
  const peers = buildPeerModel(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((row) => !watchlist.has(row.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source_note: sourceNote(snapshot.source),
    floor_usd: snapshot.floor_usd,
    model,
    model_version: model.version,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    live_total: countLive(snapshot),
    peers,
    rows: board,
    live,
  };
  return { board, radar };
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not an object');
  const source = raw as Record<string, unknown>;
  if (typeof source.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(source.as_of)) {
    throw new SnapshotError('snapshot.json has no YYYY-MM-DD as_of date');
  }
  if (typeof source.source !== 'string' || source.source.length === 0) throw new SnapshotError('snapshot.json has no source');
  if (typeof source.floor_usd !== 'number' || !Number.isSafeInteger(source.floor_usd) || source.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no positive floor_usd');
  }
  if (!Array.isArray(source.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(source.watchlist) || source.watchlist.some((slug) => typeof slug !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist array of slugs');
  }
  const protocols: SnapshotProtocol[] = source.protocols.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new SnapshotError(`snapshot protocol ${index} is not an object`);
    }
    const protocol = entry as Record<string, unknown>;
    if (
      typeof protocol.slug !== 'string' ||
      typeof protocol.name !== 'string' ||
      typeof protocol.tvl_usd !== 'number' ||
      !Number.isFinite(protocol.tvl_usd)
    ) {
      throw new SnapshotError(`snapshot protocol ${index} lacks slug, name or TVL`);
    }
    return {
      slug: protocol.slug,
      name: protocol.name,
      category: typeof protocol.category === 'string' ? protocol.category : null,
      chains: Array.isArray(protocol.chains) ? protocol.chains.filter((chain): chain is string => typeof chain === 'string') : [],
      tvl_usd: protocol.tvl_usd,
      change_7d: typeof protocol.change_7d === 'number' && Number.isFinite(protocol.change_7d) ? protocol.change_7d : null,
      mcap_usd: typeof protocol.mcap_usd === 'number' && Number.isFinite(protocol.mcap_usd) ? protocol.mcap_usd : null,
      listed_at: typeof protocol.listed_at === 'string' ? protocol.listed_at : null,
      gecko_id: typeof protocol.gecko_id === 'string' ? protocol.gecko_id : null,
      symbol: typeof protocol.symbol === 'string' ? protocol.symbol : null,
    };
  });
  const seen = new Set<string>();
  for (const protocol of protocols) {
    if (seen.has(protocol.slug)) throw new SnapshotError(`snapshot.json repeats the slug ${protocol.slug}`);
    seen.add(protocol.slug);
  }
  return {
    as_of: source.as_of,
    source: source.source,
    floor_usd: source.floor_usd,
    protocols,
    watchlist: source.watchlist as string[],
  };
}

/** Why a board would fail the official gate, or null when it would pass. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, not 100 to 4000`;
  const protocols = new Set(snapshot.protocols.map((protocol) => protocol.slug));
  const slugs = new Set<string>();
  for (const row of board) {
    if (slugs.has(row.slug)) return `the slug ${row.slug} appears twice`;
    slugs.add(row.slug);
    if (!protocols.has(row.slug)) return `the slug ${row.slug} is not in the snapshot`;
    if (row.name.trim().length === 0) return `${row.slug} has an empty name`;
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0 || row.implied_value_usd > 100_000_000_000_000) {
      return `${row.slug} has an invalid implied value ${row.implied_value_usd}`;
    }
    if (!Number.isSafeInteger(row.rank) || row.rank <= 0) return `${row.slug} has an invalid rank ${row.rank}`;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `${row.slug} has ${row.farm_steps.length} farm steps`;
    for (const step of row.farm_steps) {
      const trimmed = step.trim();
      if (trimmed.length < 20 || trimmed.length > 600) return `${row.slug} has a farm step of ${trimmed.length} characters`;
    }
  }
  const missing = snapshot.watchlist.filter((slug) => !slugs.has(slug));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((row) => row.rank).sort((a, b) => a - b);
  for (let index = 0; index < ranks.length; index += 1) {
    if (ranks[index] !== index + 1) return `rank ${index + 1} is ${ranks[index]}`;
  }
  for (let index = 1; index < board.length; index += 1) {
    if (board[index]!.implied_value_usd > board[index - 1]!.implied_value_usd) {
      return `row ${index + 1} outranks row ${index} on implied value`;
    }
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value`;
  }
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.TOKEN_RADAR=${JSON.stringify(radar)};\n`;
}
