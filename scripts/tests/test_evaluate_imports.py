import copy
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VARIANTS = ('fixed_old', 'grid_v1', 'ai_review_v1')


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def samples_for(row, variants=VARIANTS, final_edits=1):
    return [{'documentId': str(i), 'split': 'holdout' if i < 10 else 'development',
             'gold': [copy.deepcopy(row)],
             'runs': {v: {'rows': [copy.deepcopy(row)], 'humanEdits': final_edits if v == variants[-1] else 2,
                          'reviewSeconds': None} for v in variants}} for i in range(30)]


class EvaluateImportsTests(unittest.TestCase):
    def test_missing_and_unknown_numbers_cannot_pass_effect_gate(self):
        evaluator = load('evaluate-imports')
        samples = samples_for({'sourceRowId': 'row1', 'itemName': '签字笔', 'unit': '支', 'quantity': None, 'unitPrice': None})
        self.assertTrue(evaluator.evaluate(samples, 'holdout', VARIANTS)['effectAccepted'])
        samples[0]['runs']['ai_review_v1']['rows'][0]['quantity'] = 1
        self.assertFalse(evaluator.evaluate(samples, 'holdout', VARIANTS)['effectAccepted'])
        del samples[0]['runs']['ai_review_v1']
        self.assertFalse(evaluator.evaluate(samples, 'holdout', VARIANTS)['effectAccepted'])

    def test_phantom_rows_name_unit_and_spec_errors_fail_effect_gate(self):
        evaluator = load('evaluate-imports')
        row = {'sourceRowId': 'physical-1', 'itemName': '复印纸', 'unit': '包', 'spec': 'A4', 'quantity': 5, 'unitPrice': 18}
        samples = samples_for(row)
        self.assertTrue(evaluator.evaluate(samples, 'holdout', VARIANTS)['effectAccepted'])
        for field, value, metric in [('itemName', '胶带', 'nameErrorRate'), ('unit', '箱', 'unitErrorRate'), ('spec', 'A3', 'specErrorRate')]:
            changed = copy.deepcopy(samples)
            changed[0]['runs']['grid_v1']['rows'][0][field] = value
            report = evaluator.evaluate(changed, 'holdout', VARIANTS)
            self.assertGreater(report['variants']['grid_v1'][metric], 0)
            self.assertFalse(report['effectAccepted'])
        changed = copy.deepcopy(samples)
        changed[0]['runs']['ai_review_v1']['rows'].append({**row, 'sourceRowId': 'phantom'})
        self.assertFalse(evaluator.evaluate(changed, 'holdout', VARIANTS)['effectAccepted'])
        del changed[0]['gold'][0]['itemName']
        self.assertFalse(evaluator.evaluate(changed, 'holdout', VARIANTS)['effectAccepted'])

    def test_variants_and_baseline_are_parameters(self):
        evaluator = load('evaluate-imports')
        row = {'sourceRowId': 'r1', 'itemName': '文件袋', 'unit': '个', 'spec': None, 'quantity': 20, 'unitPrice': None}
        samples = samples_for(row, ('old_parser', 'grid_v1'))
        report = evaluator.evaluate(samples, 'holdout', baseline='old_parser')
        self.assertEqual((report['baseline'], report['final']), ('old_parser', 'grid_v1'))
        self.assertTrue(report['effectAccepted'])
        with self.assertRaises(ValueError):
            evaluator.evaluate(samples, 'holdout')  # 默认基线 fixed_old 不在这份清单里
        # 只有基线、没有新变体时不能算效果成立
        self.assertFalse(evaluator.evaluate(samples, 'holdout', ['old_parser'], 'old_parser')['accuracyGate'])

    def test_legacy_array_manifests_keep_their_variant_roles(self):
        evaluator = load('evaluate-imports')
        row = {'sourceRowId': 'r1', 'itemName': '文件袋', 'unit': '个', 'spec': None, 'quantity': 20, 'unitPrice': None}
        samples = samples_for(row, ('new_ocr_gpt', 'old', 'new_ocr', 'fixed_old'))  # 清单里的顺序与历史顺序不同
        for sample in samples:
            sample['runs']['new_ocr_gpt']['humanEdits'], sample['runs']['fixed_old']['humanEdits'] = 1, 2
            sample['runs']['old']['rows'][0]['itemName'] = '旧解析器读错的品名'  # 参照变体可以比基线差
        report = evaluator.evaluate(samples, 'holdout')
        self.assertEqual((report['baseline'], report['final']), ('fixed_old', 'new_ocr_gpt'))
        self.assertTrue(report['effectAccepted'])

    def test_command_line_reads_object_manifest_and_overrides(self):
        row = {'sourceRowId': 'r1', 'itemName': '文件袋', 'unit': '个', 'spec': None, 'quantity': 20, 'unitPrice': None}
        manifest = {'variants': list(VARIANTS), 'baseline': 'fixed_old', 'samples': samples_for(row)}
        with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as file:
            json.dump(manifest, file, ensure_ascii=False)
        script = str(ROOT / 'evaluate-imports.py')
        report = json.loads(subprocess.run([sys.executable, script, file.name], capture_output=True, text=True, check=True).stdout)
        self.assertEqual((report['final'], report['effectAccepted']), ('ai_review_v1', True))
        override = subprocess.run([sys.executable, script, file.name, '--variants', 'fixed_old,grid_v1', '--split', 'development'],
                                  capture_output=True, text=True, check=True)
        self.assertEqual(list(json.loads(override.stdout)['variants']), ['fixed_old', 'grid_v1'])
        Path(file.name).unlink()


if __name__ == '__main__': unittest.main()
