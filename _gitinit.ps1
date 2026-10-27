$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot
$log = @()
function run($cmd){ $script:log += "> $cmd"; $out = Invoke-Expression $cmd 2>&1 | Out-String; $script:log += $out.TrimEnd() }

if (Test-Path (Join-Path $PSScriptRoot '.git')) {
  $log += "(.git already exists — skipping init)"
} else {
  run 'git init'
  run 'git branch -M main'
}
run 'git add index.html app.js pdf-extract.js recipes.js icons.js vendor .gitignore README_使い方.md DEPLOY_github_pages.md デプロイ手順.md 起動する.bat'
run 'git status --short'
run 'git commit -m "Flyer search app v2 (in-browser PDF import)"'
run 'git log --oneline -1'
# Show what git thinks is tracked under vendor (the important check)
run 'git ls-files vendor'

$log -join "`n" | Out-File -Encoding UTF8 (Join-Path $PSScriptRoot '_gitinit.txt')
