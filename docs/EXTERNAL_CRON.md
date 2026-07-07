# External cron setup (recommended)

GitHub's built-in `schedule` cron is unreliable for this repo (zero scheduled runs observed).
Use a free external service to call the GitHub API and trigger **Collect Wait Times** via
`workflow_dispatch` every 5 minutes instead.

The Python collector still enforces park hours (8 AM–midnight Eastern). Outside that window
the workflow runs but exits quickly without writing data.

## Step 1 — Create a GitHub token

### Option A: Fine-grained PAT (recommended)

1. GitHub → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens**
2. **Generate new token**
3. **Repository access:** Only select repositories → `HurryUpAndWait`
4. **Permissions → Repository permissions:**
   - **Actions:** Read and write
5. Copy the token (starts with `github_pat_`). You will not see it again.

### Option B: Classic PAT

1. **Personal access tokens** → **Tokens (classic)** → **Generate new token**
2. Scope: **`repo`** (includes workflow dispatch)
3. Copy the token (starts with `ghp_`).

Store the token in your password manager. Use it only in the cron service — never commit it.

## Step 2 — Configure [cron-job.org](https://cron-job.org) (free)

1. Create a free account and confirm your email.
2. **Cronjobs** → **Create cronjob**
3. Fill in:

| Field | Value |
|-------|-------|
| **Title** | HurryUpAndWait collector |
| **URL** | `https://api.github.com/repos/CinkadeusBG/HurryUpAndWait/actions/workflows/308819232/dispatches` |
| **Schedule** | Every 5 minutes (or custom: `*/5 * * * *`) |
| **Request method** | **`POST`** (required — GET returns **404**) |

Use the numeric workflow ID (`308819232`) in the URL, not the filename. Both work with
`gh`, but the ID is more reliable from third-party cron services.

4. Open **Advanced** tab:
   - **Request method:** `POST` (if this stays `GET`, GitHub returns **404 Not Found**)
   - **Headers** — add three separate headers:

| Header name | Header value |
|-------------|--------------|
| `Authorization` | `Bearer YOUR_TOKEN_HERE` (literal word `Bearer`, space, then token) |
| `Accept` | `application/vnd.github+json` |
| `X-GitHub-Api-Version` | `2022-11-28` |

   - **Request body** (raw JSON):

```json
{"ref":"main"}
```

   - **Content type / MIME type:** `application/json`

5. Save and enable the job.

### Expected result

- cron-job.org shows **HTTP 204** (success — GitHub returns no body)
- Within ~20 seconds: new run at [Collect Wait Times workflow](https://github.com/CinkadeusBG/HurryUpAndWait/actions/workflows/collect-wait-times.yml) with event **workflow_dispatch**
- During park hours: new commit `chore(data): collect wait times ...` on `main`
- Deploy workflow runs automatically after each successful collection

## Step 3 — Verify

```bash
# If you have GitHub CLI authenticated:
gh run list --workflow=collect-wait-times.yml --limit 5

# Or test the API once (replace TOKEN):
curl -X POST \
  -H "Authorization: Bearer TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  -H "Content-Type: application/json" \
  https://api.github.com/repos/CinkadeusBG/HurryUpAndWait/actions/workflows/308819232/dispatches \
  -d '{"ref":"main"}'
```

A successful call returns **HTTP 204** with an empty body.

Helper scripts in `scripts/` (read `GITHUB_TOKEN` from the environment):

- `trigger_collector.sh` (Linux/macOS)
- `trigger_collector.ps1` (Windows)

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| **HTTP 404** | Almost always **request method is GET, not POST**. Set method to `POST` in cron-job Advanced tab. Also verify token has access to `HurryUpAndWait` (fine-grained PAT must list this repo). |
| HTTP 401 | Token missing, invalid, or `Authorization` header malformed — use `Bearer YOUR_TOKEN` |
| HTTP 403 | Token missing **Actions: Read and write** (fine-grained) or `repo` scope (classic) |
| HTTP 422 | Body missing or invalid — must be `{"ref":"main"}` with `Content-Type: application/json` |
| Run succeeds, no data commit | Outside park hours (normal) — or check collector logs in the Actions run |
| Run succeeds, no deploy | Confirm `deploy-pages.yml` has the `workflow_run` trigger |

## Alternatives to cron-job.org

Any scheduler that can send an authenticated `POST` works:

- [EasyCron](https://www.easycron.com/)
- Google Cloud Scheduler (free tier limited)
- A Raspberry Pi / home server with cron + `trigger_collector.sh`

## Repo settings still required

**Settings → Actions → General → Workflow permissions → Read and write permissions**

Without this, the collector cannot `git push` data commits even when triggered successfully.