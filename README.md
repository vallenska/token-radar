# Token Radar / ORBIT

[![make.fun token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![make.fun rank](https://make.fun/badge/token-radar-01/vallenska/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![make.fun reward](https://make.fun/badge/token-radar-01/vallenska/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

Token Radar / ORBIT is a ranked, explainable launch radar for protocols flagged as pre-token candidates in a supplied DefiLlama snapshot, built for make.fun's "Build the best token launch radar" bounty. It scores candidates and produces a ranked board, an offline dashboard, screenshots, and the official dossier.

The pre-token label reflects the supplied snapshot and its records; it is not proof that a protocol has no token.

## What it does

- Covers the full house watchlist and adds qualifying snapshot-labeled candidates below the TVL floor.
- Derives an implied value from TVL, a sector peer multiple, 7-day growth, protocol maturity, and chain reach.
- Reports a separate 0-100 signal score built from TVL rank, momentum, age, chain reach, peer-sample depth, and watchlist membership.
- Gives every ranked protocol an eight-step farm plan with capital sizing, costs, holding windows, and exit checks.
- Ships an offline dashboard with Radar, Live benchmarks, and Method tabs, plus search, category, chain, TVL, momentum, and watchlist filters.
- Writes `board.json`, `data.js`, `dashboard/`, `screenshots/`, and `dossier.json` to the output directory.

Implied value is an estimate from frozen data. It does not predict that a token will launch, what it will be worth, or that a farm will pay.

## Run

Requires Node.js 22. The program uses Node.js standard-library modules only: there is no install step and it makes no network requests.

Pass a snapshot JSON file or a directory containing `snapshot.json`:

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
```

`--input` defaults to `/input` and `--output` (or `MAKEFUN_OUTPUT_DIR`) defaults to `/output`. After the run, open `out/dashboard/index.html` in a browser to use the dashboard.

## License

MIT. See [LICENSE](LICENSE).
