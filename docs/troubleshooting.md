# Troubleshooting

- Missing token / 토큰 없음: Ensure `.env` with `HUGGINGFACE_TOKEN=` and pass `--env-file .env`.
- No GPU: `nvidia-smi` must be available inside container (`--gpus all`).
- Slow first run: large model download; use cache volume `-v $(pwd)/.cache:/app/.cache`.
- Report empty: check per-task `summary/summary.json` and `raw/*` logs.
