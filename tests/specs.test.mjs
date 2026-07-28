// Conformance tests for the sp.specs/*.spec.md documents.
//
// This PR only adds documentation (feature specs) — there is no executable
// application code to unit test. These tests instead verify that the spec
// documents themselves are well-formed and internally consistent: required
// sections are present, acceptance criteria are real checkboxes, embedded
// code samples are syntactically sane, and cross-references between specs
// point at files that actually exist. This catches the most common defects
// in spec-driven docs (broken links, missing sections, malformed examples).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SPECS_DIR = path.join(__dirname, '..', 'sp.specs');

const SPEC_FILES = [
  '01-agent-engine.spec.md',
  '02-tab-grouping.spec.md',
  '03-endurance-runtime.spec.md',
  '04-multi-provider-router.spec.md',
];

function readSpec(name) {
  return readFileSync(path.join(SPECS_DIR, name), 'utf8').replace(/\r\n/g, '\n');
}

// Extracts the body of a section identified by an exact heading line (e.g.
// "## Status"), up to the next heading of level 1 or 2 (or end of file).
function getSection(content, heading) {
  const lines = content.split('\n');
  const start = lines.findIndex((l) => l.trim() === heading.trim());
  if (start === -1) return null;

  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,2}\s/.test(lines[i])) break;
    body.push(lines[i]);
  }
  while (body.length && body[0].trim() === '') body.shift();
  while (body.length && body[body.length - 1].trim() === '') body.pop();
  return body.join('\n');
}

function getCheckboxes(section) {
  return section.match(/^- \[ \] .+$/gm) || [];
}

function getSpecReferences(content) {
  return [...content.matchAll(/`(\d{2}-[a-z-]+\.spec\.md)`/g)].map((m) => m[1]);
}

describe('sp.specs directory', () => {
  test('contains exactly the four expected spec files, no more, no less', () => {
    const files = readdirSync(SPECS_DIR)
      .filter((f) => f.endsWith('.spec.md'))
      .sort();
    assert.deepEqual(files, SPEC_FILES);
  });
});

for (const file of SPEC_FILES) {
  describe(file, () => {
    const content = readSpec(file);

    test('starts with a numbered H1 title', () => {
      assert.match(content, /^# \d{2} — .+\n/);
    });

    test('declares "## Status" as "Draft"', () => {
      assert.equal(getSection(content, '## Status'), 'Draft');
    });

    test('has a non-trivial "## Summary" section', () => {
      const summary = getSection(content, '## Summary');
      assert.ok(summary, 'Summary section is missing');
      assert.ok(summary.length > 40, 'Summary section reads as a stub');
      assert.ok(!/^(TBD|TODO|Lorem ipsum)/i.test(summary), 'Summary looks like a placeholder');
    });

    test('has an "## Acceptance Criteria" section containing only real checkboxes', () => {
      const section = getSection(content, '## Acceptance Criteria');
      assert.ok(section, 'Acceptance Criteria section is missing');
      const checkboxes = getCheckboxes(section);
      assert.ok(checkboxes.length >= 1, 'Expected at least one acceptance criterion');
      // Multi-line checklist items may include indented continuation lines, but
      // every top-level item must be a checkbox.
      const topLevelLines = section.split('\n').filter((l) => l.trim().length > 0 && !/^\s/.test(l));
      assert.equal(topLevelLines.length, checkboxes.length);
    });

    test('has an "## Out of Scope" section', () => {
      const section = getSection(content, '## Out of Scope');
      assert.ok(section, 'Out of Scope section is missing');
      assert.ok(section.length > 0);
    });

    test('has an "## Open Questions" section with at least one real question', () => {
      const section = getSection(content, '## Open Questions');
      assert.ok(section, 'Open Questions section is missing');
      const questionLines = section
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('- '));
      assert.ok(questionLines.length >= 1, 'Expected at least one open question');
      for (const line of questionLines) {
        assert.ok(line.endsWith('?'), `Open question does not end in "?": ${line}`);
      }
    });

    test('does not reference itself as a related/out-of-scope spec', () => {
      const refs = getSpecReferences(content);
      assert.ok(!refs.includes(file), `${file} should not cross-reference itself`);
    });

    test('every cross-referenced spec file exists on disk', () => {
      const refs = getSpecReferences(content);
      for (const ref of refs) {
        assert.ok(SPEC_FILES.includes(ref), `${ref} referenced in ${file} is not a recognized spec filename`);
        assert.ok(existsSync(path.join(SPECS_DIR, ref)), `${ref} referenced in ${file} does not exist in sp.specs/`);
      }
    });
  });
}

