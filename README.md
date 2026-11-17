# Token Radar / ORBIT

Token Radar / ORBIT is the `token-radar-01` Make.fun competition entry. It reads a supplied snapshot JSON, scores launch candidates, checks the resulting board, and produces a ranked board, static dashboard data, screenshots, and a dossier.

## Run

Requires Node.js 22. Pass a snapshot JSON file or a directory containing `snapshot.json`:

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
```

The program uses Node.js standard-library modules only; it has no runtime dependencies and makes no network requests.

## License

MIT. See [LICENSE](LICENSE).
