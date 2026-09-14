# SPRINT-03 — A UI de bandeja (Wails v3)

## Objetivo

Fechar o bloqueio nº 1 do `ACHADOS.md` §9: o binário não tinha UI, então o
duplo clique não fazia nada. Este sprint entrega a janela de configuração, o
ícone na bandeja com menu, e um caminho real para salvar configuração — sem
quebrar o CLI que os scripts da VPS usam.

## Depende de

Sprint 02 (core Go em CLI-only, interop provado de ponta a ponta).

## Onda

1 (primeira entrega com UI; o MVP deixa de ser CLI-only)

## Por que não-CLI não era aceitável

O relato do usuário era literal: *"duplo clique não faz nada"*. Três causas
somadas:

1. Não existia código de GUI (`go.mod` tinha 2 dependências, zero Wails).
2. `-vps` e `-token` eram obrigatórios, e **não havia como salvar config** —
   a mensagem de erro dizia *"run once to save a config"*, que era impossível.
3. Mesmo com `-vps`/`-token`, `-launcher` travava o usuário de novo.

Este sprint resolve 1–3. O item 4 (túnel desligado na VPS) continua pendente e
não é código do Tray.

## Decisão — Wails v3.0.0-beta.21

O v2 chegou a ser escolhido com o argumento de "exige menos do toolchain Go".
**O argumento era inválido:** o v2 também exige Go ≥ 1.25. Sem essa vantagem, o
v3 é a escolha certa (API de `SystemTray` com StatusNotifierItem no Linux,
`NewService[T]`, runtime `window.wails`).

Spike primeiro, para não descobrir inviabilidade tarde:

- `/tmp/wails-spike/wailsspike` — linkou cgo GTK4/WebKitGTK 6.0, subiu sob Xvfb.
- Confirmado no log: `GTK=4.14.5 WebKitGTK=2.52.6`.
- Build cgo: ~48 s.

## Arquitetura

A decisão central: **um único ciclo de vida, dois frontends.** O
`internal/desktop/controller.go` é a única implementação do bridge (valida
config, sobe o sidecar, cria o proxy, abre o túnel). Os dois modos o usam:

```
main.go  ─┬─ sem flags ──► desktop.Run()      GUI: controller + Service Wails
          └─ com flag  ──► runHeadless()      CLI: controller + Wait()
```

Antes, o `main.go` do Sprint 02 tinha sua própria lógica. Duplicar teria
divergido na primeira correção; agora a GUI e o CLI não podem se comportar
diferente.

### Arquivos

| Arquivo | Papel |
|---|---|
| `main.go` | dispatch GUI × CLI; flags; merge de config |
| `internal/desktop/controller.go` | ciclo de vida do bridge (compartilhado) |
| `internal/desktop/service.go` | serviço Wails: `GetConfig`, `SaveConfig`, `Start`, `Stop`, `Status` |
| `internal/desktop/app.go` | app Wails: janela + bandeja + menu (`//go:build gui`) |
| `internal/desktop/gui_stub.go` | stub sem GUI (`//go:build !gui`) |
| `internal/desktop/assets.go` | embute o frontend (`//go:build gui`) |
| `internal/desktop/assets/tray-icon.png` | ícone 64×64 RGBA, gerado por `assets/gen-icon.py` |
| `internal/desktop/frontend/dist/` | janela: HTML/CSS/JS puro, sem npm |
| `internal/desktop/service_test.go` | 6 testes |

### Por que duas builds

A GUI linka GTK/WebKit via cgo; **não é cross-compilável**. O Makefile antigo
exportava `CGO_ENABLED := 0`, o que teria quebrado a GUI silenciosamente.

| Comando | Artefato | cgo | Cross |
|---|---|---|---|
| `make build` | `dist/openhands-tray` (GUI) | sim | não |
| `make build-headless` | `dist/openhands-tray-headless` | não | sim |
| `make release` | 5 binários headless | não | sim |

`make vet` roda **as duas** configurações, porque um erro de compilação na GUI
só apareceria no CI do host errado.

### Detecção GUI × CLI

Sem flags → GUI. Qualquer flag de conexão explícita (`-vps`, `-token`,
`-workdir`, `-port`, `-launcher`, `-config`, `-no-sidecar`, …) ou `-headless` →
CLI. É o comportamento que não quebra ninguém: quem passava flags continua
passando, e quem dá duplo clique ganha a janela.

`-version` nunca abre janela (sai antes do dispatch).

## Erros que os testes e o screenshot pegaram

1. **A janela não cabia no conteúdo.** Primeira versão 560×660; o formulário
   ocupa ~780 px, então Salvar/Iniciar ficavam **abaixo da dobra** — a janela
   abria e parecia quebrada. Medido por screenshot, não por olho: contagem de
   pixels da cor de destaque `#6366F1` deu **100 px** (só o checkbox). Corrigido
   para 580×800 e espaçamento menor → **3350 px** (botões visíveis).
2. **`Call.ByName` versus `Call.ByID`.** Os bindings gerados usam ID numérico;
   o JS puro usava nome. Verificado na fonte do Wails: o registro é
   `fmt.Sprintf("%s.%s.%s", pkgPath, typeName, methodName)`, então o nome
   totalmente qualificado é válido. Travado com o teste
   `TestFrontendServiceNameMatchesGoBindings`, que lê o `main.js` e compara com
   o `reflect.Type`.
3. **`vet -tags gui` herdava `CGO_ENABLED=0`** e quebrava dentro do próprio
   Wails (`undefined: pointer`). O alvo agora força `CGO_ENABLED=1`.
4. **Mensagem que prometia o impossível** (achado do `ACHADOS.md` §9): agora o
   erro do modo CLI diz *"run openhands-tray with no arguments to open the
   settings window"*.

## Verificação

```bash
cd /opt/openhands-tray
make fmt-check        # limpo
make vet              # headless + gui
make test             # 9 pacotes verdes
make build            # GUI 12M, dynamic
make build-headless   # 6.4M, static
make release          # 5/5 cross-compilados
```

Smoke test sob Xvfb (não há display no host):

- App subiu, serviu `/`, `/style.css`, `/main.js`.
- Histograma do screenshot: fundo de página, card, borda, texto e accent
  `#6366F1` todos presentes; **0 px** da cor de erro `#F87171`.
- Isso é a prova de que os bindings JS→Go responderam: o primeiro paint chama
  `GetConfig` e `Status`, e qualquer falha ali renderiza o banner vermelho.

Sem DISPLAY: o app loga o platform info e o GTK reclama
(`Gtk-WARNING: Failed to open display`) — esperado para um app de desktop.

## Pendências que ficam

- **Ícone no XFCE:** o painel do XFCE não implementa StatusNotifierItem. Precisa
  de `xfce4-statusnotifier-plugin` + adicionar "Status Notifier Plugin" ao
  painel. Documentado no README e no `ACHADOS.md` §9.
- **`.exe` de console no Windows:** a build GUI atual é Linux. Empacotar para
  Windows exigiria `-H=windowsgui` e um recurso de ícone; não foi feito.
- **Túnel desligado na VPS** (bloqueio nº 4 do `ACHADOS.md` §9) — fora do escopo
  deste repo.
- **Smoke test automatizado de GUI:** o screenshot é manual (Xvfb + import). Um
  teste de UI de verdade seria o próximo passo natural.

## Não-objetivos deste sprint

- Streaming de eventos por WS (v1.5).
- Multi-agent e métricas (v2).
- Ed25519 challenge-response e mTLS.
- Auto-start no login.
- Empacotamento (AppImage, .deb, .msi).
