# Live do Abismo — Boneco Game

Sistema de live interativa para TikTok com avatar em vídeo, inteligência artificial, Coqui XTTS, sincronização labial por micro-pausas, monitoramento de eventos via Tor, renderer próprio e transmissão RTMP.

O projeto foi criado para operar lives de personagens virtuais usando vídeos previamente gerados por IA. Os vídeos do personagem trabalham com fundo removido/transparente e são combinados em tempo real com cenários, música, falas geradas por IA e interações recebidas do TikTok.

## Estado atual

O sistema atualmente possui:

- painel web para controle da live;
- renderer próprio em HTML/JavaScript;
- personagem animado por vídeos;
- modos visual em túnel e mapa;
- monitoramento TikTok separado da transmissão;
- monitoramento obrigatório via Tor;
- captura de comentários, presentes, entradas de usuários e quantidade de espectadores;
- IA para geração de respostas;
- Coqui XTTS para geração de voz;
- geração de WAV + timeline JSON;
- sincronização labial baseada em pausas e micro-pausas;
- fila separada para comentários, presentes e eventos de sistema;
- prioridades de resposta;
- abertura automática antes da transmissão;
- warm-up do XTTS antes da entrada ao vivo;
- boas-vindas automáticas em salas pequenas;
- sanitização de nomes de usuários;
- reaproveitamento de fotos de perfil;
- autodiagnóstico da live;
- tentativa automática de recuperação do monitor TikTok;
- processamento de vídeos com fundo verde pelo painel;
- atualização segura do sistema pelo GitHub;
- fala manual pelo painel;
- transmissão direta via GStreamer/RTMP.

---

## Visão geral da arquitetura

Fluxo principal:

```text
TikTok
  │
  │ monitoramento via Tor
  ▼
Node TikTok Live Monitoring Server
  │
  │ Socket.IO
  ▼
tiktok_monitor.py
  │
  ├── member
  ├── chat
  ├── gift
  └── viewer count
  │
  ▼
live_events.py
  │
  ▼
event_decision_worker.py
  │
  ├── IA para comentários
  ├── IA para agradecimento de presentes
  └── texto pronto para eventos de sistema
  │
  ▼
speech_queue.py
  │
  ▼
tts_worker.py
  │
  ▼
Coqui XTTS
  │
  ├── WAV
  └── JSON timeline
  │
  ▼
renderer.js
  │
  ├── vídeo do personagem
  ├── sincronização
  ├── música
  ├── perfil do usuário
  └── cenário
  │
  ▼
GStreamer
  │
  ▼
RTMPS TikTok
```

---

## Início da live

O início da live não abre mais a transmissão imediatamente.

Ao clicar em **Iniciar live**, o sistema:

1. limpa filas antigas;
2. gera uma fala de abertura usando a IA;
3. inclui data e hora atuais por extenso no contexto;
4. carrega o Coqui XTTS;
5. gera o áudio da abertura;
6. gera a timeline JSON;
7. coloca a abertura pronta na fila;
8. inicia renderer e transmissão;
9. toca a abertura logo após entrar ao vivo.

O prompt de abertura é propositalmente curto:

```text
Você é o Boneco do Abismo e está iniciando sua live.
Hoje é vinte e sete de agosto de dois mil e vinte e seis.
Agora são seis horas e vinte minutos.
Faça uma abertura espontânea. Mencione naturalmente a data e a hora para mostrar que está ao vivo.
Responda somente com a fala.
```

A data e a hora são construídas pelo backend já por extenso.

### Warm-up do XTTS

O XTTS é carregado durante a preparação da abertura.

Em teste real:

```text
Primeira geração / modelo frio: 23,41 s
Segunda geração / modelo aquecido: 2,07 s
Redução medida: 91,2%
```

Isso evita que o primeiro comentário da live espere o carregamento completo do modelo.

---

## Coqui XTTS e divisão de texto

A IA pode retornar textos maiores que 150 caracteres.

O TTS divide o conteúdo em partes menores respeitando pontos naturais do texto, evitando cortar frases de maneira bruta.

O resultado de cada fala inclui:

```text
speech_xxx.wav
speech_xxx.json
```

O WAV contém a fala final.

O JSON contém segmentos como:

```json
{
  "kind": "speech"
}
```

```json
{
  "kind": "micro_pause"
}
```

