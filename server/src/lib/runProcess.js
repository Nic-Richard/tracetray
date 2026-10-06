const { spawn } = require("child_process");

const MAX_OUTPUT = 1024 * 1024;
const TIMEOUT_MS = 5 * 60 * 1000;

function runProcess(command, args, { timeoutMs = TIMEOUT_MS, ...options } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "", stderr = "";
        let stopped = false;
        let killTimer;

        function stop(error) {
            if (stopped) return;
            stopped = true;
            clearTimeout(timer);
            child.kill();
            killTimer = setTimeout(() => child.kill("SIGKILL"), 1000);
            killTimer.unref();
            reject(error);
        }

        const timer = setTimeout(() => stop(new Error(`${command} timed out`)), timeoutMs);
        for (const [stream, name] of [[child.stdout, "stdout"], [child.stderr, "stderr"]]) {
            stream.setEncoding("utf8");
            stream.on("data", data => {
                if (stopped) return;
                if (name === "stdout") stdout += data;
                else stderr += data;
                if (stdout.length + stderr.length > MAX_OUTPUT) stop(new Error(`${command} output is too large`));
            });
        }
        child.on("error", error => {
            if (stopped) return;
            stopped = true;
            clearTimeout(timer);
            reject(error);
        });
        child.on("close", (code, signal) => {
            clearTimeout(timer);
            clearTimeout(killTimer);
            if (stopped) return;
            stopped = true;
            if (code !== 0) return reject(new Error(`${command} failed (${signal || code}): ${stderr.slice(0, 500)}`));
            resolve({ stdout, stderr });
        });
    });
}

module.exports = { runProcess };
