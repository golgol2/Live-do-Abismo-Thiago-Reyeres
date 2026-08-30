# Modelos Visuais do Renderer

## Objetivo
Os modelos visuais mudam apenas o `tunnelCanvas`. O personagem, TTS, HUD, câmera e recorte da barriga continuam no fluxo atual.

## Camadas que não devem ser quebradas
1. `tunnelCanvas`: cenário.
2. `world` / `actorLayer`: personagem.
3. `bellyProfile`: foto do usuário dentro de `actorLayer`, atrás do vídeo.
4. `actorVideoA` / `actorVideoB`: personagem transparente.
5. máscara da barriga: revela `bellyProfile`.
6. HUD.

A foto da barriga nunca deve ser transformada separadamente do personagem.

## Estilos
- `classic`: túnel atual.
- `orbital_cathedral`: Catedral Orbital.

## Seleção por live
`state.tunnel_style` identifica o modelo. No início de cada live o sistema escolhe um estilo diferente do usado anteriormente. O estilo fica fixo até a live terminar.

## Catedral Orbital
Mantém a lógica reativa:
- `musicEnergy`: brilho e intensidade.
- `musicBass`: pulsação.
- `tunnelPeople`: presença de usuários.
- câmera continua independente.
- personagem e portal da barriga continuam como centro visual.

## Adicionando novos modelos
1. Adicione o ID em `TUNNEL_STYLES` no `live_control.py`.
2. Crie a função de desenho no `renderer.js`.
3. Delegue em `drawTunnel()`.
4. Não altere `actorLayer` para criar fundo.
5. Teste em 720x1280.
6. Teste idle, fala, reação, close, muitos usuários e música.
7. Atualize este documento.

## Restrições
Um modelo não deve alterar `playbackRate`, TTS/timeline, watchdog, vídeos do personagem ou depender de rede externa.

## Diagnóstico
O estilo ativo aparece em `/api/renderer/state`:
`state.tunnel_style`

## Catedral Orbital v2 — RGB, usuários e piso

A versão v2 adiciona:

- RGB percorrendo os anéis em segmentos, em vez de cada anel ter uma cor fixa.
- linhas de profundidade que giram e convergem para o centro;
- pulsos luminosos que percorrem essas linhas;
- fotos reais de `tunnelPeople` viajando pelas linhas em direção ao centro;
- piso em perspectiva composto por tijolos/quadriláteros sólidos;
- cores do piso mudam em passos musicais, usando `musicBass`, `musicEnergy` e `tunnelHue`;
- vinheta central para preservar legibilidade do rosto, corpo e portal da barriga.

O modelo continua sem alterar qualquer elemento do `actorLayer`.

## Catedral Orbital v3 — anéis mais lentos, trilhos mais grossos e piso com símbolos

A versão v3 ajusta a leitura visual do túnel:

- anéis orbitais mais lentos;
- anéis mais grossos para reforçar profundidade;
- trilhos/linhas das fotos bem mais grossos;
- trilhos desenhados antes do piso, para ficarem por baixo dele;
- piso em tijolos sólidos com formas internas;
- alguns tijolos podem mostrar ícones/emoji desenhados no canvas;
- a música continua controlando cor, brilho e pulsação sem acelerar demais o fundo.

Observação: a exibição dos emojis depende das fontes disponíveis no sistema. Se algum emoji não renderizar bem, os demais motivos geométricos continuam funcionando normalmente.

## Catedral Orbital v4 — ponto de fuga no piso e plasma dinâmico

A versão v4 reorganiza a perspectiva:

- o centro da espiral coincide com o fim/horizonte do piso;
- trilhos e fotos são desenhados antes do piso;
- uma base opaca do piso cobre os trilhos na região inferior;
- tijolos possuem opacidade maior e ficam visualmente sobre as linhas;
- fundo deixa de ser estático e recebe plasma animado;
- plasma é composto por pontos/manchas de luz em gradiente que se movem lentamente;
- bordas do plasma desaparecem no preto;
- plasma reage de forma moderada a `musicEnergy` e `musicBass`;
- anéis permanecem mais lentos para não competir com o personagem.

## Catedral Orbital v6c — corte definitivo no horizonte

A correção v6c remove o vazamento das linhas no piso pela geometria:

- trilhos e fotos recebem `clip()` limitado a `floorHorizonY - 2`;
- o clip é encerrado antes de desenhar o piso;
- a base do piso usa cores totalmente opacas;
- as fotos dos presentes nos tijolos continuam funcionando por cima do piso;
- a correção não depende mais da transparência dos tijolos para esconder as linhas.

## Catedral Orbital v7 — piso em camada DOM separada

