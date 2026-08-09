# // RigDeck

**Um Stream Deck sem hardware.** Um app web instalado no celular controla remotamente
o seu PC Windows: abre programas, jogos, sites e scripts, posiciona janelas em
monitores específicos, entra/sai de tela cheia e encerra tudo com um toque —
tudo pela rede local, sem nenhum app nativo instalado no celular.

![RigDeck rodando em modo landscape](.github/screenshot.jpg)

## Sobre

RigDeck nasceu de um problema bem específico: jogar com amigos exigia abrir o
Discord num monitor e o jogo em outro, toda vez, na mão. Virou um painel completo
de automação: uma grade de botões configuráveis (com pastas, como o Stream Deck
de verdade), servida como PWA, controlando o PC via um pequeno backend que
comanda o Windows por baixo dos panos.

Não é um produto genérico "pra qualquer um" — é uma ferramenta pessoal de
automação de desktop, pensada pra rodar na sua própria rede local, controlando
a sua própria máquina. Publicado como referência de arquitetura e como base pra
quem quiser adaptar pra própria configuração.

## Como funciona

```
┌─────────────┐         HTTP (rede local)        ┌──────────────────┐
│  Celular /   │ ───────────────────────────────▶ │   Fastify API     │
│  qualquer    │ ◀─────────────────────────────── │   (Node + TS)      │
│  navegador   │            JSON                  └─────────┬────────┘
└─────────────┘                                              │
  PWA estática                                     spawna processos
  (vanilla JS, sem                                            │
   build step)                                                ▼
                                                    ┌──────────────────┐
                                                    │  Scripts          │
                                                    │  PowerShell        │
                                                    └─────────┬────────┘
                                                              │
                                                   Win32 API (SetWindowPos,
                                                   ShowWindow, SendKeys,
                                                   EnumWindows, taskkill…)
                                                              │
                                                              ▼
                                                     Windows de verdade
```

1. **Frontend** — PWA em JavaScript puro (sem framework, sem build step),
   servida como arquivo estático. Grade de botões (`presets`) organizados em
   pastas, editor completo embutido no próprio app, atualização automática
   quando o servidor sobe uma versão nova.
2. **Backend** — API Fastify + TypeScript. Recebe "rodar preset X", resolve os
   passos daquele preset e chama o executor.
3. **Executor** — decide *como* cada passo roda: abrir um programa, mandar uma
   tecla, rodar um comando, ou fechar algo que já tava aberto.
4. **Scripts PowerShell** — a camada que efetivamente conversa com o Windows:
   enumera monitores, move/redimensiona janelas via Win32 API, extrai ícones de
   `.exe`, descobre jogos instalados (Steam/Epic), envia teclas via `SendKeys`.

Nenhuma dessas camadas sabe da existência das outras além da interface — o
frontend não sabe que existe PowerShell, o executor não sabe que existe uma
grade de botões. Cada uma é testável isolada.

## Funcionalidades

- **Presets em pastas** — organiza atalhos em pastas aninhadas, igual ao
  Stream Deck físico da Elgato.
- **Três tipos de passo por preset**:
  - `launch` — abre um `.exe`, atalho, protocolo (`steam://`, `epicgames://`)
    ou URL, com posicionamento de janela por monitor e tela cheia opcional.
  - `cmd` — roda um comando de shell qualquer, retorna a saída.
  - `key` — envia uma tecla (F11, ESC, Alt+Enter…) pra janela em foco ou pra
    um processo específico; inclui `MAXIMIZE`/`RESTORE` como ações de janela
    de verdade (não dependem do app escutar a tecla).
- **Presets com múltiplos passos** — um botão só abre Spotify + Brave + VS
  Code de uma vez, por exemplo.
- **Posicionamento por monitor** — cada passo escolhe em qual monitor abrir e
  se entra em tela cheia (maximiza) ou fica numa posição/tamanho específico.
- **Segurar-pra-fechar** — segurar um botão pressionado encerra exatamente o
  que aquele preset abriu (rastreado por PID ou HWND, não mata processos com
  o mesmo nome que já estavam abertos por outro motivo).
- **URLs abrem em janela própria** (`--app=`) — sem abas, sem barra de
  endereço, e fecháveis individualmente sem derrubar o navegador inteiro.
