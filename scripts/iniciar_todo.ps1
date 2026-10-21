# Script para levantar los microservicios de Trazzo

$servicios = @(
    @{ Nombre = "auth-service"; Ruta = "services/auth-service" },
    @{ Nombre = "productos-service"; Ruta = "services/productos-service" },
    @{ Nombre = "transacciones-service"; Ruta = "services/transacciones-service" },
    @{ Nombre = "finanzas-service"; Ruta = "services/finanzas-service" },
    @{ Nombre = "reportes-service"; Ruta = "services/reportes-service" }
)

Write-Host "Iniciando microservicios..." -ForegroundColor Cyan

foreach ($s in $servicios) {
    Write-Host "Levantando $($s.Nombre)..." -ForegroundColor Yellow
    Start-Process powershell -ArgumentList '-NoExit', '-Command', "cd $($s.Ruta); ./venv/Scripts/Activate.ps1; python app.py"
}

Write-Host "Levantando Gateway (Puerto 5000)..." -ForegroundColor Green
Start-Process powershell -ArgumentList '-NoExit', '-Command', "cd gateway; ./venv/Scripts/Activate.ps1; python app.py"