```json
{
  "kind": "pause"
}
```

---

## Sincronização labial

A sincronização não depende de lip-sync tradicional quadro a quadro.

O sistema analisa o áudio e gera uma timeline baseada em:

- trechos de fala;
- pequenas pausas;
- pausas maiores;
- final útil da fala.

Durante micro-pausas, o renderer altera discretamente o comportamento/velocidade do vídeo de fala para criar uma impressão visual melhor de sincronização com o áudio.

O áudio e a música não devem ter a velocidade alterada por essa lógica; o ajuste pertence ao vídeo do personagem.

---

## Monitoramento TikTok

O monitor é independente da transmissão.

Arquitetura:

```text
TikTok
  ↓
Tor SOCKS
  ↓
Node Monitoring Server
  ↓
Socket.IO local
  ↓
Python tiktok_monitor.py
```

### Tor obrigatório

O monitor deve usar:

```text
SOCKS 127.0.0.1:9050
```

O objetivo é separar a rede usada para monitorar a sala da conexão responsável pela transmissão.

O sistema registra:

```json
{
  "network": {
    "mode": "tor",
    "forced": true
  }
}
```

Se o autodiagnóstico deixar de confirmar Tor obrigatório, o estado da saúde passa para crítico em vez de fazer fallback silencioso para conexão direta.

---

## Eventos recebidos

Atualmente são observados:

- `member`: entrada de usuário;
- `chat`: comentário;
- `gift`: presente;
- `viewer`: quantidade de espectadores;
- `roomInfo`: informações da sala.

O status do monitor mantém contadores por tipo de evento.

Exemplo de uma live real:

```text
member: 402
chat: 304
gift: 79
viewer_count: 144
```

---

## Boas-vindas automáticas

Quando a quantidade de espectadores é conhecida e está abaixo de 20, usuários que entram podem receber uma saudação automática.

Regras atuais:

```text
viewer_count conhecido
        │
        ├── >= 20 → não gerar saudação
        │
        └── < 20
              │
              ├── usuário já saudado → ignora
              ├── cooldown ativo → ignora
              └── gera saudação
```

Configuração:

```text
limite de espectadores: 20
cooldown: 9 segundos
prioridade: 100
uma saudação por usuário por sessão
```

As frases ficam em:

```text
config/member_welcome_phrases.txt
```

Exemplos:

```text
Oi {nome}, tudo bem?
Como vai, {nome}?
E aí, {nome}?
Que bom que você entrou, {nome}.
{nome}, chegou na hora certa.
```

Não são utilizados termos que exigem inferência de gênero, como:

```text
bem-vindo
bem-vinda
amigo
amiga
```

O arquivo pode ser editado sem modificar o código Python.

---

## Sanitização de nomes

Nomes vindos do TikTok podem conter:

- emojis;
- caracteres decorativos;
- números;
- símbolos;
- fontes Unicode estilizadas;
- nomes de usuário difíceis de pronunciar.

O sistema possui sanitização em:

```text
src/boneco_game/services/live_text.py
```

Exemplo:

```text
→💯157‽M!GΠ€L💯←
```

é processado antes de chegar ao TTS.

O objetivo é produzir um nome curto e pronunciável sem tentar determinar gênero.

---

## Fotos de perfil

Comentários e presentes normalmente fornecem URL da foto de perfil.

O monitor também mantém um cache de imagem por usuário para reutilizar uma foto conhecida quando um evento posterior daquele usuário chegar sem URL de avatar.

A foto pode ser exibida:

- no cartão da mensagem;
- no perfil sobre o personagem;
- no túnel de usuários.

Caso nenhuma foto esteja disponível, o renderer possui fallback visual.

---

## Prioridade dos eventos

O sistema usa filas separadas.

Visão conceitual:

```text
Abertura preparada       prioridade 120
Entrada / boas-vindas    prioridade 100
Presente                  prioridade 95
Fala manual               prioridade 90
Comentário                prioridade 45
```

A prioridade numérica não é a única regra.

`live_events.py` também evita sequência infinita de presentes:

```text
MAX_GIFT_BURST_BEFORE_CHAT = 2
```

Quando há comentários aguardando, depois de uma sequência limitada de presentes o sistema dá espaço para comentário.

