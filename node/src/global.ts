/**
 * IIFE browser-bundle entry. Built by tsup into `dist/sdk.global.js` and
 * exposes `window.hub02` for no-build / CDN drop-in usage:
 *
 *   <script src="https://.../sdk.global.js"></script>
 *   <script>const u = await window.hub02.user();</script>
 *
 * Client-only — does NOT pull in `jose` or any server code.
 */
import { hub02 } from "./client";

export { hub02 };
export default hub02;
