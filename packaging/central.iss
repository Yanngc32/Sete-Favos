; Instalador do Sete Favos. Compilar depois do PyInstaller (build\dist\central):
;   ISCC.exe /DAppVersion=0.1.0 packaging\central.iss      -> build\CentralSetup-0.1.0.exe
; O mesmo .exe instala, atualiza (por cima) e é o que a atualização automática roda com /VERYSILENT.

#ifndef AppVersion
  #error Passe a versão: ISCC /DAppVersion=X.Y.Z
#endif

; Porta padrão da central (a mesma de casa/settings.py; o casa.env pode mudar).
#define Porta "38471"

[Setup]
AppId={{6F1C2E7A-4B8D-4E57-9C1A-2D3B5F7E9A10}
AppName=Sete Favos
AppVersion={#AppVersion}
AppPublisher=Sete Favos contributors
VersionInfoVersion={#AppVersion}
DefaultDirName={autopf}\Central
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\build
OutputBaseFilename=CentralSetup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; A própria central é parada no PrepareToInstall; o Restart Manager só atrapalharia no modo silencioso.
CloseApplications=no
RestartApplications=no
UninstallDisplayName=Sete Favos
UninstallDisplayIcon={app}\central.exe
SetupLogging=yes

[Languages]
Name: "pt"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Files]
Source: "..\build\dist\central\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "setup.ps1"; DestDir: "{app}\tools"; Flags: ignoreversion

[InstallDelete]
; Atualização: tira o que sobrou da versão anterior (dependências removidas, por exemplo).
Type: filesandordirs; Name: "{app}\_internal"
; Atalhos de quando o app se chamava "Central".
Type: files; Name: "{autoprograms}\Central.lnk"
Type: files; Name: "{app}\Abrir a Central.url"

[INI]
Filename: "{app}\Abrir o Sete Favos.url"; Section: "InternetShortcut"; Key: "URL"; String: "http://localhost:{#Porta}"

[Icons]
Name: "{autoprograms}\Sete Favos"; Filename: "{app}\Abrir o Sete Favos.url"

[Run]
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ""{app}\tools\setup.ps1"" -App ""{app}"""; \
  StatusMsg: "Configurando a tarefa, o firewall e a pasta de dados..."; Flags: runhidden waituntilterminated
Filename: "{app}\Abrir o Sete Favos.url"; Description: "Abrir o Sete Favos"; Flags: postinstall shellexec nowait skipifsilent

[UninstallRun]
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ""{app}\tools\setup.ps1"" -App ""{app}"" -Remover"; \
  RunOnceId: "RemoverTarefa"; Flags: runhidden waituntilterminated

[Code]
procedure PararCentral();
var
  Code: Integer;
begin
  // Para a tarefa e mata o processo: os arquivos do central.exe ficam travados enquanto ele roda.
  Exec(ExpandConstant('{sys}\schtasks.exe'), '/End /TN "Central"', '', SW_HIDE, ewWaitUntilTerminated, Code);
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /T /IM central.exe', '', SW_HIDE, ewWaitUntilTerminated, Code);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  PararCentral();
  Result := '';
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
    PararCentral();
end;