A v7 separa definitivamente cenário e piso:

- `tunnelCanvas`: plasma, anéis, trilhos e fotos em movimento.
- `tunnelFloorCanvas`: piso e tijolos.
- `tunnelFloorCanvas` usa z-index acima do `tunnelCanvas` e abaixo de `world/actorLayer`.
- linhas do túnel não podem mais ser desenhadas sobre os tijolos.
- fotos de usuários relevantes/presentes continuam nos tijolos com transparência.
- os dois canvases permanecem dentro da mesma camada de câmera.

## Catedral Orbital v7.1 — tijolos totalmente opacos

A v7.1 reforça a separação visual do piso:

- cada tijolo é preenchido com `globalAlpha = 1`;
- o preenchimento usa `hsl()` sem canal alpha;
- não existem mais folgas internas entre os polígonos dos tijolos;
- a transparência é aplicada somente na foto do usuário;
- após desenhar a foto, `globalAlpha` volta imediatamente para `1`;
- a camada de cor reativa é aplicada sobre a foto sem tornar o tijolo transparente.

Resultado esperado: nenhuma linha do `tunnelCanvas` pode ser visível dentro de um tijolo.

## Paredes dinâmicas de presentes — v1

A Catedral Orbital possui uma camada adicional `tunnelWallCanvas`.

### Camadas
- `tunnelCanvas`: plasma, anéis e trilhos.
- `tunnelFloorCanvas`: piso e tijolos.
- `tunnelWallCanvas`: paredes laterais construídas por presentes.
- `world/actorLayer`: personagem e foto da barriga.

### Slots
Há 16 slots persistentes por sessão:
- 0–7: parede esquerda;
- 8–15: parede direita.

A ordem de preenchimento alterna esquerda/direita. Quando os 16 slots estão ocupados, um novo presente reutiliza somente o slot do registro mais antigo. Os demais blocos não mudam de posição.

### Runtime
`live_events.py` grava `runs/event_gift_wall.json`.
`/api/renderer/state` expõe `gift_wall`.

### Visual
- bloco nasce com animação curta;
- foto da parede é mais visível que no piso;
- bloco reage à música;
- parede cresce com presentes e depois renova FIFO.

## Paredes dinâmicas v2 — perspectiva derivada do piso

A parede não usa mais coordenadas independentes.

Cada bloco é derivado da geometria usada pelo piso orbital:
- mesmo `floorHorizonY`;
- mesmo `floorBottom`;
- mesma curva vertical `pow(p, 1.78)`;
- mesma abertura lateral `pow(p, 1.14)`.

A base de cada bloco coincide exatamente com a borda esquerda ou direita do piso.

Os 16 slots são sempre visíveis:
- E1–E8 à esquerda;
- D1–D8 à direita.

Quando há presente, o bloco continua opaco e somente o avatar circular possui transparência.

## Paredes dinâmicas v3 — calibração na prévia

A geometria das paredes passa a ser derivada continuamente da mesma perspectiva do piso.

### Escala
A altura da parede em cada profundidade é baseada na largura projetada de um quadrado do piso:
`wallHeightAt(p) = floorTileWidth(p) * 0.52`.

Isso faz os blocos diminuírem na mesma proporção dos quadrados do piso.

### Continuidade do topo
O topo usa funções contínuas `wallHeightAt(p)` e `wallLeanAt(p)`.
Por isso, o ponto final de um bloco é exatamente o ponto inicial do próximo, eliminando degraus/desalinhamento na borda superior.

### Prévia
O link do painel passa a abrir `/renderer?preview=1`.

Somente nessa URL:
- aparecem os 16 blocos vazios de calibração;
- aparecem os rótulos E1–E8 e D1–D8.

Na saída oficial `/renderer`, blocos vazios e rótulos não aparecem.

### Presente de teste
O botão existente **Enviar presente** do painel continua usando `/api/events/gift`.
A parede aceita presente sem `profile_image`.
Se não houver foto, o renderer cria um medalhão com as iniciais do usuário.

## Paredes dinâmicas v4 — empilhamento e fotos em cover

### Proporção
A altura foi aumentada de 0.52/0.66 anteriores para:
`wallHeightAt(p) = floorTileWidth(p) * 0.66`.

Isso deixa a face lateral visualmente mais próxima de um quadrado.

### Empilhamento
A parede possui 6 fileiras verticais.
Cada fileira contém 16 posições:
- 8 esquerda;
- 8 direita.

Capacidade total: 96 presentes.

A ordem de construção é por fileira:
1. completa a primeira fileira;
2. começa a segunda diretamente por cima;
3. continua até a sexta.

