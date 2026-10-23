#!/usr/bin/env python3
"""Run local OCR code against originals without a database or network.

PYTHONPATH=apps/ocr python scripts/evaluate-local-imports.py DIRECTORY [--rendered-ocr]
DIRECTORY/sources.json: [{"id":"s1", "file":"s1.pdf"}]. Outputs stay beside originals.
Each sample must contain exactly one page; split multi-page documents before evaluation.
AI evaluation uses the resulting <id>-grid.json and <id>.png or .jpg. This tool does not
create gold annotations or turn PDF renders into independent photo samples.
"""
import argparse
import asyncio
import hashlib
import json
from pathlib import Path
import re
import time
from app import pipeline


async def run(root, rendered_ocr):
    sources = json.loads((root / 'sources.json').read_text())
    records = []
    for sample in sources:
        sid = sample['id']
        if not re.fullmatch(r'[A-Za-z0-9_-]+', sid):
            raise ValueError('Invalid sample id')
        source = (root / sample['file']).resolve()
        if not source.is_relative_to(root.resolve()):
            raise ValueError('Source must be inside the evaluation directory')
        data = source.read_bytes()
        if pipeline.document_info(data, source.name)['pageCount'] != 1:
            raise ValueError('Evaluation samples must contain exactly one page')
        record = {'id': sid, 'sha256': hashlib.sha256(data).hexdigest(), 'parserVersion': pipeline.PARSER_VERSION}
        for name, grid in [('classic', False), ('grid', True)]:
            pipeline.GRID_REBUILD = grid
            start = time.monotonic()
            result = await pipeline.parse_dispatch(data, source.name, mode='text' if grid else None)
            (root / f'{sid}-{name}.json').write_text(json.dumps(result, ensure_ascii=False, indent=2))
            record[name] = {'rows': len(result['items']), 'elapsedMs': round((time.monotonic() - start) * 1000)}
        image, mime = pipeline.render_page(data, source.name, 1)
        extension = 'png' if mime == 'image/png' else 'jpg'
        (root / f'{sid}.{extension}').write_bytes(image)
        if rendered_ocr:
            start = time.monotonic()
            result = await pipeline.parse_dispatch(image, f'{sid}.{extension}')
            (root / f'{sid}-rendered-ocr.json').write_text(json.dumps(result, ensure_ascii=False, indent=2))
            record['renderedOcr'] = {'rows': len(result['items']), 'elapsedMs': round((time.monotonic() - start) * 1000)}
        records.append(record)
        (root / 'local-runs.json').write_text(json.dumps(records, indent=2))
        print(json.dumps(record), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--rendered-ocr', action='store_true')
    args = parser.parse_args()
    asyncio.run(run(args.directory, args.rendered_ocr))
