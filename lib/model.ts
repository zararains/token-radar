// Token Radar's model: turn the sealed DefiLlama snapshot into a ranked board
// of protocols that record no token yet, each with the value a launch would
// carry if the protocol's record stayed as it is, and a plan for farming it.
//
// The model reads nothing but the snapshot's own figures. Its yardstick is the
// snapshot itself: protocols whose token already trades show what the market
// pays per dollar of TVL, category by category, and that multiple — shrunk
// toward the whole-market median where a category's evidence is thin — is
// what a pre-token protocol's TVL is priced at. Three adjustments, each from
// a snapshot field, move the base figure: the week's TVL momentum, the years
// the protocol has run with no token recorded, and the number of chains it
// already reaches. Nothing is keyed to a protocol's name.

export interface Protocol {
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
  protocols: Protocol[];
  watchlist: string[];
}

export interface Factors {
  multiple: number;
  momentum: number;
  seasoning: number;
  reach: number;
}

export interface Row {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_years: number | null;
  watchlist: boolean;
  factors: Factors;
}

export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number | null;
  multiple: number | null;
}

export interface Radar {
  as_of: string;
  source: string;
  floor_usd: number;
  scanned: number;
  ranked: number;
  watchlist_size: number;
  live_size: number;
  global_multiple: number;
  category_multiples: Record<string, number>;
  category_evidence: Record<string, number>;
  rows: Row[];
  live: LiveRow[];
}

/** Parse the snapshot's JSON, checking the shape the model leans on. */
export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot: protocols and watchlist must be arrays');
  }
  return raw;
}

// ---------------------------------------------------------------------------
// Who belongs on a launch radar at all
// ---------------------------------------------------------------------------

/** Categories that are a traded token wearing another shape, never a launch. */
const PRODUCT_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_HEADS = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/**
 * A protocol is a launch candidate when DefiLlama records no token for it and
 * it is not a wrapped, staked, bridged or exchange product of one that
 * trades, nor a later version of a protocol that already launched. The same
 * exclusions the house applied to its watchlist, applied at every size: the
 * watchlist is a floor, and the radar's work is everything underneath it.
 */
export function isLaunchCandidate(p: Protocol): boolean {
  if (p.gecko_id !== null || p.symbol !== null) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  if (PRODUCT_WORD.test(p.name)) return false;
  if (EXCHANGE_HEADS.some((head) => p.name.startsWith(head))) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The yardstick: what a dollar of TVL is worth once a token trades
// ---------------------------------------------------------------------------

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const RATIO_FLOOR = 0.02;
const RATIO_CEILING = 5;

export interface Multiples {
  global: number;
  byCategory: Map<string, number>;
  evidence: Map<string, number>;
}

/**
 * Market cap per TVL dollar for every protocol in the snapshot whose token
 * trades and whose cap is reported, winsorised so one runaway ratio cannot
 * bend the yardstick. A category with at least five such protocols earns its
 * own multiple, pulled toward the global median in proportion to how little
 * evidence backs it; thinner categories inherit the global figure.
 */
export function deriveMultiples(snapshot: Snapshot): Multiples {
  const ratios: number[] = [];
  const perCategory = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (p.gecko_id === null && p.symbol === null) continue;
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = Math.min(RATIO_CEILING, Math.max(RATIO_FLOOR, p.mcap_usd / p.tvl_usd));
    ratios.push(ratio);
    if (p.category !== null) {
      const list = perCategory.get(p.category) ?? [];
      list.push(ratio);
      perCategory.set(p.category, list);
    }
  }
  const global = median(ratios);
  const byCategory = new Map<string, number>();
  const evidence = new Map<string, number>();
  for (const [category, list] of perCategory) {
    evidence.set(category, list.length);
    if (list.length >= 5) {
      const own = median(list);
      byCategory.set(category, (list.length * own + 6 * global) / (list.length + 6));
    }
  }
  return { global, byCategory, evidence };
}

// ---------------------------------------------------------------------------
// The three adjustments
// ---------------------------------------------------------------------------

/** A week of TVL growth is demand arriving early: +10% adds 6%, capped. */
export function momentumFactor(change7d: number | null): number {
  if (change7d === null) return 1;
  return Math.min(1.45, Math.max(0.82, 1 + 0.006 * change7d));
}

