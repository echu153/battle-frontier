#!/usr/bin/env bash
# 指定ファイルの内容(sha1)が変化するまでポーリングして待つ。
# ペアプロ伝言板 PAIR.md の監視に使用（Codexの追記を検知してClaudeを再起動させる）。
# usage: watch-file.sh <file> <base_sha1> [max_iters] [interval_sec]
file="$1"; base="$2"; max="${3:-600}"; interval="${4:-3}"
for ((i = 0; i < max; i++)); do
  cur=$(sha1sum "$file" 2>/dev/null | awk '{print $1}')
  if [ "$cur" != "$base" ]; then echo "CHANGED"; exit 0; fi
  sleep "$interval"
done
echo "TIMEOUT"
