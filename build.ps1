$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectRoot

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    throw "pnpm was not found. This build script does not install tools automatically."
}
if (-not (Test-Path -LiteralPath "node_modules/typescript/bin/tsc")) {
    throw "The project TypeScript dependency is missing. Run 'pnpm install' first."
}

pnpm run typecheck
if ($LASTEXITCODE -ne 0) { throw "Type checking failed with exit code $LASTEXITCODE." }
pnpm run build
if ($LASTEXITCODE -ne 0) { throw "TypeScript build failed with exit code $LASTEXITCODE." }
Write-Host "TypeScript build completed: $ProjectRoot\dist"
