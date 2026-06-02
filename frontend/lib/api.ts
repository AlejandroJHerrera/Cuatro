// Empty = same-origin. Browser hits /api/* on the Next dev server, which
// rewrites to the backend (see next.config.ts). Keeps phone clients on a
// single HTTPS origin via ngrok with no CORS or mixed-content concerns.
export const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "";
