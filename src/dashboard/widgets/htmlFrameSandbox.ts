/**
 * Keep script-enabled local HTML in an opaque origin. Combining allow-scripts
 * with allow-same-origin would let srcdoc content escape its sandbox.
 */
export function htmlFrameSandbox(allowScripts: boolean): string {
  return allowScripts
    ? "allow-scripts allow-popups"
    : "allow-same-origin allow-popups";
}
