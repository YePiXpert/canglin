"""Trial isolation is validated without touching a Docker daemon."""
import json
import os
import shutil
from pathlib import Path
import subprocess
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[2]
REVISION = "ce8fe2ef40f7d0e4f482335ead0143716e3e9478"
STUB = r'''#!/usr/bin/env python3
import json, os, pathlib, sys
args = sys.argv[1:]
with open(os.environ['TRIAL_COMMAND_LOG'], 'a') as out:
    out.write(json.dumps({'args': args, 'inherited': {key: os.environ.get(key) for key in ['COMPOSE_FILE', 'COMPOSE_PROJECT_NAME', 'COMPOSE_ENV_FILES', 'TRIAL_OCR_API_KEY']}}) + '\n')
if args[:2] == ['image', 'inspect']:
    print('wrong-revision' if os.environ.get('WRONG_REVISION') else 'ce8fe2ef40f7d0e4f482335ead0143716e3e9478')
elif args[-2:] == ['config', '--images']:
    if os.environ.get('BAD_CONFIG'): sys.exit(1)
    print('image-server\nimage-web\nimage-ocr')
elif 'exec' in args:
    print('{"api":{"ok":true,"database":true},"ocr":{"ok":true}}')
'''

class TrialIsolation(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        bin_dir = self.root / 'bin'
        bin_dir.mkdir()
        (bin_dir / 'docker').write_text(STUB)
        (bin_dir / 'curl').write_text('#!/bin/sh\nexit 0\n')
        for file in bin_dir.iterdir(): file.chmod(0o755)
        self.log = self.root / 'log.jsonl'
        self.trial = self.root / 'trial with spaces'
        self.env = {**os.environ, 'PATH': f'{bin_dir}:{os.environ["PATH"]}',
                    'CANGLIN_TRIAL_DIR': str(self.trial), 'TRIAL_COMMAND_LOG': str(self.log),
                    'COMPOSE_FILE': '/production/compose.yml', 'COMPOSE_PROJECT_NAME': 'canglin',
                    'COMPOSE_ENV_FILES': '/production/.env', 'TRIAL_OCR_API_KEY': 'production-key'}

    def run_script(self, action, **extra):
        return subprocess.run(['bash', str(REPO / 'deploy/trial.sh'), action], cwd=self.root,
                              env={**self.env, **extra}, text=True, capture_output=True, timeout=10)

    def calls(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()]

    def test_start_seals_project_config_and_generates_an_independent_key(self):
        result = self.run_script('up')
        self.assertEqual(result.returncode, 0, result.stderr)
        env_file = self.trial / 'env'
        self.assertEqual(env_file.stat().st_mode & 0o777, 0o600)
        self.assertNotIn('production-key', env_file.read_text())
        first_key = env_file.read_text()
        self.assertEqual(self.run_script('up').returncode, 0)
        self.assertEqual(env_file.read_text(), first_key)
        for call in self.calls():
            self.assertTrue(all(value is None for value in call['inherited'].values()))
            args = call['args']
            if args[0] == 'compose':
                self.assertEqual(args[args.index('-p') + 1], 'canglin-trial-ce8fe2e')
                self.assertEqual(args[args.index('-f') + 1], str(REPO / 'deploy/compose.trial.yml'))
                self.assertEqual(args[args.index('--env-file') + 1], str(env_file))
                self.assertNotIn('build', args)

    def test_wrong_revision_blocks_start(self):
        result = self.run_script('up', WRONG_REVISION='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any('up' in c['args'] for c in self.calls()))

    def test_bad_config_blocks_start(self):
        result = self.run_script('up', BAD_CONFIG='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any('up' in c['args'] for c in self.calls()))

    def test_stop_only_stops_trial_and_retains_data(self):
        self.assertEqual(self.run_script('up').returncode, 0)
        self.assertEqual(self.run_script('stop').returncode, 0)
        down = self.calls()[-1]['args']
        self.assertEqual(down[-1], 'down')
        self.assertNotIn('--volumes', down)
        self.assertTrue((self.trial / 'env').exists())

@unittest.skipUnless(shutil.which('docker'), 'Docker Compose CLI unavailable')
class TrialComposeConfiguration(unittest.TestCase):
    def test_resolved_candidate_is_isolated_and_resource_limited(self):
        # Compose config does not contact a Docker daemon. Only a synthetic key is used.
        result = subprocess.run([
            'docker', 'compose', '--env-file', '/dev/null', '-p', 'canglin-trial-ce8fe2e',
            '-f', str(REPO / 'deploy/compose.trial.yml'), 'config', '--format', 'json',
        ], env={**os.environ, 'TRIAL_OCR_API_KEY': 'synthetic-validation'},
            capture_output=True, text=True, check=True, timeout=15)
        config = json.loads(result.stdout)
        services = config['services']
        self.assertEqual(set(services), {'server', 'web', 'ocr'})
        for service in services.values():
            self.assertIn('@sha256:', service['image'])
            self.assertNotIn('build', service)
            self.assertEqual(service['labels']['com.centurylinklabs.watchtower.enable'], 'false')
        self.assertEqual(services['web']['ports'][0]['host_ip'], '127.0.0.1')
        self.assertEqual(str(services['web']['ports'][0]['published']), '18080')
        self.assertNotIn('ports', services['server'])
        self.assertNotIn('ports', services['ocr'])
        self.assertEqual(services['server']['volumes'][0]['source'], 'trial-state')
        self.assertIn('name: canglin-trial-ce8fe2e\n', (REPO / 'deploy/compose.trial.yml').read_text())
        self.assertEqual(config['volumes']['trial-state']['name'], 'canglin-trial-ce8fe2e_trial-state')
        self.assertFalse(config['volumes']['trial-state'].get('external'))
        self.assertFalse(services['server']['environment']['LLM_API_KEY'])
        self.assertFalse(services['server']['environment']['LLM_API_KEY_FILE'])
        self.assertEqual(int(services['ocr']['mem_limit']), 4 * 1024 ** 3)
        self.assertEqual(float(services['ocr']['cpus']), 2)

if __name__ == '__main__':
    unittest.main()