/** Whole days between two YYYY-MM-DD dates, UTC. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * Years run with no token recorded are seasons of users a launch can claim
 * on day one. The premium grows with the log of the age, so a fourth year
 * adds less than the first.
 */
export function seasoningFactor(listedAt: string | null, asOf: string): number {
  if (listedAt === null) return 1;
  const days = daysBetween(listedAt, asOf);
  if (days <= 0) return 1;
  return 1 + 0.22 * Math.log10(1 + days / 365);
}

/** Every extra chain is another community the launch reaches at once. */
export function reachFactor(chainCount: number): number {
  return 1 + 0.03 * Math.min(Math.max(chainCount - 1, 0), 8);
}

export function impliedValue(p: Protocol, multiples: Multiples, asOf: string): { value: number; factors: Factors } {
  const multiple =
    (p.category !== null ? multiples.byCategory.get(p.category) : undefined) ?? multiples.global;
  const factors: Factors = {
    multiple,
    momentum: momentumFactor(p.change_7d),
    seasoning: seasoningFactor(p.listed_at, asOf),
    reach: reachFactor(p.chains.length),
  };
  const raw = p.tvl_usd * factors.multiple * factors.momentum * factors.seasoning * factors.reach;
  return { value: Math.max(1, Math.round(raw)), factors };
}

// ---------------------------------------------------------------------------
// Farm plans
// ---------------------------------------------------------------------------

type ChainClass = 'ethereum' | 'layer2' | 'solana' | 'other';

const LAYER2 = new Set([
  'Arbitrum', 'Base', 'Optimism', 'zkSync Era', 'Linea', 'Scroll', 'Mantle', 'Polygon', 'Polygon zkEVM',
  'Blast', 'Mode', 'Taiko', 'Starknet', 'Manta', 'Zora', 'BSC', 'Avalanche', 'Fantom', 'Sonic', 'Berachain',
  'Monad', 'Abstract', 'Ink', 'Soneium', 'Unichain', 'World Chain', 'Bob', 'Fraxtal', 'Metis', 'Gnosis',
]);

function chainClass(chain: string): ChainClass {
  if (chain === 'Ethereum') return 'ethereum';
  if (chain === 'Solana') return 'solana';
  if (LAYER2.has(chain)) return 'layer2';
  return 'other';
}

const GAS_PHRASE: Record<ChainClass, string> = {
  ethereum: 'about $8 to $30 of gas per transaction on Ethereum mainnet',
  layer2: 'about $0.10 to $2 of gas per transaction at layer-2 prices',
  solana: 'a few cents of fees per transaction on Solana',
  other: 'about $1 to $5 of gas per transaction',
};

const SEASON_BUDGET: Record<ChainClass, string> = {
  ethereum: '$150 to $400 of gas across the season',
  layer2: '$15 to $60 of gas across the season',
  solana: 'under $20 of fees across the season',
  other: '$40 to $120 of gas across the season',
};

/** Position sizing that stays meaningful without ever dominating the pool. */
function sizePhrase(tvl: number): string {
  if (tvl >= 500_000_000) return 'a $2,000 to $10,000 position';
  if (tvl >= 50_000_000) return 'a $500 to $5,000 position';
  if (tvl >= 10_000_000) return 'a $250 to $2,000 position';
  return 'a $100 to $1,000 position, kept under a tenth of a percent of its TVL';
}

interface Playbook {
  core: string;
  second: string;
}

