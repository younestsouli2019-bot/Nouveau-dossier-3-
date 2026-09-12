/**
 * STATIC ENGINE — pre-flight workflow sanitization (IaC).
 *
 * Target hazard: a workflow-level `concurrency:` group that is duplicated by
 * a child `jobs.<job_id>.concurrency:` group with the SAME value. The child
 * group is shared across runs at the job level while the parent serializes
 * whole runs — the two layers can starve each other and GitHub kills the
 * queued job BEFORE a runner is provisioned (logless deadlock: null runner
 * id, ≤0s delta, 0 steps, 404 logs — the signature the dynamic engine
 * detects).
 *
 * Rule (Autonomous Self-Healing Blueprint): if a workflow-level concurrency
 * group is defined, any child job-level concurrency group matching it must
 * be removed (the parent already serializes) or force-suffixed.
 *
 * Dependency-free strict pattern analysis (indentation-aware); no YAML
 * parser dependency is required — only the specific duplication pattern is
 * rewritten, never surrounding content.
 */

export interface WorkflowOffense {
  file: string;
  job: string;
  line: number; // 1-based line of the child `concurrency:` key
  kind: 'duplicate-parent-group';
  parentGroup: string;
  childGroup: string;
}

interface ParsedLine {
  indent: number;
  text: string; // trimmed
  raw: string;
}

function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

function parse(text: string): ParsedLine[] {
  return splitLines(text).map((raw, i) => {
    const m = raw.match(/^(\s*)(.*)$/);
    void i;
    return { indent: m[1].replace(/\t/g, '  ').length, text: m[2].trim(), raw };
  });
}

function groupValueOf(line: string): string | null {
  // `group: value` — returns the raw value, quotes normalized away.
  const m = line.match(/^group:\s*(.+?)\s*$/);
  if (!m) return null;
  let v = m[1];
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  return v;
}

/** Workflow-level (indent-0) concurrency group, or null when absent. */
export function parentConcurrencyGroup(text: string): string | null {
  const lines = parse(text);
  let inParentBlock = false;
  for (const l of lines) {
    if (l.indent === 0) {
      inParentBlock = l.text === 'concurrency:' || l.text.startsWith('concurrency: {');
      if (inParentBlock && l.text.includes('{')) return groupValueOf(l.text) ?? flowGroupOf(l.text);
      continue;
    }
    if (inParentBlock) {
      const g = groupValueOf(l.text);
      if (g !== null) return g;
      if (l.indent === 0) break;
    }
  }
  return null;
}

function flowGroupOf(flowLine: string): string | null {
  const m = flowLine.match(/group:\s*([^,}]+)/);
  return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : null;
}

/**
 * Analyze a workflow file for child concurrency groups that duplicate the
 * workflow-level parent group.
 */
export function analyzeWorkflow(file: string, text: string): WorkflowOffense[] {
  const parent = parentConcurrencyGroup(text);
  const lines = parse(text);
  const offenses: WorkflowOffense[] = [];
  if (parent === null) return offenses;

  let currentJob: string | null = null;
  let currentJobIndent = -1;
  let inChildConcurrency = false;
  let childConcurrencyIndent = -1;

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const jobMatch = l.text.match(/^([A-Za-z0-9_][A-Za-z0-9_-]*):(\s*)$/);
    if (l.indent === 2 && jobMatch) {
      currentJob = jobMatch[1];
      currentJobIndent = l.indent;
      inChildConcurrency = false;
      continue;
    }
    if (l.indent === 4 && currentJob !== null) {
      if (l.text === 'concurrency:' || l.text.startsWith('concurrency: {')) {
        inChildConcurrency = true;
        childConcurrencyIndent = l.indent;
        if (l.text.includes('{')) {
          const g = flowGroupOf(l.text);
          if (g !== null && g === parent) {
            offenses.push({
              file, job: currentJob, line: i + 1,
              kind: 'duplicate-parent-group', parentGroup: parent, childGroup: g,
            });
          }
          inChildConcurrency = false; // flow style: single line
        }
        continue;
      }
      if (l.text.length > 0 && !l.text.startsWith('#')) inChildConcurrency = false;
    }
    if (inChildConcurrency && l.indent > childConcurrencyIndent) {
      const g = groupValueOf(l.text);
      if (g !== null && g === parent) {
        offenses.push({
          file, job: currentJob as string, line: i - 1 + 1 - 1 + 1, // concurrency: line, back-tracked below
          kind: 'duplicate-parent-group', parentGroup: parent, childGroup: g,
        });
        // record the actual `concurrency:` key line number
        offenses[offenses.length - 1].line = concurrencyKeyLineOf(lines, i);
        inChildConcurrency = false;
      }
    }
    void currentJobIndent;
  }
  return offenses;
}

function concurrencyKeyLineOf(lines: ParsedLine[], groupLineIdx: number): number {
  for (let j = groupLineIdx; j >= 0; j--) {
    const t = lines[j].text;
    if (lines[j].indent === 4 && (t === 'concurrency:' || t.startsWith('concurrency:'))) {
      return j + 1;
    }
  }
  return groupLineIdx + 1;
}

/**
 * Rewrite the text with all duplicate child concurrency blocks REMOVED
 * (the parent already serializes — deletion is the safe repair).
 * Returns the new text and the offenses that were fixed.
 */
export function fixWorkflow(text: string): { text: string; fixed: WorkflowOffense[] } {
  const offenses = analyzeWorkflow('inline', text);
  if (offenses.length === 0) return { text, fixed: [] };

  const lines = splitLines(text);
  // Remove from the HIGHEST line number downward so indices stay valid.
  const sorted = [...offenses].sort((a, b) => b.line - a.line);
  for (const o of sorted) {
    let start = o.line - 1; // `concurrency:` key line
    let end = start + 1;
    // consume the block: following lines with indent > 4 (or blank)
    while (end < lines.length) {
      const m = lines[end].match(/^(\s*)(.*)$/);
      const indent = m[1].replace(/\t/g, '  ').length;
      if (m[2].trim() === '' || indent > 4) {
        end++;
        if (m[2].trim() === '') break; // stop after a trailing blank separator
        continue;
      }
      break;
    }
    // do not swallow the trailing blank line itself
    if (end > start + 1 && lines[end - 1].trim() === '') end--;
    lines.splice(start, end - start);
  }
  return { text: lines.join('\n'), fixed: offenses };
}
