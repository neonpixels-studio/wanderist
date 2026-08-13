/**
 * Escape the five HTML-significant characters so untrusted text is safe in
 * element text content and quoted attribute values. Titles rendered in the
 * command palette can come from other users, so an unescaped `<img onerror>`
 * would otherwise execute — escape before building any highlight markup.
 *
 * Not safe for unquoted attributes, `<script>`/`<style>` bodies, or URL
 * contexts, and not idempotent — never apply it to already-escaped text.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
