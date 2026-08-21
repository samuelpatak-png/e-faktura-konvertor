import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface KositResult {
  // false when the local KOSIT toolchain (backend/tools/kosit/, see scripts/setup-kosit.sh)
  // isn't installed or Java isn't runnable — never treated as a validation failure, just "this
  // extra layer isn't available right now."
  available: boolean;
  acceptable: boolean | null;
  // Raw "[RULE-CODE] message" strings straight from the official Schematron report — English,
  // not translated. Supplementary technical detail only; see WP5 handoff for why these aren't
  // rendered as friendly Slovak (hundreds of possible rules across EN16931 + Peppol BIS 3.0 —
  // not something to guess a translation for).
  messages: string[];
}

const BACKEND_DIR = join(__dirname, "..", "..");
const TOOLS_DIR = join(BACKEND_DIR, "tools", "kosit");
const VALIDATOR_JAR = join(TOOLS_DIR, "validator.jar");
const BIS_CONFIG = join(TOOLS_DIR, "bis-config");
const SCENARIOS = join(BIS_CONFIG, "scenarios.xml");

// Mirrors scripts/validate-fixtures.sh's fallback: prefer `java` on PATH (CI), fall back to
// the common Homebrew keg-only location for local macOS dev.
const JAVA_CANDIDATES = ["java", "/opt/homebrew/opt/openjdk@21/bin/java", "/usr/local/opt/openjdk@21/bin/java"];

// Exported for direct unit testing (see kositRunner.test.ts) — the real KOSIT jar is gitignored
// and only present after an explicit local setup step, so a test of runKositValidation alone
// can't reliably exercise (or fail without) this specific stderr-draining behavior.
export function runProcess(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { timeout: timeoutMs });
    let stdout = "";
    child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
    // Must drain stderr too, even though nothing here reads it — an unread pipe fills its OS
    // buffer once the child writes enough to it (a Java stack trace or verbose warnings easily
    // do), which blocks the child's write() and stalls this call until the `timeout` above
    // finally kills it. Draining keeps a noisy validator run fast instead of hanging for up to
    // 30s on every such upload.
    child.stderr?.on("data", () => {});
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout }));
  });
}

async function findWorkingJava(): Promise<string | null> {
  for (const candidate of JAVA_CANDIDATES) {
    try {
      // Must actually invoke it, not just check PATH — on macOS without a JDK registered,
      // /usr/bin/java exists as a stub that exits non-zero (same gotcha fixed in WP0's
      // validate-fixtures.sh).
      const { code } = await runProcess(candidate, ["-version"], 5000);
      if (code === 0) return candidate;
    } catch {
      // try next candidate
    }
  }
  return null;
}

export async function runKositValidation(xmlContent: string): Promise<KositResult> {
  if (!existsSync(VALIDATOR_JAR) || !existsSync(SCENARIOS)) {
    return { available: false, acceptable: null, messages: [] };
  }
  const javaBin = await findWorkingJava();
  if (!javaBin) {
    return { available: false, acceptable: null, messages: [] };
  }

  const workDir = await mkdtemp(join(tmpdir(), "kosit-upload-"));
  const inputPath = join(workDir, "document.xml");
  try {
    await writeFile(inputPath, xmlContent, "utf8");
    await runProcess(javaBin, ["-jar", VALIDATOR_JAR, "-s", SCENARIOS, "-r", BIS_CONFIG, "-o", workDir, inputPath], 30_000);

    const reportPath = join(workDir, "document-report.xml");
    if (!existsSync(reportPath)) {
      // No scenario matched (e.g. CustomizationID isn't Peppol BIS 3.0) — not a crash, just
      // "couldn't run the official check against this document."
      return { available: true, acceptable: null, messages: [] };
    }
    const report = await readFile(reportPath, "utf8");
    const validMatch = report.match(/<rep:report[^>]*\bvalid="(true|false)"/);
    const acceptable = validMatch ? validMatch[1] === "true" : null;

    const messages: string[] = [];
    const seen = new Set<string>();
    const msgRegex = /\[([A-Z][A-Z0-9-]{2,60})\]-([^<]{1,400})/g;
    let match: RegExpExecArray | null;
    while ((match = msgRegex.exec(report)) !== null) {
      const entry = `[${match[1]}] ${match[2].trim()}`;
      if (!seen.has(entry)) {
        seen.add(entry);
        messages.push(entry);
      }
    }

    return { available: true, acceptable, messages: messages.slice(0, 50) };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
