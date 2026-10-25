import { createCn } from "cn/config";

/**
 * Class merger that knows the theme's custom font sizes (`--text-*` in
 * app/globals.css). Without this it reads `text-overline` as a text color
 * and silently drops it whenever a `text-<color>` class sits beside it.
 * Components that use those sizes import `cn` from here, not from "cn".
 */
export const cn = createCn({
  extend: { classGroups: { "font-size": [{ text: ["overline", "h1", "stat"] }] } },
});
