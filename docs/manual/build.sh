#!/usr/bin/env bash
# Build the SEA-HAF manual: Markdown chapters -> DOCX (pandoc) -> PDF (LibreOffice).
# Needs pandoc, libreoffice and the Sarabun font. Run from docs/manual/.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p out
pandoc 00_front.md 0[1-8]_*.md --resource-path=.:figs --toc --toc-depth=2 -N \
  --reference-doc=reference.docx -o out/SEA-HAF_manual.docx
soffice --headless --convert-to pdf --outdir out out/SEA-HAF_manual.docx >/dev/null
ls -l out