Quando os 96 slots estiverem ocupados, entra em FIFO e substitui o presente mais antigo mantendo o slot.

### Geometria compartilhada
`wallBoundaryPoint(side, p, level)` produz os vértices de cada nível.
O topo da fileira N é exatamente a base da fileira N+1.
Os blocos vizinhos também compartilham os mesmos pontos de profundidade.

### Foto
A foto ocupa a face inteira do bloco.
Ela usa:
- crop central equivalente a `cover`;
- projeção aproximada em perspectiva com 28 tiras verticais;
- alpha 0.86;
- nenhum alongamento retangular simples.

Sem foto, a face usa iniciais como fallback.

### Prévia
As fileiras vazias aparecem somente em `/renderer?preview=1`.
A saída oficial mostra apenas blocos realmente construídos por presentes.

## Super Cubo — líder de presentes

A Catedral Orbital possui um cubo CSS 3D centralizado na região superior,
atrás do personagem.

### Ranking
O ranking não depende dos slots das paredes.

`event_gift_leaderboard.json` acumula por usuário:
- quantidade total de presentes;
- número de eventos de presente;
- nome;
- foto;
- último presente;
- horário da última atualização.

O arquivo é zerado quando uma nova live começa.

### Critério
O líder é quem possui maior `total_count`.
Em empate:
1. maior número de eventos;
2. atualização mais recente.

### Visual
- 6 faces com a mesma foto do líder;
- `object-fit: cover`;
- rotação CSS 3D;
- movimento vertical suave;
- glow discreto;
- legenda com nome e total;
- fallback por iniciais se não houver foto.

O cubo só aparece quando:
- `tunnel_style == orbital_cathedral`;
- existe pelo menos um presente computado.

A camada usa z-index 4 e o world/actor permanece acima.

## Câmera distante e Super Cubo multieixos

### Câmera
A câmera dinâmica passa a possuir quatro enquadramentos:
- `distant`: zoom abaixo de 1.0 para afastar;
- `full`;
- `medium`;
- `close`.

`camera_far_zoom_min` controla o limite do enquadramento distante e pode ser
ajustado no modal de câmera. O modo automático passa a sortear `distant`
junto com os demais enquadramentos.

### Super Cubo
O cubo continua atrás do personagem (`z-index: 4`, world em 5), porém:
- fica mais alto e um pouco maior;
- escolhe posições horizontais e verticais suaves a cada poucos segundos;
- pode ir para esquerda/direita e subir/descer;
- possui um pequeno balanço contínuo;
- gira simultaneamente e de forma mais evidente nos eixos X, Y e Z.

## Câmera distante sem bordas

O enquadramento `distant` não usa mais `scale(<1)` no `cameraLayer` completo.

Nova estratégia:
- túnel, piso e paredes continuam ocupando 100% da saída;
- quando o zoom fica abaixo de 1.0, somente `world` recua;
- Boneco, barriga e elementos ligados ao personagem diminuem juntos;
- o cenário permanece contínuo nas bordas;
- zoom médio/close continua usando o transform global tradicional.

Isso trata o modo distante como profundidade dentro de uma cena/mapa,
em vez de encolher uma imagem pronta de 720x1280.

## Câmera distante v4 — mundo ancorado e cenário multiplicado

A estratégia anterior diminuía somente `world`, o que fazia o Boneco parecer
desprendido do cenário.

A v4 mantém o túnel/plasma como fundo infinito e, no enquadramento distante:
- `world` recua usando `transform-origin: 50% 100%`, mantendo os pés ancorados;
- o piso recua pelo mesmo fator de zoom;
- as paredes recuam pelo mesmo fator;
- piso e paredes ganham cópias laterais espelhadas para preencher o campo de visão adicional;
- o canvas não é reduzido, portanto não existe moldura preta;
- barriga e Boneco continuam no mesmo `world`.

O efeito passa a se comportar mais como uma câmera abrindo o campo de visão de
um mapa do que como uma imagem sendo encolhida.

## Super Cubo Social - cubo magico de presentes

As paredes laterais de presentes foram removidas.

O ranking de presentes passa a alimentar somente o Super Cubo:
- cada face possui uma grade 6x6;
- o lider de presentes ocupa uma face inteira;
- os demais usuarios ocupam exatamente um quadradinho cada;
- as outras cinco faces comportam ate 180 usuarios;
- foto usa `object-fit: cover`;
- sem foto, o quadradinho usa iniciais;
- o ranking continua independente da fila de falas;
- piso permanece inalterado;
- movimento/rotacao suave do cubo permanece ativo.

O backend nao mantem mais `event_gift_wall.json`, slots de parede ou
`wall_gifts` no estado do renderer.