Para comentários, mantém-se apenas o comentário mais recente de cada usuário, evitando acumular mensagens antigas enquanto a live continua avançando.

---

## Fala manual

O painel permite digitar uma frase para o Boneco falar imediatamente.

Essa fala:

- entra na fila com prioridade alta;
- passa pelo TTS normalmente;
- movimenta o personagem normalmente;
- não deve exibir nome de usuário;
- não deve exibir texto no cartão;
- não deve exibir foto/avatar de usuário.

É identificada por:

```text
metadata.source = manual
```

---

## Autodiagnóstico da live

Serviço:

```text
src/boneco_game/services/live_health.py
```

O watchdog roda continuamente enquanto o sistema está ativo.

Estados:

```text
healthy
attention
recovering
critical
stopped
```

Verifica:

- live ativa;
- processo/thread do monitor;
- `connected`;
- `listening`;
- Tor obrigatório;
- contadores de eventos;
- tempo sem eventos;
- fila de TTS;
- tentativas de recuperação.

### Regra importante

Ausência de comentários não significa falha.

Se:

```text
connected = true
listening = true
thread_alive = true
tor = ok
```

a live continua classificada como saudável mesmo que fique algum tempo sem interação.

Depois de aproximadamente 120 segundos sem eventos, o watchdog apenas informa que a audiência pode estar silenciosa.

### Recuperação automática

Se houver falha técnica contínua no monitor por aproximadamente 45 segundos:

```text
connected = false
ou
listening = false
ou
thread_alive = false
```

o watchdog pode tentar recuperar somente o monitor TikTok.

A transmissão permanece separada.

Existe cooldown de aproximadamente 60 segundos entre tentativas.

---

## Renderer

O renderer fica em:

```text
src/boneco_game/static/js/renderer.js
```

Responsabilidades principais:

- vídeo idle;
- vídeos falando;
- caminhada;
- câmera;
- túnel;
- mapa;
- música;
- fala;
- timeline;
- perfil do usuário;
- cartão de comentário/presente;
- tratamento de micro-pausas;
- recuperação de vídeo travado.

Resolução base:

```text
720 x 1280
```

---

## Vídeos do personagem

Os vídeos são organizados por avatar/modo.

O projeto trabalha com estados como:

```text
Falando
Mudo
FUNDO_VERDE
```

Vídeos com fundo verde podem ser processados para WebM/transparência antes de entrar na biblioteca ativa.

---

## Processamento de fundo pelo painel

Foi adicionado o botão:

```text
Processar fundos
```

Ele procura vídeos pendentes nas pastas `FUNDO_VERDE`.

O painel exibe:

- quantidade pendente;
- arquivo atual;
- progresso;
- concluídos;
- log recente;
- estado final.

Serviço:

```text
src/boneco_game/services/background_removal.py
```

Script utilizado:

```text
scripts/process_green_avatar_videos.sh
```

O script usa o diretório do projeto dinamicamente e não depende mais de um caminho absoluto específico.

---

## Transmissão

A transmissão é controlada separadamente do renderer e do monitor.

Fluxo direto:

```text
Renderer
  ↓
X/Display virtual
  ↓
GStreamer
  ├── vídeo NVENC
  └── áudio PulseAudio
  ↓
RTMPS
  ↓
TikTok
```

Configuração observada em produção:

```text
video_bitrate: 3100
video_encoder: nvenc
rtmp_sink: rtmp2sink
```

Também existe suporte a:

```text
output_file
```

para testes locais sem transmitir ao TikTok.

**Atenção:** ao terminar um teste local, `output_file` deve voltar para vazio antes de tentar uma live real.

---

## Saúde da transmissão

O estado completo pode ser consultado em:

```text
GET /api/status
```

Saúde:

```text
GET /api/live/health
```

Diagnóstico manual sem recuperação:

```text
POST /api/live/health/check
```

---

## Atualização pelo GitHub

O painel possui o botão:

```text
Atualizar sistema
```

Objetivo: permitir atualizar arquivos versionados sem executar comandos Git manualmente na máquina de live.

O atualizador usa:

```text
git fetch --prune origin main
git pull --ff-only origin main
```

Proteções:

- não usa `reset --hard`;
- não faz merge automático;
- bloqueia com alterações locais;
- bloqueia se a branch local estiver à frente;
- bloqueia atualização durante live;
- bloqueia reinicialização durante live.

