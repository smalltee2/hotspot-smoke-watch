#!/usr/bin/env bash
# Build the SEA-HAF manual from the Markdown chapters:
#   DOCX (pandoc, Word equations)  and  PDF (pandoc HTML with MathML, printed by headless Chromium).
# Needs pandoc, Node with playwright, and the Sarabun font. Run from anywhere.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p out
CH=(00_front.md 0[1-8]_*.md)
pandoc -f markdown-implicit_figures "${CH[@]}" --resource-path=. --toc --toc-depth=2 \
  --reference-doc=reference.docx -o out/SEA-HAF_manual.docx
pandoc -f markdown-implicit_figures "${CH[@]}" --resource-path=. --toc --toc-depth=2 \
  --standalone --embed-resources --mathml --css=manual.css -o out/SEA-HAF_manual.html
node build_pdf.js
ls -l out
