import io
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import unittest


REPO = Path(__file__).resolve().parents[1]
REVISION = "a" * 40


@unittest.skipUnless(os.name == "posix", "deployment tests require Linux")
class DeploymentTests(unittest.TestCase):
    def setUp(self):
        for command in ("bash", "rsync", "node", "python3", "flock"):
            self.assertIsNotNone(shutil.which(command), f"Missing test tool: {command}")
        self.temporary = tempfile.TemporaryDirectory(prefix="tracetray-deploy-test-")
        self.addCleanup(self.temporary.cleanup)
        self.work = Path(self.temporary.name)
        self.root = self.work / "live"
        self.backup = self.work / "backup"
        self.bin = self.work / "bin"
        self.bin.mkdir()
        self.events = self.work / "events"
        self.source = (REPO / "scripts/deploy-api-remote.sh").read_text()
        replacements = {
            "root=/var/www/tracetray": f"root={self.root}",
            "backup=/root/deploy-backups/tracetray-github-previous": f"backup={self.backup}",
            "/run/lock/tracetray-github-deploy.lock": str(self.work / "lock"),
            "/var/tmp/tracetray-deploy.": str(self.work / "stage."),
            "/usr/bin/mongodump": str(self.bin / "mongodump"),
        }
        for original, replacement in replacements.items():
            self.assertIn(original, self.source)
            self.source = self.source.replace(original, replacement)
        self.script = self.write(self.work / "deploy.sh", self.source)
        self.files = {
            "client/tracker.js": "const revision = 'old';\n",
            "server/server.js": "const revision = 'old';\n",
            "server/src/app.js": "const revision = 'old';\n",
            "server/public/app/index.html": "old dashboard\n",
            "server/scripts/smoke-lib.js": "require('fs').appendFileSync(process.env.EVENTS, 'smoke\\n'); if (process.env.FAIL_AT === 'smoke') process.exit(1);\n",
            "server/package.json": '{"name":"fixture-server"}\n',
            "server/package-lock.json": "{}\n",
            "analysis/extractFeatures.js": "const revision = 'old';\n",
            "analysis/featureModules/basic.js": "const revision = 'old';\n",
            "analysis/package.json": '{"name":"fixture-analysis"}\n',
            "analysis/package-lock.json": "{}\n",
            "ml/analyze.py": "revision = 'old'\n",
            "ml/goal_model.py": "revision = 'old'\n",
            "ml/requirements.txt": "fixture requirements\n",
        }
        for name, value in self.files.items():
            self.write(self.root / name, value)
        self.protected = {
            ".env": f"TRACETRAY_PYTHON={self.bin / 'python-runtime'}\n",
            ".api-release": "previous-revision\n",
            "data/features/visits.json": "real feature fixture\n",
            "data/output/results.json": "real result fixture\n",
            "shots/page.png": "image fixture\n",
            "logs/runtime.log": "log fixture\n",
            "ml/.venv/keep": "Python environment fixture\n",
            "ml/__pycache__/keep.pyc": "Python cache fixture\n",
            "analysis/.env": "local extraction settings\n",
        }
        for name, value in self.protected.items():
            self.write(self.root / name, value)
        for package in ("server", "analysis"):
            self.write(self.root / package / "node_modules/marker", "old dependencies\n")
        self.write(self.root / "server/node_modules/dotenv/index.js",
                   "exports.parse = b => Object.fromEntries(b.toString().trim().split('\\n').map(s => s.split('=')));\n")
        self.stub("npm", """if [[ $FAIL_AT == npm && $PWD == */analysis ]]; then printf 'npm failed\\n' >> "$EVENTS"; exit 1; fi
mkdir -p node_modules
printf 'new dependencies\\n' > node_modules/marker
printf 'npm %s\\n' "$PWD" >> "$EVENTS"
""")
        self.stub("python-runtime", """printf 'python %s\\n' "${@: -1}" >> "$EVENTS"
[[ $FAIL_AT != python ]]
""")
        self.stub("mongodump", """printf 'dump\\n' >> "$EVENTS"
[[ $FAIL_AT != backup ]] || exit 1
for argument in "$@"; do
  if [[ $argument == --archive=* ]]; then printf 'database backup fixture\\n' > "${argument#--archive=}"; fi
done
""")
        self.stub("pm2", """printf 'reload\\n' >> "$EVENTS"
if [[ $FAIL_AT == reload && ! -e $EVENTS.failed ]]; then touch "$EVENTS.failed"; exit 1; fi
""")
        self.stub("curl", """[[ $FAIL_AT != health ]] || exit 22
printf '{"ok":true,"database":"connected"}\\n'
""")
        self.stub("sleep", "exit 0\n")
        self.stub("mv", """if [[ $FAIL_AT == analysis-swap && $1 == */stage.*/analysis/node_modules ]]; then exit 1; fi
exec /bin/mv "$@"
""")

    def write(self, path, contents):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(contents)
        return path

    def stub(self, name, contents):
        file = self.write(self.bin / name, "#!/usr/bin/env bash\nset -eu\n" + contents)
        file.chmod(0o755)

    def archive(self, extra=None, missing=()):
        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
            files = {name: value.replace("'old'", "'new'").replace("old dashboard", "new dashboard")
                     for name, value in self.files.items() if name not in missing}
            files.update(extra or {})
            for name, value in files.items():
                entry = tarfile.TarInfo(name)
                if value is None:
                    entry.type = tarfile.SYMTYPE
                    entry.linkname = "/etc/passwd"
                    archive.addfile(entry)
                else:
                    data = value.encode()
                    entry.size = len(data)
                    archive.addfile(entry, io.BytesIO(data))
        return buffer.getvalue()

    def deploy(self, failure="", archive=None):
        self.events.unlink(missing_ok=True)
        env = {**os.environ, "PATH": f"{self.bin}:{os.environ['PATH']}", "SSH_ORIGINAL_COMMAND": f"deploy {REVISION}",
               "FAIL_AT": failure, "EVENTS": str(self.events)}
        env.pop("TRACETRAY_PYTHON", None)
        result = subprocess.run(["bash", str(self.script)], input=self.archive() if archive is None else archive,
                                capture_output=True, env=env, timeout=30)
        self.assertFalse(list(self.work.glob("stage.*")), "Disposable staging directories must be removed")
        return result

    def assert_unchanged(self):
        for name, value in {**self.files, **self.protected}.items():
            self.assertEqual((self.root / name).read_text(), value, name)
        for package in ("server", "analysis"):
            self.assertEqual((self.root / package / "node_modules/marker").read_text(), "old dependencies\n")

    def test_success_ships_both_pipelines_and_preserves_runtime(self):
        self.write(self.root / "ml/obsolete.py", "old module\n")
        result = self.deploy()
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        for name in ("analysis/extractFeatures.js", "analysis/featureModules/basic.js", "ml/analyze.py", "ml/goal_model.py"):
            self.assertIn("'new'", (self.root / name).read_text())
        self.assertFalse((self.root / "ml/obsolete.py").exists())
        self.assertEqual((self.root / ".api-release").read_text(), REVISION + "\n")
        for name, value in self.protected.items():
            if name != ".api-release":
                self.assertEqual((self.root / name).read_text(), value, name)
        for package in ("server", "analysis"):
            self.assertEqual((self.root / package / "node_modules/marker").read_text(), "new dependencies\n")
        with tarfile.open(self.backup / "source.tar.gz") as backup:
            for name in ("ml/analyze.py", "analysis/extractFeatures.js"):
                self.assertEqual(backup.extractfile(name).read().decode(), self.files[name])
            self.assertTrue(all("node_modules" not in name and ".venv" not in name and ".env" not in name for name in backup.getnames()))
        self.assertTrue((self.backup / "bug_reports.archive.gz").exists())
        events = self.events.read_text()
        self.assertIn("/analysis", events)
        self.assertIn("/ml", events)
        self.assertLess(events.index("dump"), events.index("reload"))

    def test_preflight_or_backup_failure_leaves_live_files_untouched(self):
        for failure in ("npm", "smoke", "python", "backup"):
            with self.subTest(failure=failure):
                self.assertNotEqual(self.deploy(failure).returncode, 0)
                self.assert_unchanged()
                events = self.events.read_text()
                self.assertIn({"npm": "npm failed", "smoke": "smoke", "python": "python", "backup": "dump"}[failure], events)
                self.assertNotIn("reload", events)

    def test_failed_reload_restores_all_code_and_dependencies(self):
        result = self.deploy("reload")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b"restoring the previous code", result.stdout)
        self.assert_unchanged()
        self.assertEqual(self.events.read_text().count("reload"), 2)

    def test_failed_health_restores_all_code_and_dependencies(self):
        result = self.deploy("health")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b"restoring the previous code", result.stdout)
        self.assert_unchanged()
        self.assertEqual(self.events.read_text().count("reload"), 2)

    def test_partial_dependency_swap_restores_both_packages(self):
        result = self.deploy("analysis-swap")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b"restoring the previous code", result.stdout)
        self.assert_unchanged()

    def test_archive_cannot_replace_runtime_files_or_escape_allowed_paths(self):
        for path, value in (("data/visits.json", "unsafe"), ("ml/../../outside", "unsafe"), ("ml/link", None),
                            ("analysis/.env", "unsafe"), ("ml/.venv/bin/python", "unsafe"), ("analysis/node_modules/x.js", "unsafe")):
            with self.subTest(path=path):
                result = self.deploy(archive=self.archive({path: value}))
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(b"Unexpected deployment archive entry", result.stderr)
                self.assert_unchanged()

    def test_incomplete_pipeline_archive_is_rejected(self):
        for name in ("analysis/extractFeatures.js", "analysis/package-lock.json", "ml/analyze.py", "ml/goal_model.py", "ml/requirements.txt"):
            with self.subTest(name=name):
                self.assertNotEqual(self.deploy(archive=self.archive(missing=(name,))).returncode, 0)
                self.assert_unchanged()
                self.assertFalse(self.events.exists())

    def test_workflow_keeps_ci_and_production_gates_and_ships_both_directories(self):
        workflow = (REPO / ".github/workflows/deploy-api.yml").read_text()
        self.assertIn("environment: Production", workflow)
        self.assertIn("--commit \"$GITHUB_SHA\"", workflow)
        archive = next(line for line in workflow.splitlines() if "git archive --format=tar HEAD" in line)
        self.assertIn(" analysis ml ", archive)
        self.assertNotIn(" .env", archive)
        self.assertNotIn(" data", archive)


if __name__ == "__main__":
    unittest.main(verbosity=2)