describe('01-agent-engine.spec.md', () => {
  const content = readSpec('01-agent-engine.spec.md');

  test('exactly five acceptance criteria', () => {
    const section = getSection(content, '## Acceptance Criteria');
    assert.equal(getCheckboxes(section).length, 5);
  });

  test('documents all standardized browser actions with a name and parameters column', () => {
    const expectedRows = [
      'navigate',
      'click_element',
      'left_click`, `double_click`, `right_click`, `middle_click',
      'type',
      'key',
      'scroll',
      'left_click_drag',
      'read_page',
      'screenshot',
      'wait',
    ];
    const tableRows = content
      .split('\n')
      .filter((l) => /^\| `[a-z_]+`/.test(l));
    assert.ok(tableRows.length >= expectedRows.length);

    for (const action of expectedRows) {
      const row = tableRows.find((l) => l.startsWith(`| \`${action}\` `));
      assert.ok(row, `Missing tool table row for ${action}`);
      const columns = row.split('|').map((c) => c.trim());
      // [ '', name, params, purpose, '' ]
      assert.equal(columns.length, 5);
      assert.ok(columns[2].length > 0, `${action} has no documented parameters`);
      assert.ok(columns[3].length > 0, `${action} has no documented purpose/verification`);
    }
  });

  test('click_element documents stale-element retry behavior', () => {
    const section = getSection(content, '## Acceptance Criteria');
    assert.ok(section);
    assert.match(section, /`click_element` retries at least once on a stale-element error/);
  });

  test('describes both self-healing mechanisms', () => {
    const section = getSection(content, '## 3. Self-Healing & Intelligent Error Recovery');
    assert.ok(section);
    assert.match(section, /Modal & Overlay Dismissal/);
    assert.match(section, /Console Debugging Loop/);
  });

  test('out-of-scope items reference the other three specs', () => {
    const refs = getSpecReferences(getSection(content, '## Out of Scope'));
    assert.deepEqual(
      [...new Set(refs)].sort(),
      ['02-tab-grouping.spec.md', '03-endurance-runtime.spec.md', '04-multi-provider-router.spec.md'].sort(),
    );
  });
});

