#!/usr/bin/env python3
"""Compare independently annotated source-row IDs, never match by item name.

The manifest is either a JSON array of samples, or an object {"variants": [...], "baseline": "...", "samples": [...]}.
Variant names come from --variants, then the manifest's "variants", then the runs present in the samples; the
baseline is --baseline, then the manifest's "baseline", then "fixed_old". The last variant is the final pipeline
whose human review effort must improve on the baseline.
"""
import argparse
import json
from decimal import Decimal

DEFAULT_BASELINE = 'fixed_old'
METRICS = ('missingRate', 'extraRate', 'numericErrorRate', 'nameErrorRate', 'unitErrorRate', 'specErrorRate')


def number(value):
    return None if value is None else Decimal(str(value))


def manifest_parts(manifest):
    """(samples, variants or None, baseline or None) from either manifest form."""
    if isinstance(manifest, list):
        return manifest, None, None
    return manifest['samples'], manifest.get('variants'), manifest.get('baseline')


def evaluate(samples, split, variants=None, baseline=DEFAULT_BASELINE):
    variants = list(variants or sorted({v for s in samples for v in s['runs']}))
    if baseline not in variants:
        raise ValueError(f'Baseline {baseline!r} is not one of the variants {variants}')
    selected = [s for s in samples if s['split'] == split]
    reports = {}
    for variant in variants:
        total = missing = numeric = errors = extra = names = units = specs = 0
        edits, seconds = [], []
        complete = True
        for sample in selected:
            if variant not in sample['runs']:
                complete = False; continue
            run = sample['runs'][variant]
            actual = {r['sourceRowId']: r for r in run['rows']}
            if len(actual) != len(run['rows']):
                raise ValueError('Duplicate sourceRowId; annotate physical rows independently')
            gold = {r['sourceRowId']: r for r in sample['gold']}
            if len(gold) != len(sample['gold']): raise ValueError('Duplicate gold sourceRowId')
            if any(not str(row.get('itemName', '')).strip() or 'unit' not in row for row in gold.values()):
                complete = False
            total += len(gold); extra += len(set(actual)-set(gold))
            for key, row in gold.items():
                if key not in actual: missing += 1
                if key not in actual or row.get('itemName') != actual[key].get('itemName'): names += 1
                if key not in actual or row.get('unit') != actual[key].get('unit'): units += 1
                if key not in actual or row.get('spec') != actual[key].get('spec'): specs += 1
                for field in ('quantity', 'unitPrice'):
                    numeric += 1
                    if key not in actual or number(row.get(field)) != number(actual[key].get(field)): errors += 1
            if run.get('humanEdits') is not None: edits.append(run['humanEdits'])
            if run.get('reviewSeconds') is not None: seconds.append(run['reviewSeconds'])
        reports[variant] = {'complete': complete and bool(selected), 'documents': len(selected),
                            'goldRows': total, 'missingRows': missing, 'extraRows': extra,
                            'missingRate': missing / total if total else None,
                            'extraRate': extra / total if total else None,
                            'nameErrorRate': names / total if total else None,
                            'unitErrorRate': units / total if total else None,
                            'specErrorRate': specs / total if total else None,
                            'numericErrorRate': errors / numeric if numeric else None,
                            'humanEdits': sum(edits) if len(edits) == len(selected) and edits else None,
                            'reviewSeconds': sum(seconds) if len(seconds) == len(selected) and seconds else None}
    base = reports[baseline]
    candidates = [v for v in variants if v != baseline]
    final = reports[candidates[-1]] if candidates else base
    ready = all(r['complete'] for r in reports.values())
    accuracy = ready and bool(candidates) and all(
        base[key] is not None and all(reports[c][key] is not None and reports[c][key] <= base[key] for c in candidates)
        for key in METRICS)
    improved = any(base[k] is not None and final[k] is not None and final[k] < base[k] for k in ('humanEdits', 'reviewSeconds'))
    holdout = sum(s['split'] == 'holdout' for s in samples)
    sample_gate = 30 <= len(samples) <= 50 and holdout * 3 >= len(samples)
    return {'split': split, 'baseline': baseline, 'final': candidates[-1] if candidates else None,
            'variants': reports, 'sampleGate': sample_gate,
            'accuracyGate': accuracy, 'humanBenefitGate': improved,
            'effectAccepted': split == 'holdout' and sample_gate and accuracy and improved,
            'note': 'Does not replace interface, resource, backup or deployment acceptance.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('manifest'); parser.add_argument('--split', choices=['development', 'holdout'], default='holdout')
    parser.add_argument('--variants', help='comma separated, baseline included, final pipeline last')
    parser.add_argument('--baseline')
    args = parser.parse_args()
    with open(args.manifest) as file:
        samples, variants, baseline = manifest_parts(json.load(file))
    if args.variants:
        variants = [v.strip() for v in args.variants.split(',') if v.strip()]
    print(json.dumps(evaluate(samples, args.split, variants, args.baseline or baseline or DEFAULT_BASELINE),
                     ensure_ascii=False, indent=2))
