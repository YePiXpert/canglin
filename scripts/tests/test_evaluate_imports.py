import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class EvaluateImportsTests(unittest.TestCase):
    def test_missing_and_unknown_numbers_cannot_pass_effect_gate(self):
        evaluator = load('evaluate-imports')
        samples = []
        for i in range(30):
            samples.append({'documentId': str(i), 'split': 'holdout' if i < 10 else 'development',
                            'gold': [{'sourceRowId': 'row1', 'itemName': '签字笔', 'unit': '支', 'quantity': None, 'unitPrice': None}],
                            'runs': {v: {'rows': [{'sourceRowId': 'row1', 'itemName': '签字笔', 'unit': '支', 'quantity': None, 'unitPrice': None}],
                                         'humanEdits': 1 if v == 'new_ocr_gpt' else 2, 'reviewSeconds': None} for v in evaluator.VARIANTS}})
        self.assertTrue(evaluator.evaluate(samples, 'holdout')['effectAccepted'])
        samples[0]['runs']['new_ocr_gpt']['rows'][0]['quantity'] = 1
        self.assertFalse(evaluator.evaluate(samples, 'holdout')['effectAccepted'])
        del samples[0]['runs']['new_ocr_gpt']
        self.assertFalse(evaluator.evaluate(samples, 'holdout')['effectAccepted'])

    def test_phantom_rows_name_unit_and_spec_errors_fail_effect_gate(self):
        import copy
        evaluator = load('evaluate-imports')
        row = {'sourceRowId': 'physical-1', 'itemName': '复印纸', 'unit': '包', 'spec': 'A4', 'quantity': 5, 'unitPrice': 18}
        samples = [{'documentId': str(i), 'split': 'holdout' if i < 10 else 'development',
                    'gold': [copy.deepcopy(row)],
                    'runs': {variant: {'rows': [copy.deepcopy(row)], 'humanEdits': 1 if variant == 'new_ocr_gpt' else 2}
                             for variant in evaluator.VARIANTS}} for i in range(30)]
        self.assertTrue(evaluator.evaluate(samples, 'holdout')['effectAccepted'])
        for field, value, metric in [('itemName', '胶带', 'nameErrorRate'), ('unit', '箱', 'unitErrorRate'), ('spec', 'A3', 'specErrorRate')]:
            changed = copy.deepcopy(samples)
            changed[0]['runs']['new_ocr_gpt']['rows'][0][field] = value
            report = evaluator.evaluate(changed, 'holdout')
            self.assertGreater(report['variants']['new_ocr_gpt'][metric], 0)
            self.assertFalse(report['effectAccepted'])
        changed = copy.deepcopy(samples)
        changed[0]['runs']['new_ocr_gpt']['rows'].append({**row, 'sourceRowId': 'phantom'})
        self.assertFalse(evaluator.evaluate(changed, 'holdout')['effectAccepted'])
        del changed[0]['gold'][0]['itemName']
        self.assertFalse(evaluator.evaluate(changed, 'holdout')['effectAccepted'])


if __name__ == '__main__': unittest.main()
