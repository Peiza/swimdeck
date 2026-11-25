# Feedback form

The footer link "Tyck till / rapportera fel" opens a form. The Worker (`POST /api/feedback`) turns each
message into an issue in the private repo `Peiza/swimdeck-feedback`.

Setup (once):

1. Create the private repository `swimdeck-feedback` (issues enabled).
2. Create a fine-grained personal access token: only that repository, permission **Issues: Read and write**, nothing else.
3. Store it as a Worker secret: `wrangler secret put FEEDBACK_TOKEN` in `worker/`
   (or Cloudflare dashboard > Workers > swimdeck-api > Settings > Variables and Secrets).

`FEEDBACK_REPO` is a plain variable in `worker/wrangler.toml`. Without the secret the route answers 503 and the form tells the visitor to write on GitHub instead.

What is sent: kind, message, optional email, and (only when the box is ticked) version, language, browser, OS, screen size, installed or not, and the current view. No swimmer data, no sync link. The route shares the per-visitor write limit with sync and push, and has a hidden spam field.