/** What farming actually consists of, per kind of protocol. {slots} filled per row. */
const PLAYBOOKS: Record<string, Playbook> = {
  Lending: {
    core: 'Supply {size} of a major stablecoin or ETH into {name} on {chain} and leave it supplied; deposit balances are the first thing most points programs weigh, and they are visible on-chain from day one.',
    second: 'Borrow a small amount against the deposit, at most a quarter of its value, and repay it within the week; a clean borrow and repay history marks the wallet as a real user rather than a parked balance.',
  },
  Dexs: {
    core: 'Trade on {name} on {chain} every week, starting with {size} of volume across the season in the deepest pairs; swap count and volume are the metrics exchange launches have historically rewarded.',
    second: 'Provide liquidity to one of the two deepest pools with {size} and hold the position for at least four weeks, rebalancing only when the range breaks, so the position reads as liquidity and not churn.',
  },
  Derivatives: {
    core: 'Open and close modest perpetual positions on {name} on {chain} each week, risking no more than 1% of {size} per trade; steady volume over many weeks is what derivatives launches have rewarded, not one large trade.',
    second: 'Post {size} as margin or into the venue\'s house vault if it offers one, and keep it there between trades so the wallet shows commitment to the venue rather than drive-by volume.',
  },
  Yield: {
    core: 'Deposit {size} into the flagship vault of {name} on {chain} and hold it there; vault shares accrue the record of participation that a launch snapshot would read.',
    second: 'Rotate a smaller second deposit, about a fifth of the first, into a newer vault each month; early depositors in fresh vaults are usually counted separately from the flagship crowd.',
  },
  'Yield Aggregator': {
    core: 'Deposit {size} into the main auto-compounding vault of {name} on {chain} and let it compound untouched for the season; holding time, not deposit count, is the signal worth building.',
    second: 'Use the aggregator\'s routing for swaps you would make anyway, a few each week, so the wallet carries both vault history and product usage before any snapshot is taken.',
  },
  CDP: {
    core: 'Open a collateral position in {name} on {chain}: deposit ETH or a liquid staking token and mint about a third of {size} in its stablecoin, keeping the health factor comfortably above liquidation.',
    second: 'Use the minted stablecoin inside the same ecosystem, in a liquidity pool or a lending market, and hold both sides for the season; two-sided usage is harder to mistake for farming.',
  },
  RWA: {
    core: 'Complete the onboarding and KYC of {name} where it asks for it, then hold {size} of its flagship real-world asset product; verified holders are a small, countable set a launch can reward directly.',
    second: 'Hold the position through at least two full yield distributions without selling; distribution history separates long-term holders from wallets that arrived for a headline.',
  },
  'Risk Curators': {
    core: 'Deposit {size} of stablecoins into a vault curated by {name} on {chain}, choosing its largest vault; curator launches would read vault deposits, and the largest vault is where the record is clearest.',
    second: 'Spread a second deposit, about half the first, into a vault the curator runs on another chain or asset, and hold both for the season; breadth across a curator\'s book is a distinct signal from one deposit.',
  },
  'Onchain Capital Allocator': {
    core: 'Allocate {size} into the flagship strategy of {name} on {chain} and keep it allocated; allocator tokens, if they come, would be read off exactly these balances.',
    second: 'Move a small slice, about a fifth, into the allocator\'s newest strategy within its first month; early allocators are the cohort most launches single out.',
  },
  'Basis Trading': {
    core: 'Deposit {size} of stablecoins or ETH into {name} on {chain} and hold the basis position through the season; the position itself is the participation record, so time in it is what counts.',
    second: 'Add to the position on a monthly rhythm rather than in one lump, so the wallet shows a deposit history spread across the season instead of a single day\'s balance.',
  },
  Chain: {
    core: 'Bridge {size} to the chain through its canonical route and transact on it weekly: swaps, one contract deployment if you can, and gas spent across at least ten distinct weeks.',
    second: 'Use two or three of the chain\'s native applications with the bridged funds and keep a balance on the chain at all times; chain launches weigh wallets that stayed, not wallets that visited.',
  },
  'Prediction Market': {
    core: 'Trade on {name} every week with {size} spread across many small positions in liquid markets; breadth of markets traded and weeks active are the records a launch would most plausibly read.',
    second: 'Provide liquidity to one or two long-running markets and leave the quotes up between visits; makers are scarcer than takers and are usually counted as their own cohort.',
  },
  Indexes: {
    core: 'Buy and hold {size} of the flagship index product of {name} on {chain}; an index launch would snapshot holders, and a balance held for months is the record to build.',
    second: 'Add a fixed small amount on the same day each month, so the wallet shows a holding pattern across the season rather than a single purchase timed to a rumour.',
  },
  Insurance: {
    core: 'Deposit {size} into the underwriting pool of {name} on {chain} and leave it underwriting for the season; capital at risk for real cover is the participation this kind of protocol can verify.',
    second: 'Buy one small cover policy for a position you actually hold elsewhere; a wallet that is both underwriter and customer is the rarest record an insurance protocol keeps.',
  },
  Payments: {
    core: 'Route real payments through {name}: pay one recurring bill or invoice a month with {size} flowing through it across the season, since payment volume from genuine use is its core metric.',
    second: 'Hold a working balance in the app between payments rather than emptying it each time; average balance is the second figure a payments launch can read.',
  },
  Farm: {
    core: 'Stake {size} in the flagship farm of {name} on {chain} and compound the rewards back weekly; the compounding transactions build the activity record a launch would count.',
    second: 'Enter one newer farm within its first fortnight with a fifth of the main stake; early positions in fresh farms are usually weighted apart from the mature pools.',
  },
  'Leveraged Farming': {
    core: 'Open a conservative leveraged position in {name} on {chain}, at most twice leverage on {size} of collateral, and keep it healthy through the season; duration matters more than size here.',
    second: 'Repay and reopen the position once a month rather than letting it sit untouched; a managed position shows a user, a forgotten one shows a parked balance.',
  },
  Restaking: {
    core: 'Restake {size} of ETH or a liquid staking token through {name} on {chain} and hold the restaked position; restaking balances are the direct input any launch in this category would snapshot.',
    second: 'Pick one actively validated service to secure, where the product asks for a choice, instead of leaving the delegation unset; deliberate delegation is a record most wallets never make.',
  },
  'Liquidity Manager': {
    core: 'Deposit {size} into a managed liquidity vault of {name} on {chain} and hold the shares for the season; vault share balances are the record its launch would read.',
    second: 'Hold a second, smaller position in a vault on a different pair or chain the manager runs, so the wallet appears across the manager\'s book and not in one pool only.',
  },
  default: {
    core: 'Use the core product of {name} on {chain} with {size} at stake: deposit, stake or trade as the product intends, and keep the position open; a genuine balance held over time is the record any launch reads first.',
    second: 'Add one secondary action the product offers, a second pool, a borrow, a vote or a smaller position on another chain, at about a fifth of the main stake, so the wallet reads as a user and not a single deposit.',
  },
};