- **Descoberta automática de programas** — varre Menu Iniciar, Desktop,
  manifestos do Steam e do Epic Games Launcher, e classifica automaticamente
  o que é jogo vs. programa comum.
- **Stats ao vivo** — CPU, RAM e disco livre, direto na barra de status.
- **PWA instalável** — "adicionar à tela inicial" no celular, funciona em
  landscape com um layout compacto (até 4 botões por página, bandeja
  deslizável, igual ícones de celular).
- **Export/import** — backup de todos os presets em um JSON.
- **Auto-start sem admin** — sobe sozinho no login via atalho na pasta
  Inicializar do Windows, sem precisar de privilégios elevados.

## Stack

| Camada | Tecnologia |
|---|---|
| Backend | [Fastify](https://fastify.dev) + TypeScript, Node.js ≥ 20 |
| Frontend | JavaScript puro (ES modules), zero framework, zero build step |
| Automação | PowerShell (Win32 API via `Add-Type` inline) |
| Testes | `node:test` nativo, `tsx` como loader |
| Persistência | JSON local (sem banco de dados) |

## Por que Fastify?

O backend original era Express. A troca pra Fastify + TypeScript foi
deliberada pra essa versão pública: tipagem de ponta a ponta, schema de rota
nativo, e uma base mais próxima do que se usaria num serviço de produção —
mantendo a mesma filosofia minimalista (sem ORM, sem camada de DI, sem
abstração que o projeto não precisa).

## Começando

### Pré-requisitos

- Windows 10/11
- [Node.js](https://nodejs.org) 20 ou mais recente
- PowerShell (já vem no Windows)

### Instalação

```bash
git clone https://github.com/<seu-usuario>/rigdeck.git
cd rigdeck
npm install
npm run build
npm start
```

O servidor sobe em `http://localhost:4321`. Acesse de qualquer dispositivo na
mesma rede local pelo IP da máquina (`http://192.168.x.x:4321`).

Pra desenvolvimento com reload automático:

```bash
npm run dev
```

### Configuração

Copie `.env.example` pra `.env` se quiser mudar a porta ou o caminho do
arquivo de presets:

```bash
cp .env.example .env
```

### Auto-start no login (sem precisar de admin)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-startup-shortcut.ps1
```

Cria um atalho na pasta Inicializar do Windows que sobe o servidor sozinho a
cada login.

## Uso

1. Abra `http://localhost:4321` (ou o IP da máquina) no celular ou navegador.
2. Toque em **EDITAR** pra abrir o painel de configuração.
3. Crie uma pasta ou um atalho, escolha o tipo de passo (**Abrir**, **Comando
   CMD** ou **Tecla**), preencha o alvo e salve.
4. Toque no botão criado pra rodar o preset. Segure pressionado pra encerrar
   o que ele abriu.

### Exemplo: Discord + jogo em monitores separados

```json
{
  "name": "Sessão de jogo",
  "steps": [
    { "type": "launch", "target": "C:\\...\\Discord.exe", "monitor": 0 },
    { "type": "launch", "target": "steam://rungameid/730", "monitor": 1, "fullscreen": true }
  ]
}
```

## Estrutura do projeto

```
rigdeck/
├── src/
│   ├── server.ts        # rotas Fastify
│   ├── types.ts         # tipos compartilhados
│   └── lib/
│       ├── executor.ts       # decide como cada passo roda
│       ├── presets-store.ts  # persistência (JSON local)
│       ├── launch.ts         # abre programas/URLs
│       ├── stats.ts          # CPU/RAM/disco
│       ├── icons.ts          # extrai ícone de .exe
│       └── monitors.ts, programs.ts, json-array.ts
├── scripts/              # PowerShell -- a camada que fala com o Windows
├── public/                # PWA (HTML/CSS/JS puro, sem build)
├── test/                  # node:test
└── run-hidden.vbs          # sobe o server sem abrir janela de console
```

## Limitações conhecidas

- **Windows only.** Todo o controle de janela depende de Win32 API via
  PowerShell.
- Pensado pra **um usuário, uma máquina, uma rede local** — não tem
  autenticação. Não exponha a porta 4321 pra internet sem colocar algo na
  frente (VPN, reverse proxy com auth).
- O rastreamento de "o que fechar" fica em memória — reinicia o servidor,
  perde o rastreamento fino (cai de volta pra fechar por nome de processo).

## Licença

MIT — veja [LICENSE](LICENSE).