describe('02-tab-grouping.spec.md', () => {
  const content = readSpec('02-tab-grouping.spec.md');

  test('exactly four acceptance criteria', () => {
    const section = getSection(content, '## Acceptance Criteria');
    assert.equal(getCheckboxes(section).length, 4);
  });

  test('references the chrome.tabs.group and chrome.tabGroups.update APIs', () => {
    assert.match(content, /chrome\.tabs\.group\(/);
    assert.match(content, /chrome\.tabGroups\.update\(/);
  });

  test('describes the badge color lifecycle transition to green', () => {
    const section = getSection(content, '## 2. Workspace Lifecycle & Cleanup');
    assert.ok(section);
    assert.match(section, /"green"/);
  });

  test('out-of-scope items reference the agent-engine and endurance-runtime specs', () => {
    const refs = getSpecReferences(getSection(content, '## Out of Scope'));
    assert.deepEqual(
      [...new Set(refs)].sort(),
      ['01-agent-engine.spec.md', '03-endurance-runtime.spec.md'].sort(),
    );
  });
});

describe('03-endurance-runtime.spec.md', () => {
  const content = readSpec('03-endurance-runtime.spec.md');

  test('exactly six acceptance criteria', () => {
    const section = getSection(content, '## Acceptance Criteria');
    assert.equal(getCheckboxes(section).length, 6);
  });

  test('heartbeat section specifies a ping interval of 20 seconds', () => {
    const section = getSection(content, '## 1. Offscreen Document Heartbeat (Keep-Alive Engine)');
    assert.ok(section);
    assert.match(section, /chrome\.offscreen\.createDocument\(\)/);
    assert.match(section, /20 seconds/);
  });

  test('journal section enumerates all required checkpoint fields', () => {
    const section = getSection(content, '## 2. Atomic State Checkpointing & Crash Recovery');
    assert.ok(section);
    for (const field of ['task_id', 'step_count', 'conversation_history', 'active_tab_id', 'pending_action']) {
      assert.match(section, new RegExp('`' + field + '`'), `Missing journal field: ${field}`);
    }
  });

  test('out-of-scope items reference the agent-engine and multi-provider-router specs', () => {
    const refs = getSpecReferences(getSection(content, '## Out of Scope'));
    assert.deepEqual(
      [...new Set(refs)].sort(),
      ['01-agent-engine.spec.md', '04-multi-provider-router.spec.md'].sort(),
    );
  });
});

describe('04-multi-provider-router.spec.md', () => {
  const content = readSpec('04-multi-provider-router.spec.md');

  test('exactly seven acceptance criteria', () => {
    const section = getSection(content, '## Acceptance Criteria');
    assert.equal(getCheckboxes(section).length, 7);
  });

  test('embeds a well-formed ModelProviderConfig TypeScript interface with expected fields', () => {
    const codeBlockMatch = content.match(/```typescript\n([\s\S]*?)\n```/);
    assert.ok(codeBlockMatch, 'Missing typescript code block');
    const code = codeBlockMatch[1];

    assert.match(code, /interface ModelProviderConfig\s*\{/);
    // Balanced braces (a cheap syntactic sanity check on the snippet).
    const opens = (code.match(/\{/g) || []).length;
    const closes = (code.match(/\}/g) || []).length;
    assert.equal(opens, closes);

    const expectedFields = {
      providerId: 'string',
      baseUrl: 'string',
      apiKey: 'string',
      modelName: 'string',
      supportsNativeTools: 'boolean',
      contextWindow: 'number',
    };
    for (const [field, type] of Object.entries(expectedFields)) {
      assert.match(
        code,
        new RegExp(`\\b${field}\\s*\\??:\\s*${type}\\s*;`),
        `Expected field \`${field}: ${type};\` in ModelProviderConfig`,
      );
    }
  });

  test('embeds a well-formed <tool_call> XML example with valid JSON payload', () => {
    const xmlBlockMatch = content.match(/```xml\n([\s\S]*?)\n```/);
    assert.ok(xmlBlockMatch, 'Missing xml code block');
    const xml = xmlBlockMatch[1];

    assert.match(xml, /^<tool_call>\n/);
    assert.match(xml, /\n<\/tool_call>$/);

    const jsonBody = xml.replace(/<\/?tool_call>/g, '').trim();
    let parsed;
    assert.doesNotThrow(() => {
      parsed = JSON.parse(jsonBody);
    }, 'Embedded <tool_call> body is not valid JSON');
    assert.equal(parsed.name, 'click_element');
    assert.equal(typeof parsed.arguments, 'object');
    assert.equal(parsed.arguments.selector, '#submit-btn');
  });

  test('describes exactly two tiers of tool support', () => {
    const section = getSection(content, '## 2. The Tool Schema Polyfill Engine');
    assert.ok(section);
    assert.match(section, /\*\*Tier 1 \(Native Function Calling\):\*\*/);
    assert.match(section, /\*\*Tier 2 \(System Prompt XML Polyfill\):\*\*/);
  });

  test('mentions the agent-engine spec inline for the Tier 2 execution hand-off', () => {
    assert.match(content, /01-agent-engine\.spec\.md/);
  });

  test('out-of-scope section does not cross-reference other specs', () => {
    const refs = getSpecReferences(getSection(content, '## Out of Scope'));
    assert.deepEqual(refs, []);
  });
});
