# Demo-Betrieb

Taktline lässt sich ohne GitLab-Gegenstelle betreiben — als öffentlich
erreichbare Demo, in der man alles anfassen kann: Balken verschieben, Termine
und Fortschritt ändern, Aufgaben und Meilensteine anlegen, kommentieren.

Eingeschaltet wird das über eine einzige Variable:

```env
DEMO_MODE=true
```

---

## Was der Demo-Modus ändert

**GitLab-Aufrufe.** `getGitlabClientForUser()` liefert statt eines echten
API-Clients einen Stub ([`src/lib/gitlab/demo-client.ts`](src/lib/gitlab/demo-client.ts)),
der dieselben Aufrufe aus der lokalen Datenbank beantwortet. Weil alle 29
Aufrufstellen ohnehin durch diese eine Funktion gehen, musste keine einzige
Server Action angepasst werden.

Der Stub schreibt bewusst nichts in die DB — das erledigt jede Action nach
ihrem GitLab-Aufruf ohnehin selbst. Er liefert nur die Antworten, die die
Aufrufer erwarten: eine frische IID bei `Issues.create`, den Issue-Stand nach
dem Patch bei `Issues.edit` (daraus übernimmt die App Zuständige und Labels),
analog bei Meilensteinen.

Einzige Ausnahme sind Kommentare: die spiegelt das Datenmodell nicht, sie
werden im Normalbetrieb live aus GitLab geholt. Im Demo-Modus liegen sie
deshalb im Speicher des Prozesses und sind nach einem Neustart wieder auf dem
Ausgangsstand.

**Login.** Statt OAuth zeigt `/login` einen „Demo starten"-Button, der auf
[`/api/demo/login`](src/app/api/demo/login/route.ts) zeigt. Die Route setzt den
Session-Cookie auf den Token aus dem Seed — Auth.js nutzt die
Database-Session-Strategie, findet die Session also auf normalem Weg.

Alle Besucher teilen sich dadurch eine Session und damit einen Datenstand.
Für eine Demo ist das gewollt; wer daran etwas ändert, sieht es bei allen.

**Daten.** Beim Start seedet der Container die Beispieldaten und wiederholt
das im Abstand von `DEMO_RESET_INTERVAL_MINUTES`. Ein frisch hochgefahrener
Container ist damit ohne manuellen Schritt benutzbar, ein leeres Volume
genügt. Der Reset legt die Demo-Session mit demselben Token neu an —
geöffnete Browser-Tabs bleiben also eingeloggt.

**Reconciliation** ist aus, es gäbe nichts zu reconcilen.

---

## Deployment auf einem VPS

Voraussetzungen: Docker mit Compose-Plugin, eine auf den Server zeigende
Domain.

```bash
git clone https://github.com/patrickkellerabbts/taktline.git
cd taktline

cp .env.demo.example .env.demo
$EDITOR .env.demo          # POSTGRES_PASSWORD, AUTH_URL, AUTH_SECRET, TOKEN_ENCRYPTION_KEY
                           # Secrets: openssl rand -base64 32

BUILD_SHA=$(git rev-parse --short HEAD) \
  docker compose -f compose.demo.yml --env-file .env.demo up -d --build

docker compose -f compose.demo.yml --env-file .env.demo logs -f app
```

Im Log sollte kurz nach dem Start stehen:

```
Demo: Daten zurückgesetzt   (reason: startup, workPackages: 26, …)
Demo: Auto-Reset aktiviert  (intervalMinutes: 60)
```

Die App lauscht auf `127.0.0.1:3043` — nicht öffentlich. Davor gehört ein
Reverse-Proxy mit TLS.

### TLS mit Caddy

Der kürzeste Weg, wenn auf dem Server noch nichts läuft. Caddy holt und
erneuert das Zertifikat selbst:

```bash
apt install caddy
```

`/etc/caddy/Caddyfile`:

```
demo.example.com {
    reverse_proxy 127.0.0.1:3043
}
```

```bash
systemctl reload caddy
```

### Alternativ: Traefik

Wenn auf dem Server bereits Traefik läuft, das Port-Mapping in
`compose.demo.yml` entfernen, den Container ins Traefik-Netz hängen und
labeln:

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.taktline-demo.rule=Host(`demo.example.com`)"
  - "traefik.http.routers.taktline-demo.tls.certresolver=le"
  - "traefik.http.services.taktline-demo.loadbalancer.server.port=3043"
```

### Wichtig: AUTH_URL muss zum Schema passen

Auth.js leitet den Namen des Session-Cookies aus dem Protokoll ab: unter
HTTPS liest es `__Secure-authjs.session-token`, sonst `authjs.session-token`.
Steht in `AUTH_URL` `http://`, während der Browser `https://` spricht, setzt
der Demo-Login den falschen Cookie und der Klick auf „Demo starten" landet
wieder auf der Login-Seite.

---

## Betrieb

```bash
# Beispieldaten sofort zurücksetzen
docker compose -f compose.demo.yml --env-file .env.demo restart app

# Update auf neuen Stand
git pull
BUILD_SHA=$(git rev-parse --short HEAD) \
  docker compose -f compose.demo.yml --env-file .env.demo up -d --build
```

### Ressourcen

Der Stack besteht aus zwei Containern (App + Postgres) und kommt mit 2 GB RAM
aus. Ein Reset schreibt rund 26 Work Packages samt Anhang — das dauert
Bruchteile einer Sekunde und ist auch bei einem kurzen Intervall unkritisch.

### Was ein Besucher nicht kann

- an echte Daten kommen: es gibt keine, der Seed ist vollständig erfunden
- Zugangsdaten abgreifen: im Demo-Modus liegen keine OAuth-Tokens in der DB,
  `GITLAB_CLIENT_ID` und `GITLAB_CLIENT_SECRET` werden nicht gesetzt
- dauerhaften Schaden anrichten: der nächste Reset räumt auf

Was er kann: die Demo für andere Besucher verbasten, bis zum nächsten Reset.
Wer das eng takten will, setzt `DEMO_RESET_INTERVAL_MINUTES` herunter — bei
einem Reset laufen allerdings auch die Änderungen anderer gerade aktiver
Besucher weg.

---

## Lokal ausprobieren

```bash
npm run db:up
npm run demo:reset
npm run demo:dev      # setzt DEMO_MODE=true und zeigt auf die Demo-DB
```

Dann [http://localhost:3043](http://localhost:3043) öffnen → „Demo starten".

Im Dev-Modus ist der Auto-Reset abgeschaltet (`DEMO_RESET_INTERVAL_MINUTES=0`),
damit Änderungen beim Entwickeln nicht unter den Händen verschwinden. Manuell
zurücksetzen: `npm run demo:seed`.
