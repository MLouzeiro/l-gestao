# backup.ps1 - espelho do projeto para o Google Drive (backup)
# Origem : C:\Users\Louzeiro\Projeto\Estoque  (codigo de trabalho)
# Destino: H:\Meu Drive\Projeto\Estoque      (copia de seguranca - NUNCA editar na mao)
#
# Uso: npm run backup
# Exclui do backup: node_modules, .next, coverage, .turbo, .git (regeneraveis)
# Inclui: .env (e o backup do ambiente; contera segredos reais depois da Fase 3)
#
# SEGURANCA: pastas/arquivos que existam SO no destino (nao pertencem a este
# projeto) sao preservados e avisados - o espelho nunca apaga conteudo alheio.

$ErrorActionPreference = 'Stop'
$src = 'C:\Users\Louzeiro\Projeto\Estoque'
$dst = 'H:\Meu Drive\Projeto\Estoque'

if (-not (Test-Path -LiteralPath $src)) {
  Write-Host "ERRO: origem nao existe: $src" -ForegroundColor Red
  exit 1
}
if (-not (Test-Path -LiteralPath 'H:\Meu Drive\Projeto')) {
  Write-Host "ERRO: Google Drive (H:) indisponivel - backup NAO executado." -ForegroundColor Red
  exit 8
}

# --- protecao de conteudo alheio no destino -------------------------------
$xd = @('node_modules', '.next', 'coverage', '.turbo', '.git')
$xf = @('*.tsbuildinfo', '*.log')
if (Test-Path -LiteralPath $dst) {
  $srcNames = Get-ChildItem -LiteralPath $src -Force | Select-Object -ExpandProperty Name
  $dstItems = Get-ChildItem -LiteralPath $dst -Force
  $foreignDirs = @($dstItems | Where-Object { $_.PSIsContainer -and $srcNames -notcontains $_.Name })
  $foreignFiles = @($dstItems | Where-Object { -not $_.PSIsContainer -and $srcNames -notcontains $_.Name })
  if ($foreignDirs.Count -gt 0 -or $foreignFiles.Count -gt 0) {
    Write-Host "AVISO: itens que existem SO no destino (serao PRESERVADOS):" -ForegroundColor Yellow
    $foreignDirs | ForEach-Object { Write-Host "  [pasta] $($_.Name)" -ForegroundColor Yellow }
    $foreignFiles | ForEach-Object { Write-Host "  [arquivo] $($_.Name)" -ForegroundColor Yellow }
    $xd += $foreignDirs | ForEach-Object Name
    $xf += $foreignFiles | ForEach-Object Name
  }
}
# -------------------------------------------------------------------------

Write-Host "Backup: $src" -ForegroundColor Cyan
Write-Host "     -> $dst" -ForegroundColor Cyan

$robocopyArgs = @(
  $src, $dst,
  '/MIR',                 # espelho: destino passa a ser igual a origem
  '/R:2', '/W:2',         # 2 tentativas, 2s de espera (Drive pode falhar)
  '/FFT',                 # tolerancia de timestamp (FAT/Drive)
  '/XJ',                  # nao seguir junctions/symlinks
  '/NP', '/NDL', '/NFL',  # saida resumida (sem lista de arquivos)
  '/XD', $xd,
  '/XF', $xf
)

& robocopy @robocopyArgs
$code = $LASTEXITCODE

if ($code -ge 8) {
  Write-Host "BACKUP FALHOU (codigo robocopy: $code)" -ForegroundColor Red
  exit 1
}
Write-Host "BACKUP OK (codigo robocopy: $code - 0/1 = sucesso)" -ForegroundColor Green
exit 0
