import assert from "node:assert/strict";
import { HireZoomScript } from "./hire-zoom-script";
import { HIRE_ZOOM_SCRIPT } from "./hire-zoom";

console.log("hire-zoom-script tests");

// 1. SSR test (window is undefined in Node.js environment)
{
  assert.equal(typeof window, "undefined", "Node test env should have undefined window");
  const el = HireZoomScript();
  assert.equal(el.type, "script");
  assert.equal(el.props.type, undefined, "SSR script must omit type attribute so it executes as JavaScript");
  assert.equal(el.props.dangerouslySetInnerHTML?.__html, HIRE_ZOOM_SCRIPT);
  assert.equal(el.props.suppressHydrationWarning, true);
  console.log("  ✓ SSR: renders executable <script> with suppressHydrationWarning");
}

// 2. Client test (simulated window object)
{
  // @ts-expect-error - simulating browser environment
  globalThis.window = {};
  try {
    const el = HireZoomScript();
    assert.equal(el.type, "script");
    assert.equal(
      el.props.type,
      "application/json",
      "Client script must use application/json so React 19 does not warn about unexecuted client scripts",
    );
    assert.equal(el.props.dangerouslySetInnerHTML?.__html, HIRE_ZOOM_SCRIPT);
    assert.equal(el.props.suppressHydrationWarning, true);
    console.log("  ✓ Client: renders <script type=\"application/json\"> without warning");
  } finally {
    // @ts-expect-error - cleanup simulated window
    delete globalThis.window;
  }
}

console.log("All hire-zoom-script tests passed!");