Serviço:

```text
src/boneco_game/services/system_update.py
```

Depois da atualização é possível reiniciar o sistema pelo painel.

---

## Arquivos que não vão para o GitHub

O projeto não deve versionar vídeos e arquivos privados/gerados.

O `.gitignore` cobre extensões e diretórios locais, incluindo arquivos de manutenção.

Exemplos:

```text
*.mp4
*.mov
*.mkv
*.webm
*.mpeg
*.mpg
*.zip
*.bak-*
aplicar_*.py
private/
```

Tokens, chaves de stream e outras credenciais nunca devem ser colocados na documentação ou commitados.

---

## Como iniciar o painel

Na raiz do projeto:

```bash
./scripts/start_clean_panel.sh
```

O script resolve automaticamente a raiz do projeto.

Também pode receber:

```bash
BONECO_GAME_DIR=/caminho/do/projeto ./scripts/start_clean_panel.sh
```

---

## Validação antes de commit

Sempre que alterar Python/HTML/JS/CSS:

```bash
python3 -m compileall src/boneco_game
git diff --check
git status --short
```

Depois de validar:

```bash
git add .
git commit -m "Descrição da alteração"
git push origin main
```

---

## Observações operacionais

Em um dos testes houve uma inicialização com áudio aparentemente acelerado/picotado e qualidade ruim. Uma nova live iniciada em seguida funcionou normalmente.

Como música e voz foram afetadas simultaneamente naquele caso, o comportamento foi tratado como possível falha momentânea do fluxo de transmissão/áudio e deve continuar sendo observado em logs caso volte a acontecer.

Não houve indicação de falha do monitor TikTok nesse teste posterior.

---

## Estrutura relevante

```text
src/boneco_game/
├── main.py
├── routes/
│   ├── panel.py
│   └── renderer.py
├── services/
│   ├── audio_timeline.py
│   ├── background_removal.py
│   ├── event_decision_worker.py
│   ├── live_control.py
│   ├── live_events.py
│   ├── live_health.py
│   ├── live_text.py
│   ├── speech_queue.py
│   ├── system_update.py
│   ├── text_ai.py
│   ├── tiktok_monitor.py
│   ├── transmission.py
│   ├── tts_service.py
│   └── tts_worker.py
├── static/
│   └── js/
│       ├── renderer.js
│       ├── background_removal.js
│       └── system_update.js
└── templates/
    └── panel.html

config/
└── member_welcome_phrases.txt

scripts/
├── start_clean_panel.sh
├── start_tiktok_monitor.sh
└── process_green_avatar_videos.sh

external/
└── tiktok-live-monitoring-server/
```

---

## Documentação técnica

Veja também:

```text
docs/arquitetura.md
```

para uma descrição mais profunda do fluxo interno, serviços e responsabilidades.

---

## Passo a passo para instalar em uma máquina nova

As instruções abaixo consideram uma máquina Linux baseada em Ubuntu/Debian.
Use Python 3.12 ou superior.

### 1. Instalar pacotes do sistema

```bash
sudo apt update
sudo apt install -y \
  git curl xdg-utils \
  python3 python3-venv python3-pip python3-dev python3-gi python3-gi-cairo \
  nodejs npm \
  tor torsocks \
  pulseaudio-utils pavucontrol \
  xserver-xephyr x11-utils \
  gstreamer1.0-tools \
  gstreamer1.0-plugins-base \
  gstreamer1.0-plugins-good \
  gstreamer1.0-plugins-bad \
  gstreamer1.0-plugins-ugly \
  gstreamer1.0-libav \
  gir1.2-gstreamer-1.0 \
  gir1.2-gst-plugins-base-1.0
```

Instale também Google Chrome ou Chromium. O renderer procura automaticamente por:

```text
google-chrome
google-chrome-stable
chromium
chromium-browser
brave-browser
```

Se o Chrome estiver em outro caminho, informe:

```bash
export BONECO_GAME_CHROME_BIN=/caminho/do/chrome
```

### 2. Clonar o projeto

```bash
git clone https://github.com/golgol2/Live-do-Abismo-Thiago-Reyeres.git
cd Live-do-Abismo-Thiago-Reyeres
```

Se estiver instalando em um caminho diferente do padrão usado na máquina de live, os scripts continuam funcionando porque calculam a raiz automaticamente. Quando precisar iniciar de fora da pasta do projeto, use:

