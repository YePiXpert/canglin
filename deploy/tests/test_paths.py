#!/usr/bin/env python3
"""Exercise deployment paths with fake Git/Docker; never contact live services.

Tests that depend on the default /opt paths run a copy of the script whose /opt/ prefix
points into the temporary directory, so a real /opt/canglin is never touched."""
import json
import os
from pathlib import Path
import subprocess
import shutil
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[2]
STUB = r'''#!/usr/bin/env python3
import json, os, pathlib, sys, shutil
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
        (p / "deploy").mkdir()
        shutil.copy(os.environ["STORAGE_HELPER"], p / "deploy/storage.sh")
    elif args[0] == "diff" and os.environ.get("DIRTY_TRACKED") == "1":
        sys.exit(1)
    elif args[0] == "rev-parse":
        # MOVES_HEAD=1：merge 之后 HEAD 换成新提交（默认新旧提交相同）
        moved = os.environ.get("MOVES_HEAD") == "1" and any(
            json.loads(line)[2][:1] == ["merge"] for line in open(os.environ["COMMAND_LOG"]))
        print("def5678" if moved else "abc1234")
elif tool == "docker":
    if os.environ.get("FAIL_PULL") == "1" and args[:2] == ["compose", "pull"]:
        sys.exit(1)
    if os.environ.get("STOP_DOCKER") == "1":
        sys.exit(23)
    if args[:2] == ["volume", "inspect"] and os.environ.get("MISSING_VOLUME") == "1":
        sys.exit(1)
    if args[:2] == ["volume", "inspect"] and "--format" in args:
        if args[-1] == "{{.Driver}}":
            print("local")
        elif os.environ.get("LEGACY_VOLUME") != "1":
            print(os.environ.get("VOLUME_DEVICE", str(pathlib.Path.cwd() / "data")))
    if args[:2] == ["image", "inspect"] and os.environ.get("MISSING_IMAGE") == "1":
        sys.exit(1)
    if args[0] == "compose" and "images" in args:
        # NO_CONTAINERS lists services without containers; a query without a service covers all three.
        services = ["web", "server", "ocr"] if args[-1] == "-q" else [args[-1]]
        if set(services) - set(os.environ.get("NO_CONTAINERS", "").split(",")):
            print("sha256:test-image")
    if args[0] == "compose" and args[-1] == "config":
        print(os.environ.get("RESOLVED_CONFIG",
                             "name: canglin\nvolumes:\n  state:\n    name: canglin_state"))
    if args[0] == "run":
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
                    "COMMAND_LOG": str(self.log), "HOME": str(self.root),
                    "STORAGE_HELPER": str(REPO / "deploy/storage.sh")}
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
        (p / "deploy").mkdir()
        shutil.copy(REPO / "deploy/storage.sh", p / "deploy/storage.sh")
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

    def test_install_failed_pull_fails_without_building(self):
        # 拉不到镜像不回退本地构建：不构建、不启动，也不把这个版本写进 .env。
        target = self.root / "install-no-image"
        r = self.run_script("deploy.sh", "8080", str(target), FAIL_PULL="1")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("--build", r.stderr)
        compose = [c[2][:2] for c in self.commands() if c[0] == "docker"]
        self.assertIn(["compose", "pull"], compose)
        self.assertNotIn(["compose", "build"], compose)
        self.assertNotIn(["compose", "up"], compose)
        self.assertNotIn("RELEASE_TAG=", (target / ".env").read_text())

    def test_install_build_flag_builds_all_three_images(self):
        # --build 不拉镜像（拉取会失败也不影响），用同一源码版本构建全部三个镜像后再启动。
        target = self.root / "install-local-build"
        r = self.run_script("deploy.sh", "--build", CANGLIN_REPO=str(target), FAIL_PULL="1")
        self.assertEqual(r.returncode, 0, r.stderr)
        compose = [c[2] for c in self.commands() if c[0] == "docker" and c[2][:1] == ["compose"]]
        verbs = [c[1] for c in compose]
        self.assertNotIn("pull", verbs)
        builds = [c for c in compose if c[1] == "build"]
        self.assertEqual(len(builds), 1)
        self.assertEqual(builds[0][-3:], ["web", "server", "ocr"])
        self.assertIn("SOURCE_REVISION=abc1234", builds[0])
        self.assertLess(verbs.index("build"), verbs.index("up"))
        env = (target / ".env").read_text()
        self.assertIn("WEB_PORT=8080", env)
        self.assertIn("RELEASE_TAG=sha-abc1234", env)

    def test_install_build_flag_keeps_positional_port_and_directory(self):
        # --build 放在端口与目录之间或最后，位置参数照旧解析，显式目录仍优先于 CANGLIN_REPO。
        middle, last = self.root / "build middle", self.root / "build last"
        for target, args in ((middle, ["9003", "--build", str(middle)]),
                             (last, ["9004", str(last), "--build"])):
            with self.subTest(args=args):
                r = self.run_script("deploy.sh", *args, CANGLIN_REPO=str(self.root / "wrong"))
                self.assertEqual(r.returncode, 0, r.stderr)
                self.assertIn(f"WEB_PORT={args[0]}", (target / ".env").read_text())
                calls = [c[2][:2] for c in self.commands() if c[0] == "docker" and c[1] == str(target)]
                self.assertIn(["compose", "build"], calls)
                self.assertIn(["compose", "up"], calls)
        self.assertFalse((self.root / "wrong").exists())

    def test_install_rejects_unknown_option_before_any_action(self):
        # 拼错的选项不能被当成端口：在克隆和调用 docker 之前退出。
        target = self.root / "install-typo"
        r = self.run_script("deploy.sh", "--biuld", CANGLIN_REPO=str(target))
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("--biuld", r.stderr)
        self.assertEqual(self.commands(), [])
        self.assertFalse(target.exists())

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

    def test_failed_pull_fails_before_stopping(self):
        # CI 没通过或还没跑完的提交没有镜像：不回退本地构建，在停机前退出，.env 仍指向运行中的版本。
        target = self.repository("no-image")
        env_before = (target / ".env").read_text()
        r = self.run_script("upgrade.sh", str(target), FAIL_PULL="1")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("服务未停止", r.stderr)
        self.assertIn("--build", r.stderr)
        compose = [c[2][:2] for c in self.commands() if c[0] == "docker"]
        self.assertIn(["compose", "pull"], compose)
        for verb in ("down", "build", "up"):
            self.assertNotIn(["compose", verb], compose)
        self.assertEqual((target / ".env").read_text(), env_before)
        # 这次的回退点记录已删除，不留下不能用的 release 目录
        self.assertEqual(list((target / "pre-upgrade-backups").glob("release-*")), [])

    def test_failed_pull_restores_previous_source(self):
        # 已经快进到新提交时退回旧提交，并删掉这次打的回退标签：下次升级记下的旧版本仍是运行中的版本
        target = self.repository("no-image-moved")
        r = self.run_script("upgrade.sh", str(target), FAIL_PULL="1", MOVES_HEAD="1")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("sha-def5678", r.stderr)
        self.assertIn("源码仍是 abc1234", r.stderr)
        git_calls = [c[2] for c in self.commands() if c[0] == "git"]
        self.assertIn(["reset", "-q", "--keep", "abc1234"], git_calls)
        self.assertLess(git_calls.index(["merge", "--ff-only", "origin/main"]), git_calls.index(["reset", "-q", "--keep", "abc1234"]))
        removed = [c[2][1] for c in self.commands() if c[0] == "docker" and c[2][:1] == ["rmi"]]
        self.assertEqual([name.split(":")[0] for name in removed], ["canglin-rollback-web", "canglin-rollback-server", "canglin-rollback-ocr"])
        self.assertEqual(list((target / "pre-upgrade-backups").glob("release-*")), [])

    def test_build_flag_builds_all_three_images(self):
        # --build 不拉镜像（拉取会失败也不影响），三个镜像构建好之后才停机。
        target = self.repository("local-build")
        r = self.run_script("upgrade.sh", str(target), "--no-pull", "--build", FAIL_PULL="1")
        self.assertEqual(r.returncode, 0, r.stderr)
        compose = [c[2] for c in self.commands() if c[0] == "docker" and c[2][:1] == ["compose"]]
        verbs = [c[1] for c in compose]
        self.assertNotIn("pull", verbs)
        builds = [c for c in compose if c[1] == "build"]
        self.assertEqual(len(builds), 1)
        self.assertEqual(builds[0][-3:], ["web", "server", "ocr"])
        self.assertIn("SOURCE_REVISION=abc1234", builds[0])
        self.assertLess(verbs.index("build"), verbs.index("down"))
        self.assertLess(verbs.index("down"), verbs.index("up"))
        self.assertIn("RELEASE_TAG=sha-abc1234", (target / ".env").read_text())
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

    def test_upgrade_without_containers_skips_rollback_point(self):
        target = self.repository("no-containers")
        r = self.run_script("upgrade.sh", str(target), "--no-pull", NO_CONTAINERS="web,server,ocr")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("没有运行中的容器，跳过回退点记录", r.stdout)
        docker = [c[2] for c in self.commands() if c[0] == "docker"]
        self.assertFalse(any(a[0] == "tag" for a in docker))
        self.assertTrue(any(a[0] == "run" and "czf" in a for a in docker))
        self.assertTrue(any(a[:2] == ["compose", "up"] for a in docker))
        release = next((target / "pre-upgrade-backups").glob("release-*"))
        self.assertNotIn("image:", (release / "old-images.yml").read_text())

        # Containers for only some services means a broken deployment: stop before pulling or stopping.
        self.log.unlink()
        r = self.run_script("upgrade.sh", str(target), "--no-pull", NO_CONTAINERS="server")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("server", r.stderr)
        docker = [c[2] for c in self.commands() if c[0] == "docker"]
        self.assertFalse(any(a[:2] in (["compose", "pull"], ["compose", "down"]) for a in docker))

    def test_upgrade_unexpected_resolved_project_fails_before_stopping(self):
        target = self.repository("shell-override")
        r = self.run_script("upgrade.sh", str(target), "--no-pull",
                            RESOLVED_CONFIG="name: canglin-dev\nvolumes:\n  state:\n    name: canglin-dev_state")
        self.assertNotEqual(r.returncode, 0)
        self.assertFalse(any(c[2][:2] == ["compose", "down"] for c in self.commands()))

    def test_legacy_volume_migration_happens_after_backup(self):
        target = self.repository("legacy")
        r = self.run_script("upgrade.sh", str(target), "--no-pull", LEGACY_VOLUME="1")
        self.assertEqual(r.returncode, 0, r.stderr)
        calls = [c[2] for c in self.commands() if c[0] == "docker"]
        backup = next(i for i,c in enumerate(calls) if "czf" in c)
        copy = next(i for i,c in enumerate(calls) if any("cp -a /source" in a for a in c))
        remove = next(i for i,c in enumerate(calls) if c[:2] == ["volume", "rm"])
        self.assertLess(backup, copy)
        self.assertLess(copy, remove)
        self.assertTrue(any("device=" + str(target / "data") in c for c in calls))

    def test_legacy_and_populated_directory_refused_before_stop(self):
        target = self.repository("conflicting-data")
        (target / "data").mkdir()
        (target / "data/keep").write_text("important")
        r = self.run_script("upgrade.sh", str(target), "--no-pull", LEGACY_VOLUME="1")
        self.assertNotEqual(r.returncode, 0)
        self.assertFalse(any(c[2][:2] == ["compose", "down"] for c in self.commands()))
        self.assertEqual((target / "data/keep").read_text(), "important")

    def test_foreign_volume_directory_refused_before_stop(self):
        target = self.repository("foreign-data")
        r = self.run_script("upgrade.sh", str(target), "--no-pull", VOLUME_DEVICE="/unrelated")
        self.assertNotEqual(r.returncode, 0)
        self.assertFalse(any(c[2][:2] == ["compose", "down"] for c in self.commands()))

    def test_install_requires_upgrade_for_legacy_volume(self):
        target = self.repository("legacy-install")
        r = self.run_script("deploy.sh", "8080", str(target), LEGACY_VOLUME="1")
        self.assertNotEqual(r.returncode, 0)
        self.assertFalse(any(c[2][:2] == ["compose", "up"] for c in self.commands()))

    def rollback_artifacts(self, target):
        release = target / "pre-upgrade-backups/release-test"
        release.mkdir(parents=True)
        for name in ["state.tar.gz", "old-compose.yml", "release.txt"]:
            (release / name).write_text("fixture")
        (release / "old-images.yml").write_text("services:\n  server:\n    image: pinned-server:test\n")
        return release

    def test_rollback_without_recorded_images_refuses_before_any_docker_call(self):
        target = self.repository("rollback-no-images")
        release = self.rollback_artifacts(target)
        (release / "old-images.yml").write_text("services:\n")
        r = self.run_script("rollback.sh", str(target), str(release))
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("old-images.yml", r.stderr)
        self.assertEqual(self.commands(), [])

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
        self.assertIn(str(release / "storage.yml"), up)
        self.assertEqual(up[up.index("-p") + 1], "canglin")

if __name__ == "__main__":
    unittest.main()