/** A stable little hash so phrasing varies by protocol, never by run. */
function slugHash(slug: string): number {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return h;
}

const SETUP_OPENERS = [
  'Set up one wallet you fully control and fund it on {chain}',
  'Prepare a single wallet, the same one for the whole season, and fund it on {chain}',
  'Start with one wallet you control end to end, funded on {chain}',
];

const WATCH_NOTES = [
  'From the second week, check the protocol\'s own announcements weekly for a points program, a snapshot date or a token reveal, and keep your transaction hashes; if a claim opens it usually stays open only a few weeks.',
  'Keep a simple log of every transaction hash from the first week on, and check the protocol\'s announcements weekly; claim windows, when they come, are short and are announced there first.',
  'Screenshot your balances once a month and keep the hashes; if a snapshot or claim is announced, the wallets that can prove a season of activity are the ones already holding the records.',
];

/**
 * Five concrete steps per protocol: set up, do the core thing its category
 * consists of, do the second thing, keep a rhythm for a season, and watch
 * for the launch. Costs and durations are stated, sized to the protocol's
 * own TVL and priced by its main chain's fee class.
 */
export function farmPlan(p: Protocol): string[] {
  const book = (p.category !== null ? PLAYBOOKS[p.category] : undefined) ?? PLAYBOOKS.default!;
  const chain = p.chains[0] ?? 'Ethereum';
  const cls = chainClass(chain);
  const fill = (template: string): string =>
    template
      .replaceAll('{name}', p.name)
      .replaceAll('{chain}', chain)
      .replaceAll('{size}', sizePhrase(p.tvl_usd))
      .replaceAll('{gas}', GAS_PHRASE[cls]);
  const h = slugHash(p.slug);
  const setup =
    `${SETUP_OPENERS[h % SETUP_OPENERS.length]!.replace('{chain}', chain)}; ` +
    `the wallet costs nothing to make, bridging in costs ${GAS_PHRASE[cls]}, and the whole setup takes about 45 minutes. ` +
    `Use this one wallet for every step that follows, so the record gathers in a single place.`;
  const cadence =
    `Keep the rhythm for 8 to 12 weeks: one or two transactions a week, about 30 minutes of attention weekly, ` +
    `and a total budget of ${SEASON_BUDGET[cls]} on top of the position itself. A season of ordinary use is the ` +
    `pattern launches reward; a single busy weekend is the pattern they filter out.`;
  return [setup, fill(book.core), fill(book.second), cadence, WATCH_NOTES[h % WATCH_NOTES.length]!];
}