```bash
export BONECO_GAME_DIR=/caminho/do/Live-do-Abismo-Thiago-Reyeres
```

### 3. Criar ambiente Python

```bash
python3 -m venv .venv
.venv/bin/python -m pip install --upgrade pip setuptools wheel
.venv/bin/python -m pip install -r requirements.txt
```

Para usar geração de voz local com Coqui XTTS, instale também o pacote de live:

```bash
.venv/bin/python -m pip install -r requirements-live.txt
```

O XTTS é pesado e normalmente precisa de GPU/CUDA para uso confortável em live. Se o Torch instalado não combinar com sua placa/driver, ajuste a instalação do Torch conforme a versão CUDA da máquina antes de rodar a live real.

### 4. Instalar o monitor TikTok em Node

```bash
cd external/tiktok-live-monitoring-server
npm install
cd ../..
```

### 5. Preparar Tor

O monitor TikTok usa Tor por padrão em `127.0.0.1:9050`.

```bash
sudo systemctl enable --now tor
ss -ltn '( sport = :9050 )'
torsocks -a 127.0.0.1 -P 9050 getent hosts www.tiktok.com
```

Se o Tor não estiver ouvindo em `9050`, corrija isso antes de iniciar uma live.

### 6. Criar pastas locais

```bash
mkdir -p private runs/logs
```

Arquivos de credenciais ficam em `private/` e não devem ser enviados ao GitHub.
Configure pelo painel ou crie localmente os arquivos necessários, como:

```text
private/live_text_ai.json
private/streamlabs_tiktok.json
private/live_control.json
```

Não coloque token, chave RTMP, chave de API ou credenciais no README, em commits ou em prints públicos.

### 7. Conferir assets locais

Os vídeos, músicas e arquivos grandes ficam em `assets/` e normalmente não entram no GitHub.
Antes da live, confira se existe pelo menos a estrutura do avatar padrão:

```text
assets/BONECO_MAPA_2D/
├── Falando/
├── Mudo/
├── Musicas/
└── frases/
```

Se os vídeos com fundo verde ainda não foram processados, use o botão **Processar fundos** no painel ou rode:

```bash
./scripts/process_green_avatar_videos.sh BONECO_MAPA_2D
```

### 8. Validar a instalação

```bash
.venv/bin/python -m compileall -q src/boneco_game
node --check external/tiktok-live-monitoring-server/server.js
gst-inspect-1.0 ximagesrc
gst-inspect-1.0 pulsesrc
gst-inspect-1.0 compositor
gst-inspect-1.0 rtmp2sink
```

Se `rtmp2sink` não existir, confira se os plugins `bad` do GStreamer foram instalados. O painel também permite usar `rtmpsink`.

### 9. Iniciar o painel

Na raiz do projeto:

```bash
./scripts/start_clean_panel.sh
```

O painel abre em:

```text
http://127.0.0.1:9292/
```

Para iniciar manualmente sem limpeza completa:

```bash
./scripts/run_dev.sh
```

### 10. Testar antes da live

Abra o preview do renderer sem iniciar transmissão:

```text
http://127.0.0.1:9292/renderer?preview=1
```

Para testar um layout específico:

```text
http://127.0.0.1:9292/renderer?preview=1&layout=zero_hours
```

Confira no painel:

- status do monitor;
- saúde da live;
- fila de falas;
- renderer;
- transmissão;
- configuração de áudio;
- layout selecionado;
- RTMP/Streamlabs.

### 11. Iniciar e finalizar a live

Com tudo configurado:

1. abra o painel em `http://127.0.0.1:9292/`;
2. confira Streamlabs ou RTMP manual;
3. confira o monitor TikTok;
4. clique em **Iniciar live**;
5. acompanhe `/api/status` e `/api/live/health`;
6. ao terminar, clique em **Finalizar live**.

Para parar o servidor local depois dos testes:

```bash
./scripts/stop_dev.sh
```

### 12. Atualizar depois da instalação

Na pasta do projeto:

```bash
git fetch --prune origin main
git pull --ff-only origin main
.venv/bin/python -m pip install -r requirements.txt
```

Se também usa XTTS local:

```bash
.venv/bin/python -m pip install -r requirements-live.txt
```
