# Windows-Installer mit Azure Artifact Signing signieren (#311)

Die Release-Pipeline signiert den Windows-Installer und die darin enthaltene `Sketchdraw.exe` mit [Azure Artifact Signing](https://learn.microsoft.com/azure/artifact-signing/) (Public Trust), sobald die unten genannten Repository-Variablen gesetzt sind. Fehlen sie, bleibt der Installer unsigniert, und die Release Notes weisen das aus. Ist nur ein Teil der vier `AZURE_SIGNING_*`-Variablen gesetzt, bricht der Packaging-Lauf ab, statt unsigniert zu veröffentlichen.

Kosten: Basic-Tarif 9,99 USD pro Monat für bis zu 5.000 Signaturen. Es gibt keinen Schlüssel zum Herunterladen, und in GitHub liegt kein Geheimnis: Die Pipeline meldet sich per OIDC an.

## Voraussetzungen

- Ein Azure-Konto mit eigenem Entra-Tenant und einer Subscription (kein Firmen-Tenant eines Arbeitgebers).
- Public Trust ist nur für **Organisationen** in der EU möglich, nicht für Einzelpersonen. Gebraucht werden Firmenname, Website, eine E-Mail-Adresse auf der Firmendomain, Geschäftsadresse und eine Geschäftskennung. Die Namen im Zertifikat (CN, O) entsprechen dem rechtlich validierten Namen, nicht „Sketchdraw".
- Die Validierung dauert 1 bis 30 Werktage und erlaubt drei Versuche. Spätere Änderungen verlangen eine neue Validierung.

## 1. Azure einrichten (nur im Portal möglich)

1. **Resource Provider registrieren:** Subscriptions → deine Subscription → Resource providers → `Microsoft.CodeSigning` → Register.
2. **Artifact-Signing-Konto anlegen:** Suche „Artifact Signing Accounts" → Create. Region **West Europe**, Tarif Basic. Der Name ist 3 bis 24 Zeichen lang, global eindeutig und darf nicht mit „one" beginnen. Der Endpoint für West Europe ist `https://weu.codesigning.azure.net`. Er muss zur Region des Kontos passen, sonst folgt „403 Forbidden".
3. **Identitätsvalidierung:** Konto → Identity validations → New Identity → Organization → Public. Du brauchst dafür die Rolle „Artifact Signing Identity Verifier" auf dem Konto. Die Namen müssen exakt dem Ausweis des Vertreters entsprechen. Die primäre E-Mail-Adresse muss ein überwachtes Postfach auf der Firmendomain sein, der Bestätigungslink läuft nach sieben Tagen ab.
4. **Zertifikatsprofil:** Nach „Completed": Konto → Certificate profiles → Create → Typ „Public Trust" → Namen vergeben → unter „Verified CN and O" die Identität wählen. Die Vorschau („Certificate Subject Preview") zeigt den **CN**, den du als Herausgebername brauchst.

## 2. GitHub mit Azure verbinden (OIDC)

Das geht im Portal (Entra ID → App registrations) oder mit der Azure CLI. Die Befehle gehen davon aus, dass du mit `az login` im richtigen Tenant angemeldet bist.

```bash
APP_ID=$(az ad app create --display-name sketchdraw-release --query appId -o tsv)
az ad sp create --id "$APP_ID"

# Ein Eintrag genügt, weil der Packaging-Job die Umgebung "release" nutzt.
az ad app federated-credential create --id "$APP_ID" --parameters '{
  "name": "github-release",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:J-ARTS/de.sketchdraw.io:environment:release",
  "audiences": ["api://AzureADTokenExchange"]
}'

# Rolle "Signer" nur auf dem Signing-Konto, nicht auf der ganzen Subscription.
ACCOUNT_ID=$(az resource show --ids "/subscriptions/<subscription-id>/resourceGroups/<gruppe>/providers/Microsoft.CodeSigning/codeSigningAccounts/<konto>" --query id -o tsv)
az role assignment create --assignee "$APP_ID" \
  --role "Artifact Signing Certificate Profile Signer" --scope "$ACCOUNT_ID"
```

Passt der Rollenname oder der Resource-Typ in deinem Tenant nicht, nimm im Portal: Signing-Konto → Access control (IAM) → Add role assignment → „Artifact Signing Certificate Profile Signer" → die App `sketchdraw-release`.

## 3. Repository-Variablen setzen

Settings → Secrets and variables → Actions → **Variables** (keine Secrets, die Werte sind nicht geheim):

| Variable | Wert |
| --- | --- |
| `AZURE_CLIENT_ID` | Application (client) ID der App `sketchdraw-release` |
| `AZURE_TENANT_ID` | Verzeichnis-(Tenant-)ID |
| `AZURE_SUBSCRIPTION_ID` | ID der Subscription |
| `AZURE_SIGNING_ENDPOINT` | `https://weu.codesigning.azure.net` |
| `AZURE_SIGNING_ACCOUNT` | Name des Artifact-Signing-Kontos |
| `AZURE_SIGNING_PROFILE` | Name des Zertifikatsprofils |
| `AZURE_SIGNING_PUBLISHER` | CN aus der Certificate Subject Preview |

Die `AZURE_SIGNING_*`-Variablen schalten die Signatur ein. Setze sie erst, wenn Konto, Profil und Rolle fertig sind.

## 4. Prüfen

Nach einem Release-Lauf den Installer unter Windows prüfen:

```powershell
Get-AuthenticodeSignature .\Sketchdraw-<version>-windows-x64.exe | Format-List Status, SignerCertificate, TimeStamperCertificate
```

`Status` muss `Valid` sein, und der Herausgeber muss dem validierten Firmennamen entsprechen. Der Installer-Smoke-Test der Pipeline bestätigt die Signatur nicht, und eine gültige Signatur heißt auch nicht, dass SmartScreen sofort nicht mehr warnt: Die Reputation baut sich über Downloads auf.

## Technik und bekannte Grenzen

- `scripts/release.mjs` (`resolveSigningConfiguration`) übergibt die vier Werte als `-c.win.azureSignOptions.*` an electron-builder. Der Builder installiert das PowerShell-Modul `TrustedSigning` und ruft `Invoke-TrustedSigning` für die App-EXE und den Installer auf, bevor die SHA-256-Prüfsumme für Manifest und Update-Prüfung gebildet wird.
- Die Anmeldung läuft über `azure/login` (Azure CLI) und die Credential-Kette des Moduls. Dieser Weg ist bis zum ersten echten Lauf ungetestet. Scheitert er, ist der Ausweg ein Service-Principal mit Secret (`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` als Umgebungsvariablen des Packaging-Schritts).
- Die Zeitstempel kommen von `http://timestamp.acs.microsoft.com`. Die Signatur bleibt dadurch auch nach Ablauf des kurzlebigen Zertifikats gültig.
- Bereits veröffentlichte Releases bleiben unverändert unsigniert.
