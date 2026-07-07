# Trigger the Collect Wait Times workflow via GitHub API.
# Usage: $env:GITHUB_TOKEN = "github_pat_xxx"; .\scripts\trigger_collector.ps1
param(
    [string]$Repo = $(if ($env:GITHUB_REPO) { $env:GITHUB_REPO } else { "CinkadeusBG/HurryUpAndWait" }),
    [string]$Workflow = $(if ($env:GITHUB_WORKFLOW) { $env:GITHUB_WORKFLOW } else { "collect-wait-times.yml" }),
    [string]$Ref = $(if ($env:GITHUB_REF) { $env:GITHUB_REF } else { "main" })
)

if (-not $env:GITHUB_TOKEN) {
    Write-Error "Set GITHUB_TOKEN to a PAT with Actions read/write on $Repo"
    exit 1
}

$uri = "https://api.github.com/repos/$Repo/actions/workflows/$Workflow/dispatches"
$headers = @{
    Authorization         = "Bearer $($env:GITHUB_TOKEN)"
    Accept                = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
}

try {
    Invoke-WebRequest -Method Post -Uri $uri -Headers $headers -Body (@{ ref = $Ref } | ConvertTo-Json) -ContentType "application/json" | Out-Null
    Write-Host "Triggered $Workflow on $Ref (HTTP 204)"
}
catch {
    if ($_.Exception.Response.StatusCode.value__ -eq 204) {
        Write-Host "Triggered $Workflow on $Ref (HTTP 204)"
        exit 0
    }
    Write-Error "Request failed: $($_.Exception.Message)"
    exit 1
}