// ---------------------------------------------------------------------------
// The board and the radar payload
// ---------------------------------------------------------------------------

export function buildRadar(snapshot: Snapshot): Radar {
  const multiples = deriveMultiples(snapshot);
  const watch = new Set(snapshot.watchlist);
  const candidates = snapshot.protocols.filter(isLaunchCandidate);
  const scored = candidates.map((p) => {
    const { value, factors } = impliedValue(p, multiples, snapshot.as_of);
    return { p, value, factors };
  });
  scored.sort((a, b) => b.value - a.value || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
  const rows: Row[] = scored.map(({ p, value, factors }, i) => ({
    slug: p.slug,
    name: p.name,
    rank: i + 1,
    implied_value_usd: value,
    farm_steps: farmPlan(p),
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    listed_at: p.listed_at,
    age_years:
      p.listed_at === null ? null : Math.round((daysBetween(p.listed_at, snapshot.as_of) / 365) * 10) / 10,
    watchlist: watch.has(p.slug),
    factors: {
      multiple: Math.round(factors.multiple * 1000) / 1000,
      momentum: Math.round(factors.momentum * 1000) / 1000,
      seasoning: Math.round(factors.seasoning * 1000) / 1000,
      reach: Math.round(factors.reach * 1000) / 1000,
    },
  }));
  const tokenized = snapshot.protocols.filter((p) => p.gecko_id !== null || p.symbol !== null);
  const live: LiveRow[] = tokenized
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      symbol: p.symbol,
      category: p.category,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      multiple:
        p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0
          ? Math.round((p.mcap_usd / p.tvl_usd) * 1000) / 1000
          : null,
    }))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0))
    .slice(0, 80);
  const categoryMultiples: Record<string, number> = {};
  const categoryEvidence: Record<string, number> = {};
  for (const [category, value] of [...multiples.byCategory.entries()].sort()) {
    categoryMultiples[category] = Math.round(value * 1000) / 1000;
    categoryEvidence[category] = multiples.evidence.get(category) ?? 0;
  }
  return {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    scanned: snapshot.protocols.length,
    ranked: rows.length,
    watchlist_size: snapshot.watchlist.length,
    live_size: tokenized.length,
    global_multiple: Math.round(multiples.global * 1000) / 1000,
    category_multiples: categoryMultiples,
    category_evidence: categoryEvidence,
    rows,
    live,
  };
}

/** The dashboard's data file: the same figures the board was ranked by. */
export function dataScript(radar: Radar): string {
  return `window.RADAR = ${JSON.stringify(radar).replaceAll('</', '<\\/')};\n`;
}

/**
 * The gate's board rules, checked before anything is written: refuse early
 * and in our own words rather than hand the scorer a board it must refuse.
 */
export function boardIssue(rows: Row[], snapshot: Snapshot): string | null {
  if (rows.length < 100 || rows.length > 4000) return `board holds ${rows.length} rows, outside 100 to 4000`;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const row of rows) {
    if (!known.has(row.slug)) return `row names a protocol the snapshot does not: ${row.slug}`;
    if (seen.has(row.slug)) return `slug appears twice: ${row.slug}`;
    seen.add(row.slug);
    if (row.name.trim() === '') return `row ${row.slug} has an empty name`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0 || row.implied_value_usd > 100_000_000_000_000) {
      return `row ${row.slug} has an implied value outside the gate's bounds`;
    }
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `row ${row.slug} holds ${row.farm_steps.length} farm steps, outside 3 to 12`;
    }
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `row ${row.slug} holds a farm step of ${len} characters, outside 20 to 600`;
    }
  }
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist protocol missing from the board: ${slug}`;
  }
  const byRank = [...rows].sort((a, b) => a.rank - b.rank);
  for (let i = 0; i < byRank.length; i++) {
    if (byRank[i]!.rank !== i + 1) return `ranks are not exactly 1 to ${byRank.length}`;
    if (i > 0 && byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) {
      return `implied value rises at rank ${i + 1}`;
    }
  }
  if (rows.length > 1 && rows.every((r) => r.implied_value_usd === rows[0]!.implied_value_usd)) {
    return 'every implied value is the same: the board ranks nothing';
  }
  return null;
}
