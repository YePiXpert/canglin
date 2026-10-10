#!/usr/bin/env python3
"""Exercise deployment paths with fake Git/Docker; never contact live services.

Tests that depend on the default /opt paths run a copy of the script whose /opt/ prefix
points into the temporary directory, so a real /opt/procure-lite is never moved."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[2]
STUB = r'''#!/usr/bin/env python3
import json, os, pathlib, sys
tool = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
with open(os.environ["COMMAND_LOG"], "a") as out:
    out.write(json.dumps([tool, str(pathlib.Path.cwd()), args]) + "\n")
if tool == "git":
    if args[0] == "clone":
        p = pathlib.Path(args[-1])
        p.mkdir(parents=True)
        (p / ".git").mkdir()
        (p / "docker-compose.yml").write_text("services: {}\n")
    elif args[0] == "diff" and os.environ.get("DIRTY_TRACKED") == "1":
        sys.exit(1)
    elif args[0] == "rev-parse":
        print("abc1234")
    elif args[:2] == ["remote", "get-url"]:
        if not os.environ.get("ORIGIN_URL"):
            sys.exit(2)
        print(os.environ["ORIGIN_URL"])
elif tool == "docker":
    if os.environ.get("FAIL_PULL") == "1" and args[:2] == ["compose", "pull"]:
        sys.exit(1)
    if os.environ.get("STOP_DOCKER") == "1":
        sys.exit(23)
    if args[:2] == ["volume", "inspect"] and (os.environ.get("MISSING_VOLUME") == "1"
            or args[2] in os.environ.get("MISSING_VOLUMES", "").split(",")):
        sys.exit(1)
    if args[:2] == ["image", "inspect"] and os.environ.get("MISSING_IMAGE") == "1":
        sys.exit(1)
    if args[0] == "compose" and "images" in args:
        print("sha256:test-image")
    if args[0] == "compose" and args[-1] == "config":
        print(os.environ.get("RESOLVED_CONFIG",
                             "name: canglin\nvolumes:\n  state:\n    name: canglin_state"))
    if args[0] == "ps" and "label=com.docker.compose.project=procure-lite" in args:
        print("\n".join(os.environ.get("LEGACY_CONTAINERS", "").split()))
    if args[0] == "run":
        if os.environ.get("FAIL_COPY") == "1" and any("cp -a" in a for a in args):
            sys.exit(1)
        p = pathlib.Path("pre-upgrade-backups")
        p.mkdir(exist_ok=True)
        (p / "pre-upgrade-test.tar.gz").touch()
elif tool == "curl":
    print("true" if "ocr-health" in args[-1] else '{"ok":true}')
elif tool == "openssl":
    print("test-key-not-a-secret")
'''

class DeploymentPaths(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        for name in ["git", "docker", "curl", "openssl"]:
            p = self.bin / name
            p.write_text(STUB)
            p.chmod(0o755)
        self.log = self.root / "commands.jsonl"
        self.env = {**os.environ, "PATH": str(self.bin) + ":" + os.environ["PATH"],
                    "COMMAND_LOG": str(self.log), "HOME": str(self.root)}
        self.env.pop("CANGLIN_REPO", None)
        self.env.pop("RELEASE_TAG", None)

    def run_script(self, name, *args, **env):
        script = name if isinstance(name, Path) else REPO / "deploy" / name
        return subprocess.run(["bash", str(script), *args],
                              cwd=self.root, env={**self.env, **env},
                              capture_output=True, text=True, timeout=10)

    def patched(self, name):
        # Same script, with /opt/ redirected into the temporary root.
        opt = self.root / "opt"
        opt.mkdir(exist_ok=True)
        script = self.root / f"patched-{name}"
        script.write_text((REPO / "deploy" / name).read_text().replace("/opt/", f"{opt}/"))
        return script, opt

    def repository(self, name):
        p = self.root / name
        p.mkdir(parents=True)
        (p / ".git").mkdir()
        (p / "docker-compose.yml").write_text("name: canglin\nservices: {}\n")
        (p / "apps/server/prisma/migrations").mkdir(parents=True)
        (p / "apps/ocr").mkdir(parents=True)
        (p / "apps/ocr/models.sha256").write_text("test")
        (p / "apps/ocr/requirements.lock").write_text("test")
        (p / ".env").write_text("OCR_API_KEY=keep-me\nWEB_PORT=8080\n")
        return p

    def commands(self):
        if not self.log.exists():
            return []
        return [json.loads(x) for x in self.log.read_text().splitlines()]

    def test_install_clones_environment_target_with_spaces(self):
        target = self.root / "custom install"
        r = self.run_script("deploy.sh", "9000", CANGLIN_REPO=str(target))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("WEB_PORT=9000", (target / ".env").read_text())
        self.assertIn("RELEASE_TAG=sha-abc1234", (target / ".env").read_text())
        self.assertEqual((target / ".env").stat().st_mode & 0o777, 0o600)
        self.assertFalse((self.root / ".env").exists())
        calls = self.commands()
        self.assertTrue(any(c[0] == "git" and c[2][0] == "clone" for c in calls))
        self.assertTrue(any(c[0] == "docker" and c[1] == str(target)
                            and c[2][:2] == ["compose", "up"] for c in calls))

    def test_install_argument_wins_and_keeps_existing_key(self):
        target = self.repository("explicit")
        r = self.run_script("deploy.sh", "9001", str(target),
                            CANGLIN_REPO=str(self.root / "wrong"))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("OCR_API_KEY=keep-me", (target / ".env").read_text())
        self.assertIn("WEB_PORT=9001", (target / ".env").read_text())
        self.assertIn("RELEASE_TAG=sha-abc1234", (target / ".env").read_text())
        self.assertFalse((self.root / "wrong").exists())

    def test_install_rejects_unrelated_existing_directory(self):
        target = self.root / "unrelated"
        target.mkdir()
        (target / "important").write_text("keep")
        r = self.run_script("deploy.sh", "8080", str(target))
        self.assertNotEqual(r.returncode, 0)
        self.assertFalse((target / ".env").exists())
        self.assertEqual((target / "important").read_text(), "keep")

    def test_install_default_refuses_to_shadow_legacy_instance(self):
        script, opt = self.patched("deploy.sh")
        self.repository("opt/procure-lite")
        r = self.run_script(script, "8080")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("upgrade.sh", r.stderr)
        self.assertFalse((opt / "canglin").exists())
        self.assertFalse(any(c[0] == "git" and c[2][0] == "clone" for c in self.commands()))

    def test_upgrade_default_does_not_select_source_checkout_or_home(self):
        script, opt = self.patched("upgrade.sh")
        self.repository("canglin")
        r = self.run_script(script, "--no-pull", STOP_DOCKER="1")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn(f"{opt}/canglin", r.stdout + r.stderr)
        calls = self.commands()
        self.assertFalse(any(c[0] == "git" for c in calls))
        self.assertFalse(any(c[2][:2] == ["compose", "down"] for c in calls))

    def test_upgrade_argument_overrides_environment(self):
        target = self.repository("explicit upgrade")
        r = self.run_script("upgrade.sh", str(target), "--no-pull",
                            CANGLIN_REPO=str(self.root / "wrong"))
        self.assertEqual(r.returncode, 0, r.stderr)
        calls = self.commands()
        self.assertIn("RELEASE_TAG=sha-abc1234", (target / ".env").read_text())
        self.assertTrue(any(c[2][:2] == ["compose", "up"] for c in calls))
        self.assertTrue(all(c[1] == str(target) for c in calls))
        self.assertFalse((self.root / "wrong").exists())

    def test_failed_pull_rebuilds_all_three_images(self):
        target = self.repository("fallback")
        r = self.run_script("upgrade.sh", str(target), "--no-pull", FAIL_PULL="1")
        self.assertEqual(r.returncode, 0, r.stderr)
        builds = [c[2] for c in self.commands() if c[2][:2] == ["compose", "build"]]
        self.assertEqual(len(builds), 1)
        self.assertEqual(builds[0][-3:], ["web", "server", "ocr"])
        self.assertTrue(any("/ready" in " ".join(c[2]) for c in self.commands()))

    def test_upgrade_preserves_untracked_local_configuration(self):
        target = self.repository("local-config")
        override = target / "docker-compose.override.yml"
        override.write_text("services: {}\n")
        r = self.run_script("upgrade.sh", str(target))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(override.read_text(), "services: {}\n")
        git_calls = [c[2] for c in self.commands() if c[0] == "git"]
        self.assertIn(["merge", "--ff-only", "origin/main"], git_calls)
        self.assertFalse(any(c[0] in ("reset", "clean") for c in git_calls))

    def test_upgrade_dirty_tracked_files_fail_before_stopping(self):
        target = self.repository("dirty")
        r = self.run_script("upgrade.sh", str(target), DIRTY_TRACKED="1")
        self.assertNotEqual(r.returncode, 0)
        self.assertFalse(any(c[2][:2] == ["compose", "down"] for c in self.commands()))

    def test_upgrade_missing_volume_fails_before_stopping(self):
        target = self.repository("no-volume")
        r = self.run_script("upgrade.sh", str(target), MISSING_VOLUME="1")
        self.assertNotEqual(r.returncode, 0)
        self.assertFalse(any(c[2][:2] == ["compose", "down"] for c in self.commands()))

    def test_upgrade_migrates_legacy_instance_once(self):
        script, opt = self.patched("upgrade.sh")
        legacy = self.repository("opt/procure-lite")
        (legacy / ".env").write_text(
            "OCR_API_KEY=keep-me\nCOMPOSE_PROJECT_NAME=procure-lite\nWEB_PORT=8080\n")
        (legacy / "docker-compose.override.yml").write_text("services: {}\n")
        r = self.run_script(script, MISSING_VOLUMES="canglin_state",
                            LEGACY_CONTAINERS="old-web old-server old-ocr",
                            ORIGIN_URL="https://github.com/YePiXpert/procure-lite.git")
        self.assertEqual(r.returncode, 0, r.stderr)
        target = opt / "canglin"
        self.assertFalse(legacy.exists())
        env = (target / ".env").read_text()
        self.assertIn("OCR_API_KEY=keep-me", env)
        self.assertIn("COMPOSE_PROJECT_NAME=canglin\n", env)
        self.assertNotIn("procure-lite", env)
        self.assertEqual((target / ".env").stat().st_mode & 0o777, 0o600)
        self.assertEqual((target / "docker-compose.override.yml").read_text(), "services: {}\n")
        calls = self.commands()
        self.assertIn(["remote", "set-url", "origin", "https://github.com/YePiXpert/canglin.git"],
                      [c[2] for c in calls if c[0] == "git"])
        docker = [c for c in calls if c[0] == "docker"]

        def first(predicate):
            return next(i for i, c in enumerate(docker) if predicate(c[2]))

        record = first(lambda a: a[:3] == ["compose", "-p", "procure-lite"] and "images" in a)
        pull = first(lambda a: a[:2] == ["compose", "pull"])
        down = first(lambda a: a[:2] == ["compose", "down"])
        stop = first(lambda a: a[0] == "stop")
        create = first(lambda a: a[:2] == ["volume", "create"])
        copy = first(lambda a: a[0] == "run" and any("cp -a /from/. /to/" in x for x in a))
        backup = first(lambda a: a[0] == "run" and "czf" in a)
        chown = first(lambda a: a[0] == "run" and a[-4:] == ["chown", "-R", "1000:1000", "/state"])
        remove = first(lambda a: a[0] == "rm")
        up = first(lambda a: a[:2] == ["compose", "up"])
        self.assertEqual([record, pull, down, stop, create, copy, backup, chown, remove, up],
                         sorted([record, pull, down, stop, create, copy, backup, chown, remove, up]))
        self.assertEqual(docker[stop][2][1:], ["old-web", "old-server", "old-ocr"])
        self.assertEqual(docker[remove][2][1:], ["old-web", "old-server", "old-ocr"])
        self.assertEqual(docker[create][2][-1], "canglin_state")
        self.assertIn("com.docker.compose.project=canglin", docker[create][2])
        self.assertIn("procure-lite_procure-state:/from:ro", docker[copy][2])
        self.assertIn("canglin_state:/to", docker[copy][2])
        self.assertIn("chown -R 1000:1000 /to", docker[copy][2][-1])
        self.assertIn("canglin_state:/state:ro", docker[backup][2])
        self.assertEqual(docker[up][1], str(target))
        self.assertFalse(any(c[2][:2] == ["volume", "rm"] for c in docker))
        release = next((target / "pre-upgrade-backups").glob("release-*"))
        self.assertIn("image: canglin-rollback-server:", (release / "old-images.yml").read_text())

        # A second run finds everything migrated and behaves like an ordinary upgrade.
        self.log.unlink()
        r = self.run_script(script, ORIGIN_URL="https://github.com/YePiXpert/canglin.git")
        self.assertEqual(r.returncode, 0, r.stderr)
        calls = self.commands()
        docker = [c[2] for c in calls if c[0] == "docker"]
        self.assertTrue(all(c[1] == str(target) for c in calls))
        self.assertTrue(any(a[:3] == ["compose", "-p", "canglin"] and "images" in a for a in docker))
        self.assertFalse(any(a[0] in ("stop", "rm") or a[:2] == ["volume", "create"]
                             or any("cp -a" in x for x in a) for a in docker))
        self.assertFalse(any(c[0] == "git" and c[2][:2] == ["remote", "set-url"] for c in calls))
        self.assertEqual((target / ".env").read_text().count("COMPOSE_PROJECT_NAME="), 1)

    def test_upgrade_custom_path_does_not_adopt_legacy_directory(self):
        script, opt = self.patched("upgrade.sh")
        legacy = self.repository("opt/procure-lite")
        r = self.run_script(script, CANGLIN_REPO=str(self.root / "elsewhere"))
        self.assertNotEqual(r.returncode, 0)
        self.assertTrue(legacy.exists())
        self.assertFalse((opt / "canglin").exists())
        self.assertEqual(self.commands(), [])

    def test_upgrade_failed_volume_copy_keeps_legacy_containers_and_volume(self):
        target = self.repository("copy-fails")
        r = self.run_script("upgrade.sh", str(target), MISSING_VOLUMES="canglin_state",
                            LEGACY_CONTAINERS="old-server", FAIL_COPY="1")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("docker start old-server", r.stderr)
        docker = [c[2] for c in self.commands() if c[0] == "docker"]
        self.assertIn(["volume", "rm", "canglin_state"], docker)
        self.assertFalse(any(a[0] == "rm" or a[:2] == ["compose", "up"] for a in docker))
        self.assertFalse(any("procure-lite_procure-state" in a and a[:2] == ["volume", "rm"]
                             for a in docker))

    def test_upgrade_legacy_compose_fails_before_touching_env_or_services(self):
        target = self.repository("still-legacy")
        (target / "docker-compose.yml").write_text("name: procure-lite\nservices: {}\n")
        (target / ".env").write_text("COMPOSE_PROJECT_NAME=procure-lite\n")
        r = self.run_script("upgrade.sh", str(target), "--no-pull", LEGACY_CONTAINERS="old-web")
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual((target / ".env").read_text(), "COMPOSE_PROJECT_NAME=procure-lite\n")
        docker = [c[2] for c in self.commands() if c[0] == "docker"]
        self.assertFalse(any(a[:2] == ["compose", "down"] or a[0] == "stop" for a in docker))

    def test_upgrade_unexpected_resolved_project_fails_before_stopping(self):
        target = self.repository("shell-override")
        r = self.run_script("upgrade.sh", str(target), "--no-pull",
                            RESOLVED_CONFIG="name: procure-lite\nvolumes:\n  state:\n    name: procure-lite_state")
        self.assertNotEqual(r.returncode, 0)
        self.assertFalse(any(c[2][:2] == ["compose", "down"] for c in self.commands()))

    def rollback_artifacts(self, target):
        release = target / "pre-upgrade-backups/release-test"
        release.mkdir(parents=True)
        for name in ["state.tar.gz", "old-compose.yml", "release.txt"]:
            (release / name).write_text("fixture")
        (release / "old-images.yml").write_text("services:\n  server:\n    image: pinned-server:test\n")
        return release

    def test_rollback_missing_image_fails_before_stopping(self):
        target = self.repository("missing-rollback-image")
        release = self.rollback_artifacts(target)
        r = self.run_script("rollback.sh", str(target), str(release), MISSING_IMAGE="1")
        self.assertNotEqual(r.returncode, 0)
        self.assertFalse(any(c[2][:2] == ["compose", "down"] for c in self.commands()))

    def test_rollback_preserves_current_data_before_restore_and_uses_override(self):
        target = self.repository("rollback")
        release = self.rollback_artifacts(target)
        (target / "docker-compose.override.yml").write_text("services: {}\n")
        r = self.run_script("rollback.sh", str(target), str(release))
        self.assertEqual(r.returncode, 0, r.stderr)
        commands = [c[2] for c in self.commands()]
        backup_index = next(i for i, c in enumerate(commands) if "czf" in c)
        restore_index = next(i for i, c in enumerate(commands) if any("tar xzf" in x for x in c))
        self.assertLess(backup_index, restore_index)
        up = next(c for c in commands if "up" in c)
        self.assertIn(str(target / "docker-compose.override.yml"), up)
        self.assertIn(str(release / "old-images.yml"), up)
        self.assertEqual(up[up.index("-p") + 1], "canglin")

    def test_rollback_across_rename_pins_legacy_volume_key(self):
        target = self.repository("rollback-rename")
        release = self.rollback_artifacts(target)
        (release / "old-compose.yml").write_text("name: procure-lite\nvolumes:\n  procure-state:\n")
        for _ in range(2):
            r = self.run_script("rollback.sh", str(target), str(release))
            self.assertEqual(r.returncode, 0, r.stderr)
        pinned = (release / "old-images.yml").read_text()
        self.assertEqual(pinned.count("volumes:"), 1)
        self.assertTrue(pinned.endswith("volumes:\n  procure-state:\n    name: canglin_state\n"))
        commands = [c[2] for c in self.commands()]
        self.assertIn(["volume", "inspect", "canglin_state"], commands)
        self.assertFalse(any("procure-lite" in x for c in commands for x in c))

if __name__ == "__main__":
    unittest.main()
